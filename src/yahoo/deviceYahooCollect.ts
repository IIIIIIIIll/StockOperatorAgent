// Yahoo 直连采集 —— 三端(真机 RN / server 代理 / Node 探针)共享:
// collectYahooForDevice(ticker, opts):与 web 同契约(MarketCollector,输出
// WebCollectResult,freshness 门同 collectForWeb)。浏览器直连 Yahoo 有 CORS
// 限制,web 走同源代理(/yahoo-collect);RN fetch 无 CORS/禁读 set-cookie
// 限制 → 直连。
//
// A3 cookie 缓存(C3 方案 B′):GET fc.yahoo.com 读 Set-Cookie 的 A3=(模块级
// 缓存 firstSetCookie)。实测 fc.yahoo.com 2026-08-20 起回 HTTP 404 但仍带
// Set-Cookie A3 → 状态码无关解析(U5)。采集注入点不再预取:cookieProvider
// 传 getCachedA3 getter + invalidateA3Cache 失效钩子——缓存命中直接用作 A3
// (命中仅发生于显式 obtainA3 预热后;生产链无预取也无回填,稳态每次采集 1 次
// fc 请求),空/吊销 → YahooClient 自身 fc 请求解析(状态码无关,单请求路径,
// 免预取双发)。
// Hermes 零新 shim:纯 fetch + Intl,无 node: 导入(架构断言 #1)。
//
// 数据粒度实证(research 更新,2026-08-20):chart range=max&interval=1d 会被
// Yahoo 降级为月K(0700.HK → dataGranularity 1mo 267 根;AAPL → 3mo 168 根),
// 而 period1/period2 窗口(≤10 年)保持日K → 全量日K 按 10 年窗口倒序分页
// 合并;chart meta 无 previousClose 字段(前收须由 bars 推算,chartPreviousClose
// 是窗口前收盘,不可用)。
//
// collectYahooPayload 为本链共享采集流(候选试探 → 全量日K分页 → 快照 →
// quoteSummary(失败降级)→ compose → payload):server 代理(proxies.cjs)、
// 真机直连、Node 探针三端复用同一实现,行为单一来源。
import type { DailyBar } from '../store.ts';
import type { CollectedSnapshot } from '../tdx/quoteClient.ts';
import { qfqAdjustByAdjClose, type AdjCloseBar } from '../adjust.ts';
import type { CollectSkipOpts, WebCollectResult } from '../webCollect.ts';
import {
  YahooClient,
  YahooApiError,
  parseA3FromSetCookie,
  fetchWithTimeout,
  readBodyWithTimeout,
  YAHOO_REQUEST_TIMEOUT_MS,
} from './yahooClient.ts';
import { applyYahooCollectedToStore, requireYahooStore, type YahooCollectedPayload } from './applyYahooCollectedToStore.ts';
import { composeYahooOverview } from './composeYahooOverview.ts';
import { composeYahooReports } from './composeYahooReports.ts';
import { mergeFinnhubIndustry, yahooMarketOfTicker } from './webYahooCollect.ts';
import { detectMarket, hkSymbolCandidates } from '../market.ts';
import { resolveSkipGates } from '../collector.ts';
import { divide, prevVolumesOf, ytdBaseClose } from '../overview.ts';
import { composeYahooProfile, isEmptyYahooProfile } from './composeYahooProfile.ts';
import { marketToday } from '../gates.ts';
import { fetchAmountByDate, mergeAmounts } from '../eastmoney/klineClient.ts';
import { emF10Enabled, enrichReportsWithEm, fetchEmPeriods } from '../eastmoney/f10Client.ts';
import { warn } from '../log.ts';

/** quoteSummary 模块:概览/财报五模块 + 收入表(HK quarterly 实测仅 4 期,年度
 *  模块兜底合并——见 normalizeIncomeStatements)+ 公司画像四模块(assetProfile/
 *  calendarEvents/earningsTrend/recommendationTrend/majorHoldersBreakdown,
 *  同一次请求白拿:CN 的 F10 公司资料/公告日历/分析师预期在 hk/us 的替代源)。
 *  crumb 失效降级时整体缺省。 */
export const QUOTE_SUMMARY_MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'incomeStatementHistoryQuarterly',
  'balanceSheetHistoryQuarterly',
  'cashflowStatementHistoryQuarterly',
  'incomeStatementHistory',
  'assetProfile',
  'calendarEvents',
  'earningsTrend',
  'recommendationTrend',
  'majorHoldersBreakdown',
];

const _CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
/** 分页窗口 10 年(实测 range=10y 窗口保持日K 粒度)。 */
const _PAGE_WINDOW_SEC = 10 * 365 * 24 * 3600;

// ─── A3 cookie 缓存(getter + 失效钩子,C3 方案 B′) ──────────────────────────

/** fetch 响应 → A3 cookie 值（Set-Cookie 多 cookie 逗号拼接容错；
 *  起始/分号/逗号后均可出现 A3=；解析单源 yahooClient.parseA3FromSetCookie）。 */
const setCookie = (res: Response): string | null => parseA3FromSetCookie(res.headers.get('set-cookie') ?? '');

/** 模块级缓存:obtainA3() 写入的最近一次 fc.yahoo.com A3 值(唯一写入入口;
 *  显式预热/诊断/测试用,吊销/401 自愈场景经 invalidateA3Cache 清空)。生产
 *  采集链无预取也无回填——YahooClient 内部 fc 取得的 A3 仅存实例(_a3)不写
 *  回此处 → 稳态下每次采集 crumb 链各含 1 次 fc 请求(轻量,可接受);跨采集
 *  复用需引入回填钩子(结构改动,C3 复核未做)。 */
let firstSetCookie: string | null = null;

/** 缓存读取器(cookieProvider 注入用):同步 getter,每次调用重读模块级变量。
 *  失效(invalidateA3Cache)后返回 null → YahooClient._obtainA3 回退自身 fc
 *  请求解析取新 A3。禁止 `() => a3` 式值捕获闭包(C3:钉死旧值,失效无效)。 */
export function getCachedA3(): string | null {
  return firstSetCookie;
}

/** 缓存失效(A3 吊销/crumb 401 自愈):清模块级缓存;注入了本 getter 的
 *  YahooClient 下次 ensureCrumb 即重取新值。由 YahooClient 第三参注入。 */
export function invalidateA3Cache(): void {
  firstSetCookie = null;
}

/** 加载并回填缓存(fc.yahoo.com 404 也带 Set-Cookie,状态码无关);失败/超时
 *  (40s,同 yahooClient 常量)→ null 不缓存(YahooClient 回退自身解析,其 fc
 *  请求同样受超时约束)。采集注入点已不预取(C3),保留为显式预热/诊断入口
 *  (server/真机/探针共用同一解析契约)。 */
export async function obtainA3(): Promise<string | null> {
  if (firstSetCookie !== null) return firstSetCookie;
  try {
    const res = await fetchWithTimeout(fetch, 'https://fc.yahoo.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    firstSetCookie = setCookie(res);
  } catch {
    firstSetCookie = null;
  }
  return firstSetCookie;
}

// ─── chart 响应解析 ─────────────────────────────────────────────────────────

/** unknown → Record 字典(非对象/null → 空字典)。 */
function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** chart 响应 → result[0];无效符号(HTTP 200 + {"chart":{"error":…}} 壳)→ null
 *  (候选试探以 result 存在与否判定,research 实测)。 */
function chartResultOf(chartJson: unknown): Record<string, unknown> | null {
  const result = rec(rec(chartJson)['chart'])['result'];
  if (Array.isArray(result) && result.length > 0) return rec(result[0]);
  return null;
}

/** 市场时区日期格式化(meta.exchangeTimezoneName;缺省 UTC 兜底)。 */
function tzDateFmt(meta: Record<string, unknown>): Intl.DateTimeFormat {
  const tzName = meta['exchangeTimezoneName'];
  const tz = typeof tzName === 'string' && tzName !== '' ? tzName : 'UTC';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** chart result[0] → DailyBar[](市场时区日期;volume 原样股数;OHLC 非有限
 *  行丢弃(store daily_bars NOT NULL 约束);volume 缺失 → null(未知,
 *  非 0 —— 停牌/半日市不能伪装成零成交量，CR-25)。
 *  adjClose = indicators.adjclose[0].adjclose[i](Yahoo 分红+拆股复权收盘);
 *  该数组缺失(5m 盘中K 无 adjclose)→ null,后续 qfqAdjustByAdjClose 原样透传。 */
function barsFromChart(r: Record<string, unknown>): AdjCloseBar[] {
  const timestampsRaw = r['timestamp'];
  const timestamps = Array.isArray(timestampsRaw) ? timestampsRaw : [];
  const indicators = rec(r['indicators']);
  const quoteArr = indicators['quote'];
  const quote = Array.isArray(quoteArr) && quoteArr.length > 0 ? rec(quoteArr[0]) : {};
  // adjclose 与 quote 同为 indicators 下的数组模块(shape: [{adjclose:[…]}])
  const adjArr = indicators['adjclose'];
  const adjModule = Array.isArray(adjArr) && adjArr.length > 0 ? rec(adjArr[0]) : {};
  const adjCloseArr = adjModule['adjclose'] as unknown[] | undefined;
  const openArr = quote['open'] as unknown[] | undefined;
  const highArr = quote['high'] as unknown[] | undefined;
  const lowArr = quote['low'] as unknown[] | undefined;
  const closeArr = quote['close'] as unknown[] | undefined;
  const volArr = quote['volume'] as unknown[] | undefined;
  const fmt = tzDateFmt(rec(r['meta']));
  const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const bars: AdjCloseBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    if (!isFin(ts)) continue;
    const open = openArr?.[i];
    const high = highArr?.[i];
    const low = lowArr?.[i];
    const close = closeArr?.[i];
    if (!isFin(open) || !isFin(high) || !isFin(low) || !isFin(close)) continue;
    const vol = volArr?.[i];
    const volume = isFin(vol) ? vol : null;
    const adj = adjCloseArr?.[i];
    bars.push({
      date: fmt.format(new Date(ts * 1000)),
      open,
      high,
      low,
      close,
      volume,
      adjClose: isFin(adj) ? adj : null,
    });
  }
  return bars;
}

/** chart 分页窗口直连(period1/period2 保持日K 粒度;client.chart 的
 *  ChartOptions 无 period 参数,故本函数直连)。非 2xx → YahooApiError(归一化
 *  对齐 client);超时 → YahooApiError('timeout')(与 yahooClient 同常量);
 *  无效符号不抛(HTTP 200 + chart.error 壳,chartResultOf 判定)。 */
async function fetchChartWindow(symbol: string, period1: number, period2: number): Promise<unknown> {
  const url =
    `${_CHART_BASE}${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplit`;
  let resp: Response;
  try {
    resp = await fetchWithTimeout(fetch, url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch (exc) {
    if (exc instanceof YahooApiError) throw exc; // 归一化错误(超时)原样透传
    const detail = exc instanceof Error ? exc.message : String(exc);
    throw new YahooApiError(null, null, `Yahoo 请求失败：${detail}`);
  }
  if (!resp.ok) {
    throw new YahooApiError(null, resp.status, `Yahoo chart 错误：HTTP ${resp.status}`);
  }
  try {
    // P1-3(评审 2026-11-09):fetchWithTimeout 的 40s 只覆盖到响应头，body 读取
    // 必须自己圈进计时窗口 —— 否则卡住的 body 让整条采集链永不 settle。
    return await readBodyWithTimeout(() => resp.json(), YAHOO_REQUEST_TIMEOUT_MS, 'Yahoo chart');
  } catch (exc) {
    if (exc instanceof YahooApiError) throw exc; // body 超时：与头部超时同族
    const detail = exc instanceof Error ? exc.message : String(exc);
    throw new YahooApiError(null, resp.status, `Yahoo chart 响应非 JSON：${detail}`);
  }
}

/** 全量日K分页(10 年窗口倒序,period 参数保持日K 粒度——range=max 会被 Yahoo
 *  降级为月K,实测 0700.HK/AAPL 均如此):窗口响应合并 → 按 date 去重 → 升序
 *  → **前复权**(qfqAdjustByAdjClose:Yahoo adjclose 含现金分红与拆股)。
 *  firstTradeDateSec 缺失 → 回退 50 年窗口(数据缺失兜底,不阻断)。 */
async function fetchFullDailyBars(symbol: string, firstTradeDateSec: number): Promise<DailyBar[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const first = Number.isFinite(firstTradeDateSec)
    ? firstTradeDateSec - 86_400 // 含首日
    : nowSec - 50 * 365 * 86_400;
  const all: AdjCloseBar[] = [];
  let end = nowSec + 86_400; // 含今天(盘中/盘前 bar)
  for (;;) {
    const start = Math.max(end - _PAGE_WINDOW_SEC, first);
    const r = chartResultOf(await fetchChartWindow(symbol, start, end));
    if (r !== null) all.push(...barsFromChart(r));
    if (start <= first) break;
    end = start;
  }
  const byDate = new Map<string, AdjCloseBar>();
  for (const b of all) byDate.set(b.date, b);
  const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  // 前复权在入库前完成(与 CN applyQfq 同位置同语义):store 里的日K即复权序列,
  // 指标/图表/store 三处不再各自复权。
  return qfqAdjustByAdjClose(sorted);
}

/** 最近交易日收盘(chart meta 无 previousClose 字段——实测 HK/US 均缺,
 *  chartPreviousClose 是窗口前收盘,不可用):末根为当日(regularMarketTime 与
 *  末根同日)→ 倒数第二根;否则末根。bars 空 → NaN。
 *  B4 今日单 bar(IPO 日边):无前收来源——绝不回退末根=今日收盘(否则
 *  prev_close=今日收盘 → change_pct=0,与 CN 侧 overview.ts:84 bars<2 → NaN
 *  不对称)→ 返回 NaN(本文件无值哨兵,同 bars 空分支;注入门
 *  !Number.isFinite 判定 → 不注入 meta),compose 走 firstFinite → divide(NaN)
  *  → change_pct NaN,与 CN 对齐。
 *  注: 注入被跳过时 compose 回退链仍会读 meta 的 chartPreviousClose(窗口前收盘,
 *  实测 AAPL 5d 含该字段)——若其恰为 0(IPO 日窗口),divide 除零 → NaN(仍修复);
 *  若等于首根 close,change_pct=0(依赖 Yahoo 窗口形状,已记 CheckU7 minor)。 */
 function prevCloseOf(bars: DailyBar[], meta: Record<string, unknown>, fmt: Intl.DateTimeFormat): number {
  if (bars.length === 0) return NaN;
  const rmTime = meta['regularMarketTime'];
  const lastIsToday =
    typeof rmTime === 'number' && Number.isFinite(rmTime)
      ? fmt.format(new Date(rmTime * 1000)) === bars[bars.length - 1].date
      : false;
  if (lastIsToday) return bars.length >= 2 ? bars[bars.length - 2].close : NaN;
  return bars[bars.length - 1].close;
}

/** chart meta → 快照(price/open/high/low/prevClose;缺失 → NaN;
 *  prevClose 容错 previousClose → chartPreviousClose 两级回退)。 */
function snapshotFromMeta(meta: Record<string, unknown>): CollectedSnapshot & { prevClose: number } {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  // S2-3(评审 2026-11-08):chart meta 的官方键是 regularMarket*;旧实现只认
  // regularMarketDay*,遇到只给简写键的响应会恒 NaN。两套都认,官方优先。
  const nOf = (...keys: string[]): number => {
    for (const k of keys) {
      const v = n(meta[k]);
      if (!Number.isNaN(v)) return v;
    }
    return NaN;
  };
  return {
    price: n(meta['regularMarketPrice']),
    high: nOf('regularMarketDayHigh', 'regularMarketHigh'),
    low: nOf('regularMarketDayLow', 'regularMarketLow'),
    open: nOf('regularMarketDayOpen', 'regularMarketOpen'),
    volume: nOf('regularMarketVolume', 'regularMarketDayVolume'),
    amount: NaN, // Yahoo 无标准成交额字段(chart meta 仅部分响应含,概览 same 语义)
    prevClose: n(meta['previousClose'] ?? meta['chartPreviousClose']),
  };
}

/** 盘中 5 分钟K → 最近一个 5 分钟涨跌幅%（涨速/5 分钟涨跌同源）。
 *  Yahoo 无实时涨速字段，用 interval=5m 的最后两根**有效**收盘现算（盘中
 *  停牌/断点会留 null，不能直接取末两根下标）。任何失败（网络/降级/不足两根）
 *  → NaN，不抛（degrade don't raise，与 quoteSummary 降级同纪律）。 */
async function intraday5MinChangePct(client: YahooClient, symbol: string): Promise<number> {
  try {
    const result = chartResultOf(await client.chart(symbol, { range: '1d', interval: '5m' }));
    if (result === null) return NaN;
    const quoteArr = rec(result['indicators'])['quote'];
    const quote = Array.isArray(quoteArr) && quoteArr.length > 0 ? rec(quoteArr[0]) : {};
    const closes = Array.isArray(quote['close']) ? (quote['close'] as unknown[]) : [];
    const finite = closes.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (finite.length < 2) return NaN;
    const last = finite[finite.length - 1]!;
    const prev = finite[finite.length - 2]!;
    return divide(last - prev, prev) * 100;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    warn(`Yahoo 盘中 5 分钟K 获取失败,涨速/5分钟涨跌降级为 N/A:${detail}`);
    return NaN;
  }
}

/** quoteSummary 七模块;YahooApiError(crumb 失效等)→ warn + null(降级,
 *  不整体失败——degrade don't raise,error-handling spec)。 */
async function quoteSummaryOrNull(client: YahooClient, symbol: string): Promise<unknown> {
  try {
    return await client.quoteSummary(symbol, QUOTE_SUMMARY_MODULES);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    warn(`Yahoo quoteSummary 失败,概览降级(chart meta 字段):${detail}`);
    return null;
  }
}

/** 报表语句的 endDate → 日期键 'YYYY-MM-DD'(对齐 composeYahooReports 的
 *  statementDateKey 语义:优先 endDate.fmt;缺失 → endDate.raw 按 UTC)。 */
function stmtDateKey(stmt: unknown): string | null {
  const endDate = rec(stmt)['endDate'];
  const fmt = rec(endDate)['fmt'];
  if (typeof fmt === 'string' && fmt !== '') return fmt;
  const raw = rec(endDate)['raw'];
  if (typeof raw === 'number') {
    const d = new Date(raw * 1000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${d.getUTCFullYear()}-${mm}-${dd}`;
  }
  return null;
}

/** summary 归一化(收入表语句源):US 标准形 quarterly.incomeStatementStatements
 *  直接可用;HK 实测 quarterly 模块仅 4 期(键名 incomeStatementHistory,且
 *  balance/cashflow 亦仅 4 期)——两季度源合并(不去重:store 按 report_date
 *  PK 幂等去重,payload 行数 = 可用期数上限)写入 incomeStatementStatements 供
 *  composeYahooReports 读取。
 *  F06:年度语句(incomeStatementHistory 模块)不再混入季度池——composeYahooReports
 *  按年度源单独读取成行(率恒 NaN),绝不与季度行互比;此处保留原样,供其直读。
 *  无任何收入表 → 原样返回(compose 返回 [])。 */
/** 归一化后的 quoteSummary 载荷:与输入同形(Yahoo 决定的嵌套结构),
 *  本模块只重排 incomeStatementHistoryQuarterly。命名类型用于标注边界,不重造
 *  第三方 schema —— 消费方(composeYahooOverview/Reports)刻意宽松。 */
type NormalizedQuoteSummary = Record<string, unknown>;

function normalizeIncomeStatements(summary: unknown): NormalizedQuoteSummary {
  const s = rec(summary);
  const result = rec(s['quoteSummary'])['result'];
  if (!Array.isArray(result) || result.length === 0) return s;
  const r = rec(result[0]);
  const q = rec(r['incomeStatementHistoryQuarterly']);
  const standard = q['incomeStatementStatements'];
  const hkQuarterly = q['incomeStatementHistory'];
  const merged: unknown[] = [];
  for (const arr of [standard, hkQuarterly]) {
    if (!Array.isArray(arr)) continue;
    for (const stmt of arr) {
      if (stmtDateKey(stmt) !== null) merged.push(stmt); // 无 endDate 的语句行丢弃
    }
  }
  if (!merged.length) return s;
  return {
    ...s,
    quoteSummary: {
      ...rec(s['quoteSummary']),
      result: [{ ...r, incomeStatementHistoryQuarterly: { ...q, incomeStatementStatements: merged } }],
    },
  };
}

/** HK 候选(S1 hkSymbolCandidates 之上补零剥离变体):实测 Yahoo 部分港股仅存
 *  零剥离符号('09988.HK' → 404、'9988.HK' → 200;阿里巴巴),部分两种皆可
 *  ('0700.HK');hkSymbolCandidates 首位即官方 4 位码(9988.HK)通常直接命中,
 *  零剥离形与 5 位原样作兜底(4 位码与 5 位码一致的输入,Set 去重)。 */
function hkCandidates(input: string): string[] {
  const stripped = `${input.replace(/^0+/, '')}.HK`;
  return [...new Set([...hkSymbolCandidates(input), stripped])];
}

/** 共享采集流:候选试探(首个 chart result 命中即定符号;全败抛错)→ 全量日K
 *  分页 + 快照 → quoteSummary(失败降级)→ composeYahooOverview + composeYahooReports
 *  → YahooCollectedPayload(不入库)。chart 本身失败 → 抛(分析中止语义);
 *  候选试探遇 404/Not Found → 未命中继续(无效符号可能以非 2xx 返回)。
 *  skipDaily:跳过日K分页(概览/快照仍刷新,部分 fresh 不整体短路)。
 *  server 代理 / 真机直连 / Node 探针三端复用。 */
/** 美股候选（2026-11-19 补）：旧实现 US 恒 `[ticker]`，零试探 —— 与 HK 的候选表
 *  不构成对称。Yahoo 的股份类别写 `-`（BRK-B/ BF-B），而本项目输入校验
 *  （market.ts:60）接受 `.`，于是 `BRK.B` 过校验、原样发给 Yahoo 必 404，
 *  用户只看到「无法解析美股代码」。两个方向都试（Yahoo 旧数据/第三方镜像
 *  存在 `.` 形），去重后首位仍是用户原输入。 */
function usCandidates(input: string): string[] {
  const variants = [input];
  if (input.includes('.')) variants.push(input.replace(/\./g, '-'));
  if (input.includes('-')) variants.push(input.replace(/-/g, '.'));
  return [...new Set(variants)];
}

export async function collectYahooPayload(
  client: YahooClient,
  ticker: string,
  opts?: { skipDaily?: boolean },
): Promise<YahooCollectedPayload> {
  // 候选:HK 存储形('.HK' 后缀)→ 原符号优先 + 候选表去重;HK 输入形(数字)→
  // 候选表;US → 原符号优先 + '.'/'-' 形互转(usCandidates)。无效符号 chart
  // 返回 error 壳/404(不抛,逐个试探,轻量 range=5d 仅定符号 + 取 meta;
  // 全量日K 走下方分页)。
  const hkStoreForm = /^(\d{1,5})\.HK$/i.exec(ticker)?.[1];
  const candidates =
    hkStoreForm !== undefined
      ? [...new Set([ticker, ...hkCandidates(hkStoreForm)])]
      : detectMarket(ticker) === 'hk'
        ? hkCandidates(ticker)
        : usCandidates(ticker);
  let symbol: string | null = null;
  let result: Record<string, unknown> | null = null;
  for (const cand of candidates) {
    let res: unknown;
    try {
      res = await client.chart(cand, { range: '5d' });
    } catch (err) {
      // 无效符号也可能以非 2xx 返回(实测 '0988.HK' → HTTP 404 + Not Found,
      // 而非 research 的 200 error 壳):候选试探遇 Not Found → 视为未命中
      // 继续;其余(chart 本身失败,网络/5xx)→ 抛(分析中止语义)
      if (err instanceof YahooApiError && (err.status_code === 404 || err.code === 'Not Found')) continue;
      throw err;
    }
    const rr = chartResultOf(res);
    if (rr !== null) {
      symbol = cand;
      result = rr;
      break;
    }
  }
  if (symbol === null || result === null) {
    // F35:候选试探全败 —— 共享链文案按市场区分(旧文恒写「港股」,US 探针误导)
    throw new Error(`无法解析${detectMarket(ticker) === 'hk' ? '港股' : '美股'}代码`);
  }
  const metaRaw = rec(result['meta']);
  const fmt = tzDateFmt(metaRaw);
  const skipDaily = opts?.skipDaily === true;
  const firstTradeDate = metaRaw['firstTradeDate'];
  const marketOf = yahooMarketOfTicker(ticker);
  // 全量日K(range=max 降级月K → period 窗口分页;skipDaily → 跳过分页)
  // 成交额：东财 kline f57（只见 src/eastmoney/klineClient.ts 对账说明），与日K
  // 并行取；失败→空 Map→保留 volume×价格 近似（degrade don't raise）。
  let bars: DailyBar[] = [];
  let todayAmount: number | undefined;
  if (!skipDaily) {
    const [rawBars, amountByDate] = await Promise.all([
      fetchFullDailyBars(symbol, typeof firstTradeDate === 'number' ? firstTradeDate : NaN),
      fetchAmountByDate(marketOf, symbol),
    ]);
    bars = mergeAmounts(rawBars, amountByDate);
    const todayKey = marketToday(marketOf);
    const lastBar = bars.at(-1);
    // 与 CN 同语义：只当末根是「今天」时才把当日成交额抬到概览
    // （历史末根不是今日成交额）
    if (
      lastBar !== undefined &&
      lastBar.date === todayKey &&
      typeof lastBar.amount === 'number' &&
      Number.isFinite(lastBar.amount)
    ) {
      todayAmount = lastBar.amount;
    }
  }
  // chart meta 无 previousClose(实测 HK/US 均缺;chartPreviousClose 是窗口前
  // 收盘):以 bars 推算最近交易日收盘注入 meta,compose/snapshot 消费正确前收
  const prevClose = prevCloseOf(bars, metaRaw, fmt);
  const meta =
    typeof metaRaw['previousClose'] === 'number' || !Number.isFinite(prevClose)
      ? metaRaw
      : { ...metaRaw, previousClose: prevClose };
  // S2-1(评审 2026-11-08):同日跳过时 bars 为空、prevClose 无从推算,而 chart meta
  // 的 chartPreviousClose 是「5 日窗口之前」的收盘(≠ 昨收)。直接回退会写出 ≈5 个
  // 交易日陈旧的 prev_close / amplitude / change_amount,且覆盖掉 store 里原本正确的
  // 值(mergeOverview 只在非有限值时保留旧值)。此时剔除该字段 → 得 NaN → 保留旧值。
  if (bars.length === 0) {
    delete (meta as Record<string, unknown>)['chartPreviousClose'];
  }
  const snapshot = snapshotFromMeta(meta);
  // quoteSummary 失败(crumb 失效)→ 概览仅 chart meta 可映射字段 + reports 空
  // 盘中 5 分钟K 与 quoteSummary 并行（两路互不依赖，串行只会白等网络）
  // 东财 F10 期次也并行取（成交额已在日K 阶段取过；两者互不依赖）
  const [summary, intradayChangePct, emPeriods] = await Promise.all([
    quoteSummaryOrNull(client, symbol),
    intraday5MinChangePct(client, symbol),
    emF10Enabled() ? fetchEmPeriods(marketOf, symbol) : Promise.resolve([]),
  ]);
  // 收入表语句源归一化(HK quarterly 键名/期数差异,见 normalizeIncomeStatements)
  const composed = summary === null ? null : normalizeIncomeStatements(summary);
  // CR-00:60 日窗口 = 最近 61 根收盘(与 CN overview.ts 同语义);历史不足 61 根
  // → undefined → change_percent_60d NaN,不得退化成「上市以来涨幅」。
  const firstClose = bars.length > 60 ? bars[bars.length - 61].close : undefined;
  const lastClose = bars.length ? bars[bars.length - 1].close : undefined;
  // YTD 基准（上年末收盘）与量比分母（前 5 日量）：两者都是「bars → 标量」纯
  // 推导，与 CN composeOverview 共用同一语义（overview.ytdBaseClose/prevVolumesOf）。
  // 今天按市场时区（HK/US 与 CN 不同日），bars 空（skipDaily）→ 两者 NaN。
  const today = marketToday(marketOf);
  const { overview, capital } = composeYahooOverview(meta, composed ?? {}, {
    firstClose,
    lastClose,
    ytdBaseClose: ytdBaseClose(bars, today),
    prevVolumes: prevVolumesOf(bars, today),
    intradayChangePct,
    ...(todayAmount !== undefined ? { amount: todayAmount } : {}),
  });
  // 公司画像/分析师预期（同一次 quoteSummary 的 assetProfile/calendarEvents/
  // earningsTrend/recommendationTrend/majorHoldersBreakdown/financialData）。
  // 全空（quoteSummary 降级或该市场无画像）→ null，不写 meta（不覆盖既有画像）。
  const composedProfile = composed === null ? null : composeYahooProfile(composed);
  const profile = composedProfile !== null && !isEmptyYahooProfile(composedProfile) ? composedProfile : null;
  const name = typeof overview.name === 'string' && overview.name !== '' ? overview.name : '';
  const reports =
    composed === null
      ? []
      : enrichReportsWithEm(
          composeYahooReports(
            composed,
            Number.isFinite(capital.zongguben) ? capital.zongguben : null,
            { ticker: symbol, name, industry: '' },
          ),
          emPeriods,
        );
  return {
    ticker: symbol,
    name: name !== '' ? name : null,
    bars,
    snapshot,
    overview,
    reports,
    profile,
    capital,
    skipDaily,
  };
}

/** 真机采集(RN fetch 直连):A3 预取 → YahooClient(cookieProvider 注入)→
 *  collectYahooPayload → applyYahooCollectedToStore 写 FileStore → WebCollectResult。
 *  freshness 门对齐 collectForWeb:opts 缺省按 store 现状判定(skipDaily 同日),
 *  hk/us 恒 skipF10=false(Yahoo 报告全量拉取 + PK 幂等,无 F10 门)。
 *  失败抛错(调用方中止分析,不喂空数据);store 经 setYahooStore 注入。
 *  finnhub(S5 可选参,与 web 链同契约):仅 market us 且有 key → 真机直连
 *  FinnhubClient.companyProfile2 合并 overview.industry(失败 warn 忽略)。 */
export async function collectYahooForDevice(
  ticker: string,
  opts?: CollectSkipOpts,
  finnhub?: { apiKey: string } | null,
): Promise<WebCollectResult> {
  const store = requireYahooStore();
  const market = yahooMarketOfTicker(ticker);
  const { skipDaily } = resolveSkipGates(store, ticker, opts, market);
  // cookieProvider 注入 getter + 失效钩子(C3 B′,无预取):缓存命中 → 直接用作
  // A3(免 client 内部 fc 请求);空/吊销 → client 自身 fc 状态码无关解析取新值。
  // RN fetch 可读 set-cookie,浏览器禁读——故 web 走代理。
  // 真机:RN 的 fetch 走 XHR,Set-Cookie 对 JS 不可见（XHR 规范）→ 必须用
  // cookie jar 模式（JP）,否则 A3 恒取不到、quoteSummary 整段降级（E2E 实证
  // 2026-11-19:Android 上 PE/PB/52周/画像/分析师全部缺失）。
  const client = new YahooClient(undefined, getCachedA3, invalidateA3Cache, true);
  const payload = await collectYahooPayload(client, ticker, { skipDaily: skipDaily === true });
  await mergeFinnhubIndustry(payload, market, finnhub ?? null);
  return applyYahooCollectedToStore(store, payload, market);
}
