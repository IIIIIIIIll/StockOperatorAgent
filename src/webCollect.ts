// web 采集接线:浏览器无原始 TCP,node-tdx-market 采集只能在 Node 跑——
// server.mjs /tdx-collect 代理(Node 侧)拉真数据,浏览器 fetch 回写 InMemoryStore。
// 纯 TS、零 RN 依赖:applyCollectedToStore 纯函数可单测,collectViaProxy 可 mock fetch。
import type { DailyBar, StoreLike } from './store.ts';
import type { CollectedSnapshot } from './tdx/quoteClient.ts';
import { parseCapitalStructure, parseFinanceIndicatorsAllTables } from './f10.ts';
import { composeReports } from './reports.ts';
import { capitalKey, f10Key } from './metaKeys.ts';

export interface CollectedPayload {
  ticker: string;
  name: string | null;
  bars: DailyBar[];
  snapshot: CollectedSnapshot | null;
  f10Text: string;
  capitalText: string; // F10「股本结构」节文本(万股);空 → capital null
  /** 同日跳过日K（C8）：bars 为空且不得清空既有日K/lastDataUpdate。 */
  skipDaily?: boolean;
}

/** 采集跳过标记（C8 freshness 接线）：按源跳过，部分 fresh 不整体短路。
 *  skipDaily → 代理仍拉快照/名称，跳过日K+xdxr；skipF10 → 跳过 F10 财务分析节
 *  （仍拉股本结构节）。判定依据 store 现有数据，由 runner.collectForWeb 计算。 */
export interface CollectSkipOpts {
  skipDaily?: boolean;
  skipF10?: boolean;
}

export interface WebCollectResult {
  f10Text: string | null;
  snapshot: CollectedSnapshot | null;
  name: string | null;
  capital: { zongguben: number; liutongguben: number } | null;
}

/** 代理载荷 → store(putStock/addDatas/per-ticker f10 meta);返回 run opts 用结果。
 *  C8 freshness：同日跳过（payload.skipDaily）时保留既有日K 与 lastDataUpdate
 *  （跳过返回现有数据不置空），快照/名称仍照常入库。 */
export function applyCollectedToStore(store: StoreLike, payload: CollectedPayload): WebCollectResult {
  const prev = store.getStock(payload.ticker);
  store.putStock({
    ticker: payload.ticker,
    name: payload.name ?? payload.ticker,
    overview: null,
    overviewLastUpdate: null,
    // 同日跳过:保留既有 lastDataUpdate(维持下次跳过判定);否则清空由 replaceDatas 重写
    lastDataUpdate: payload.skipDaily ? (prev?.lastDataUpdate ?? null) : null,
  });
  // 全量替换(代理返回 IPO 全量;防 demo 预载数据与真实数据合并混入)。
  // 同日跳过 → bars 为空:guard 免误清(InMemory replaceDatas 先删后加,空数组会清空既有日K)
  if (payload.bars.length) {
    store.replaceDatas(payload.ticker, payload.bars);
  }
  // per-ticker F10(修复旧全局 DEMO_F10_KEY 串票)+ 业绩报告入库(修复业绩报告(0))
  if (payload.f10Text) {
    store.setMeta(f10Key(payload.ticker), payload.f10Text);
    const reports = composeReports(
      payload.ticker,
      payload.name ?? payload.ticker,
      parseFinanceIndicatorsAllTables(payload.f10Text),
    );
    if (reports.length) store.addPerformanceReports(payload.ticker, reports);
  }
  // 股本结构文本持久化(DataScreen 换手率列消费;缺省不写,读 null → N/A)
  if (payload.capitalText) {
    store.setMeta(capitalKey(payload.ticker), payload.capitalText);
  }
  return {
    f10Text: payload.f10Text || null,
    snapshot: payload.snapshot,
    name: payload.name,
    capital: parseCapitalStructure(payload.capitalText),
  };
}

/** 浏览器 → server.mjs 同源 /tdx-collect;失败抛错(调用方应中止分析,不喂空数据)。
 *  opts.skipDaily/skipF10 → 查询参数,代理按源跳过(缺省不带参数 = 全量,兼容旧调用)。 */
export async function collectViaProxy(
  ticker: string,
  base: string,
  opts?: CollectSkipOpts,
): Promise<CollectedPayload> {
  let url = `${base}/tdx-collect?ticker=${encodeURIComponent(ticker)}`;
  if (opts?.skipDaily) url += '&skipDaily=1';
  if (opts?.skipF10) url += '&skipF10=1';
  let res: Response;
  try {
    res = await fetch(url);
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
