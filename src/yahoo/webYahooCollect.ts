// web 采集接线(Yahoo 链):浏览器直连 Yahoo 有 CORS 限制 → server.mjs
// /yahoo-collect 代理(Node 侧 YahooClient 直连)拉真数据,浏览器 fetch 回写
// InMemoryStore。对齐 src/webCollect.ts collectViaProxy 的形态:失败抛错(调用
// 方应中止分析,不喂空数据);skipDaily → 查询参数,缺省不带参数 = 全量。
// 纯 TS、零 RN/零 node: 依赖(架构断言 #1):仅 fetch + Intl,进 metro 图安全。
// 注意:本模块只做"传输 + 入库",采集流(候选试探/chart 解析/合成)在
// deviceYahooCollect.collectYahooPayload(server/真机/探针三端复用)。
import type { CollectSkipOpts, WebCollectResult } from '../webCollect.ts';
import type { Market } from '../market.ts';
import { detectMarket } from '../market.ts';
import { requireYahooStore, applyYahooCollectedToStore, type YahooCollectedPayload } from './applyYahooCollectedToStore.ts';

/** 采集目标 → 市场:HK 存储形('.HK' 后缀,剥后缀按数字判)或 1-5 位数字输入 →
 *  hk;字母 ticker(AAPL/BRK.B/BF-B)→ us;其余(CN 代码等)抛错——代理 gate
 *  保证只进 hk/us,此处兜底防接线遗漏(可定位)。 */
export function yahooMarketOfTicker(ticker: string): Market {
  const base = /^(\d{1,5})\.HK$/i.exec(ticker)?.[1] ?? ticker;
  const m = detectMarket(base);
  if (m === 'hk' || m === 'us') return m;
  throw new Error(`非港美股代码:${ticker}`);
}

/** 浏览器 → server.mjs 同源 /yahoo-collect;解析 YahooCollectedPayload → 入库
 *  (applyYahooCollectedToStore,store 经 setYahooStore 注入)→ WebCollectResult。
 *  opts.skipDaily → 查询参数 skipDaily=1(缺省不带参数 = 全量,兼容旧调用)。
 *  失败抛错:HTTP 非 2xx → 解析 {error} 抛 Error(对齐 collectViaProxy 语义)。 */
export async function collectYahooViaProxy(
  ticker: string,
  base: string,
  opts?: CollectSkipOpts,
): Promise<WebCollectResult> {
  const store = requireYahooStore();
  const market = yahooMarketOfTicker(ticker);
  let url = `${base}/yahoo-collect`;
  if (opts?.skipDaily) url += '?skipDaily=1';
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
    });
  } catch (err) {
    throw new Error(
      `Yahoo 采集代理不可达(需用 npm run web 起的 server):${String((err as Error)?.message ?? err)}`,
    );
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new Error(`Yahoo 采集失败(${res.status}):${body?.error ?? '未知错误'}`);
  }
  return applyYahooCollectedToStore(store, body as unknown as YahooCollectedPayload, market);
}
