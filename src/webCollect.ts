// web 采集接线:浏览器无原始 TCP,node-tdx-market 采集只能在 Node 跑——
// server.mjs /tdx-collect 代理(Node 侧)拉真数据,浏览器 fetch 回写 InMemoryStore。
// 纯 TS、零 RN 依赖:applyCollectedToStore 纯函数可单测,collectViaProxy 可 mock fetch。
import type { DailyBar, StoreLike } from './store.ts';
import type { CollectedSnapshot } from './tdx/quoteClient.ts';
import { parseCapitalStructure, parseFinanceIndicatorsAllTables } from './f10.ts'; import { composeReports } from './reports.ts';
import { capitalKey, f10Key } from './metaKeys.ts';
import { marketSessionClosed, marketToday } from './gates.ts';
import { abortRequestAfter, raceBodyTimeout } from './timeout.ts';

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
  /** S2-2(评审 2026-11-08):实际落库的 ticker(可能是候选解析后的形式,如请求
   *  '9988.HK' 而命中的是 '09988.HK')。消费方必须用它去读 store / 跑 runner,
   *  继续用请求值会静默读到空行情。 */
  ticker: string;
  f10Text: string | null;
  snapshot: CollectedSnapshot | null;
  name: string | null;
  capital: { zongguben: number; liutongguben: number } | null;
}

/** TDX web 采集失败(归一化错误,collectViaProxy 唯一异常;对齐 YahooApiError
 *  数据源家族先例——每源一个自定义异常)。
 *
 * @param code 业务错误码:代理不可达 → 'proxy_unreachable';超时(请求腿或 body 腿)
 *   → 'proxy_timeout';HTTP 非 2xx → 'http_<status>';2xx 但载荷形状非法 →
 *   'invalid_payload'
 * @param status_code HTTP 状态码(网络异常无响应 → null)
 * @param message 人类可读错误信息
 */
export class CollectError extends Error {
  readonly code: string | null;
  readonly status_code: number | null;

  constructor(code: string | null, status_code: number | null, message: string) {
    super(message);
    this.name = 'CollectError';
    this.code = code;
    this.status_code = status_code;
  }
}

/** 代理载荷 → store(putStock/addDatas/per-ticker f10 meta);返回 run opts 用结果。
 *  C8 freshness：同日跳过（payload.skipDaily）时保留既有日K 与 lastDataUpdate
 *  （跳过返回现有数据不置空），快照/名称仍照常入库。 */
export function applyCollectedToStore(
  store: StoreLike,
  payload: CollectedPayload,
  /** 时钟注入（测试/探针）；缺省取当前时刻。仅用于“是否已收盘”判定。 */
  now: Date = new Date(),
): WebCollectResult {
  const prev = store.getStock(payload.ticker);
  // P1(评审 2026-11-19):末根是「今天但尚未收盘」的进行中 bar 时，不能让
  // last_data_update 前进到今天——否则当天剩下的时间里 gates.dailyFresh 判为新鲜，
  // 报告永远用这根盘中残缺 bar（HK/US 链已在 applyYahooCollectedToStore 修过同类）。
  const lastBarDate = payload.bars.length ? (payload.bars.at(-1)?.date ?? null) : null;
  // 两个时钟同一：既然 now 可注入，"今天"就必须也来自它（同 yahoo 链 2026-11-21 修复）
  const intradayBar = lastBarDate === marketToday('cn', now) && !marketSessionClosed('cn', now);
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
  // replaceDatas 会把戳重写成末根日期（含今天的进行中 bar）→ 盘中补一次，
  // 维持「今天的数据还没定稿」（同日跳过的分支已在上面 putStock 里保住）。
  if (intradayBar) {
    store.putStock({
      ticker: payload.ticker,
      name: payload.name ?? payload.ticker,
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: prev?.lastDataUpdate ?? null,
    });
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
    ticker: payload.ticker,
    f10Text: payload.f10Text || null,
    snapshot: payload.snapshot,
    name: payload.name,
    capital: parseCapitalStructure(payload.capitalText),
  };
}

/** 客户端 → 代理单次采集超时。代理/server 自身有采集超时,之后还要序列化回包,
 *  故留余量。P1(评审 2026-11):此前 collectViaProxy 的 fetch 与 res.json()
 *  两腿都没有超时 —— 代理挂住时 RN/web 的分析 spinner 永不 resolve,且唯一
 *  兜底是 server 端 504(body 卡住时连它都等不到)。Yahoo 同族路径
 *  (webYahooCollect.ts)已修,此处补齐。 */
const PROXY_COLLECT_TIMEOUT_MS = 60_000;

/** 请求腿 + body 腿都圈进同一超时窗口。返回 {res, body} —— 两腿任一处超时
 *  都抛 CollectError('proxy_timeout'),不把 DOMException/AbortError 泄给上层。 */
async function fetchProxyPayload(url: string): Promise<{ res: Response; body: Record<string, unknown> | null }> {
  const t = abortRequestAfter(PROXY_COLLECT_TIMEOUT_MS);
  let res: Response;
  try {
    // S6:远程模式(server HOST=0.0.0.0 非回环)要求 X-SOA-Token == SOA_ACCESS_TOKEN。
    // EXPO_PUBLIC_SOA_ACCESS_TOKEN 必须**直接成员访问**(babel-preset-expo 仅内联
    // 直接访问,architecture 契约 6 豁免);未设 → 不带头,回环行为逐字节不变。
    const soaToken = process.env.EXPO_PUBLIC_SOA_ACCESS_TOKEN;
    res = soaToken
      ? await fetch(url, { headers: { 'X-SOA-Token': soaToken }, signal: t.signal })
      : await fetch(url, { signal: t.signal });
  } catch (err) {
    if (t.signal.aborted) {
      throw new CollectError(
        'proxy_timeout',
        null,
        `TDX 采集代理超时(${PROXY_COLLECT_TIMEOUT_MS / 1000}s):服务端未在时限内回包`,
      );
    }
    throw new CollectError(
      'proxy_unreachable',
      null,
      `TDX 采集代理不可达(需用 npm run web 起的 server):${String((err as Error)?.message ?? err)}`,
    );
  } finally {
    t.done();
  }
  // body 读取同样要圈进计时窗口(fetch 已 resolve 不等于 body 到齐)。
  const body = await raceBodyTimeout<Record<string, unknown> | null>(
    () => res.json().catch(() => null),
    PROXY_COLLECT_TIMEOUT_MS,
    () =>
      new CollectError(
        'proxy_timeout',
        res.status,
        `TDX 采集代理响应体读取超时(${PROXY_COLLECT_TIMEOUT_MS / 1000}s)`,
      ),
  );
  return { res, body };
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
  const { res, body } = await fetchProxyPayload(url);
  if (!res.ok) {
    const detail =
      body !== null && typeof body === 'object' && !Array.isArray(body) && typeof body['error'] === 'string'
        ? body['error']
        : '未知错误';
    throw new CollectError(`http_${res.status}`, res.status, `TDX 采集失败(${res.status}):${detail}`);
  }
  // F13:2xx 但载荷形状非法(非对象/无 bars 数组/JSON 解析失败)→ typed error。
  // 原实现直接 cast 透传,消费方 applyCollectedToStore 首访 payload.ticker/
  // payload.bars 即 TypeError(webCollect.ts:31/:51 崩溃类);此处形状门在
  // 入 store 前拦截,调用方中止分析而非崩溃。
  if (body === null || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body['bars'])) {
    throw new CollectError(
      'invalid_payload',
      res.status,
      `TDX 采集代理返回非法载荷(200):需 {ticker, bars: [...], ...} 形状`,
    );
  }
  return body as unknown as CollectedPayload;
}
