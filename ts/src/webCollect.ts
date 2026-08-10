// web 采集接线:浏览器无原始 TCP,node-tdx-market 采集只能在 Node 跑——
// server.mjs /tdx-collect 代理(Node 侧)拉真数据,浏览器 fetch 回写 InMemoryStore。
// 纯 TS、零 RN 依赖:applyCollectedToStore 纯函数可单测,collectViaProxy 可 mock fetch。
import type { DailyBar, StoreLike } from './store.ts';
import type { CollectedSnapshot } from './tdx/quoteClient.ts';
import { parseCapitalStructure, parseFinanceIndicatorsAllTables } from './f10.ts';
import { composeReports } from './reports.ts';

export interface CollectedPayload {
  ticker: string;
  name: string | null;
  bars: DailyBar[];
  snapshot: CollectedSnapshot | null;
  f10Text: string;
  capitalText: string; // F10「股本结构」节文本(万股);空 → capital null
}

export interface WebCollectResult {
  f10Text: string | null;
  snapshot: CollectedSnapshot | null;
  name: string | null;
  capital: { zongguben: number; liutongguben: number } | null;
}

/** 代理载荷 → store(putStock/addDatas/per-ticker f10 meta);返回 run opts 用结果。 */
export function applyCollectedToStore(store: StoreLike, payload: CollectedPayload): WebCollectResult {
  store.putStock({
    ticker: payload.ticker,
    name: payload.name ?? payload.ticker,
    overview: null,
    overviewLastUpdate: null,
    lastDataUpdate: null,
  });
  // 全量替换(代理返回 IPO 全量;防 demo 预载 600036 与真实数据合并混入)
  store.replaceDatas(payload.ticker, payload.bars);
  // per-ticker F10(修复旧全局 demo:f10 串票)+ 业绩报告入库(修复业绩报告(0))
  if (payload.f10Text) {
    store.setMeta(`f10:${payload.ticker}`, payload.f10Text);
    const reports = composeReports(
      payload.ticker,
      payload.name ?? payload.ticker,
      parseFinanceIndicatorsAllTables(payload.f10Text),
    );
    if (reports.length) store.addPerformanceReports(payload.ticker, reports);
  }
  return {
    f10Text: payload.f10Text || null,
    snapshot: payload.snapshot,
    name: payload.name,
    capital: parseCapitalStructure(payload.capitalText),
  };
}

/** 浏览器 → server.mjs 同源 /tdx-collect;失败抛错(调用方应中止分析,不喂空数据)。 */
export async function collectViaProxy(ticker: string, base: string): Promise<CollectedPayload> {
  let res: Response;
  try {
    res = await fetch(`${base}/tdx-collect?ticker=${encodeURIComponent(ticker)}`);
  } catch (err) {
    throw new Error(
      `TDX 采集代理不可达(需用 npm run web 起的 server):${String((err as Error)?.message ?? err)}`,
    );
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new Error(`TDX 采集失败(${res.status}):${body?.error ?? '未知错误'}`);
  }
  return body as unknown as CollectedPayload;
}
