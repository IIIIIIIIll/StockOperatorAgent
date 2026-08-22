// Yahoo 直连采集 —— 三端(真机 RN / server 代理 / Node 探针)共享:
// collectYahooForDevice(ticker, opts):与 web 同契约(MarketCollector,输出
// WebCollectResult,freshness 门同 collectForWeb)。浏览器直连 Yahoo 有 CORS
// 限制,web 走同源代理(/yahoo-collect);RN fetch 无 CORS/禁读 set-cookie
// 限制 → 直连。
//
// A3 cookie 手动脉冲:先 GET fc.yahoo.com 读 Set-Cookie 的 A3=(模块级缓存
// firstSetCookie,免重复请求)。实测 fc.yahoo.com 2026-08-20 起回 HTTP 404
// 但仍带 Set-Cookie A3(YahooClient 内部 fc 请求遇非 2xx 抛错)→ 预取后经
// cookieProvider 注入(YahooClient 非空即直接用,免其内部 fc 网络请求)。
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
import type { CollectSkipOpts, WebCollectResult } from '../webCollect.ts';
import { YahooClient, YahooApiError, parseA3FromSetCookie, fetchWithTimeout } from './yahooClient.ts';
import { applyYahooCollectedToStore, requireYahooStore, type YahooCollectedPayload } from './applyYahooCollectedToStore.ts';
import { composeYahooOverview } from './composeYahooOverview.ts';
import { composeYahooReports } from './composeYahooReports.ts';
import { mergeFinnhubIndustry, yahooMarketOfTicker } from './webYahooCollect.ts';
import { detectMarket, hkSymbolCandidates } from '../market.ts';
import { resolveSkipGates } from '../collector.ts';
import { warn } from '../log.ts';

/** quoteSummary 模块(契约七模块 + incomeStatementHistory:Hk 实测 quarterly 模块
 *  仅 4 期,年度模块兜底合并——见 normalizeIncomeStatements;crumb 失效降级时整体缺省)。 */
export const QUOTE_SUMMARY_MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'incomeStatementHistoryQuarterly',
  'balanceSheetHistoryQuarterly',
  'cashflowStatementHistoryQuarterly',
  'incomeStatementHistory',
];

const _CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
/** 分页窗口 10 年(实测 range=10y 窗口保持日K 粒度)。 */
const _PAGE_WINDOW_SEC = 10 * 365 * 24 * 3600;

// ─── A3 cookie 手动脉冲(模块级缓存) ────────────────────────────────────────

/** fetch 响应 → A3 cookie 值（Set-Cookie 多 cookie 逗号拼接容错；
 *  起始/分号/逗号后均可出现 A3=；解析单源 yahooClient.parseA3FromSetCookie）。 */
const setCookie = (res: Response): string | null => parseA3FromSetCookie(res.headers.get('set-cookie') ?? '');

/** 模块级缓存:首次 fc.yahoo.com 响应的 A3 值(后续请求复用,免重复网络)。 */
let firstSetCookie: string | null = null;

/** 取 A3(模块级缓存;fc.yahoo.com 404 也带 Set-Cookie,状态码无关);
 *  失败/超时(40s,同 yahooClient 常量)→ null(YahooClient 回退自身解析,
 *  其 fc 请求同样受超时约束)。server/真机/探针共用。 */
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
 *  行丢弃(store daily_bars NOT NULL 约束);volume 缺失 → 0)。 */
function barsFromChart(r: Record<string, unknown>): DailyBar[] {
  const timestampsRaw = r['timestamp'];
  const timestamps = Array.isArray(timestampsRaw) ? timestampsRaw : [];
  const quoteArr = rec(r['indicators'])['quote'];
  const quote = Array.isArray(quoteArr) && quoteArr.length > 0 ? rec(quoteArr[0]) : {};
  const openArr = quote['open'] as unknown[] | undefined;
  const highArr = quote['high'] as unknown[] | undefined;
  const lowArr = quote['low'] as unknown[] | undefined;
  const closeArr = quote['close'] as unknown[] | undefined;
  const volArr = quote['volume'] as unknown[] | undefined;
  const fmt = tzDateFmt(rec(r['meta']));
  const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const bars: DailyBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    if (!isFin(ts)) continue;
    const open = openArr?.[i];
    const high = highArr?.[i];
    const low = lowArr?.[i];
    const close = closeArr?.[i];
    if (!isFin(open) || !isFin(high) || !isFin(low) || !isFin(close)) continue;
    const vol = volArr?.[i];
    const volume = isFin(vol) ? vol : 0;
    bars.push({
      date: fmt.format(new Date(ts * 1000)),
      open,
      high,
      low,
      close,
      volume,
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
    return await resp.json();
  } catch (exc) {
    const detail = exc instanceof Error ? exc.message : String(exc);
    throw new YahooApiError(null, resp.status, `Yahoo chart 响应非 JSON：${detail}`);
  }
}

/** 全量日K分页(10 年窗口倒序,period 参数保持日K 粒度——range=max 会被 Yahoo
 *  降级为月K,实测 0700.HK/AAPL 均如此):窗口响应合并 → 按 date 去重 → 升序。
 *  firstTradeDateSec 缺失 → 回退 50 年窗口(数据缺失兜底,不阻断)。 */
async function fetchFullDailyBars(symbol: string, firstTradeDateSec: number): Promise<DailyBar[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const first = Number.isFinite(firstTradeDateSec)
    ? firstTradeDateSec - 86_400 // 含首日
    : nowSec - 50 * 365 * 86_400;
  const all: DailyBar[] = [];
  let end = nowSec + 86_400; // 含今天(盘中/盘前 bar)
  for (;;) {
    const start = Math.max(end - _PAGE_WINDOW_SEC, first);
    const r = chartResultOf(await fetchChartWindow(symbol, start, end));
    if (r !== null) all.push(...barsFromChart(r));
    if (start <= first) break;
    end = start;
  }
  const byDate = new Map<string, DailyBar>();
  for (const b of all) byDate.set(b.date, b);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 最近交易日收盘(chart meta 无 previousClose 字段——实测 HK/US 均缺,
 *  chartPreviousClose 是窗口前收盘,不可用):末根为当日(regularMarketTime 与
 *  末根同日)→ 倒数第二根;否则末根。bars 空 → NaN。 */
function prevCloseOf(bars: DailyBar[], meta: Record<string, unknown>, fmt: Intl.DateTimeFormat): number {
  if (bars.length === 0) return NaN;
  const rmTime = meta['regularMarketTime'];
  const lastIsToday =
    typeof rmTime === 'number' && Number.isFinite(rmTime)
      ? fmt.format(new Date(rmTime * 1000)) === bars[bars.length - 1].date
      : false;
  return lastIsToday && bars.length >= 2 ? bars[bars.length - 2].close : bars[bars.length - 1].close;
}

/** chart meta → 快照(price/open/high/low/prevClose;缺失 → NaN;
 *  prevClose 容错 previousClose → chartPreviousClose 两级回退)。 */
function snapshotFromMeta(meta: Record<string, unknown>): CollectedSnapshot & { prevClose: number } {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  return {
    price: n(meta['regularMarketPrice']),
    high: n(meta['regularMarketDayHigh']),
    low: n(meta['regularMarketDayLow']),
    open: n(meta['regularMarketDayOpen']),
    volume: n(meta['regularMarketVolume']),
    amount: NaN, // Yahoo 无标准成交额字段(chart meta 仅部分响应含,概览 same 语义)
    prevClose: n(meta['previousClose'] ?? meta['chartPreviousClose']),
  };
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
 *  balance/cashflow 亦仅 4 期)而年度模块 incomeStatementHistory 另 4 期——
 *  三源合并(不去重:store 按 report_date PK 幂等去重,payload 行数 = 可用期数
 *  上限)写入 incomeStatementStatements 供 composeYahooReports 读取。
 *  无任何收入表 → 原样返回(compose 返回 [])。 */
function normalizeIncomeStatements(summary: unknown): unknown {
  const s = rec(summary);
  const result = rec(s['quoteSummary'])['result'];
  if (!Array.isArray(result) || result.length === 0) return summary;
  const r = rec(result[0]);
  const q = rec(r['incomeStatementHistoryQuarterly']);
  const standard = q['incomeStatementStatements'];
  const hkQuarterly = q['incomeStatementHistory'];
  const annual = rec(r['incomeStatementHistory'])['incomeStatementHistory'];
  const merged: unknown[] = [];
  for (const arr of [standard, hkQuarterly, annual]) {
    if (!Array.isArray(arr)) continue;
    for (const stmt of arr) {
      if (stmtDateKey(stmt) !== null) merged.push(stmt); // 无 endDate 的语句行丢弃
    }
  }
  if (!merged.length) return summary;
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
export async function collectYahooPayload(
  client: YahooClient,
  ticker: string,
  opts?: { skipDaily?: boolean },
): Promise<YahooCollectedPayload> {
  // 候选:HK 存储形('.HK' 后缀)→ 原符号优先 + 候选表去重;HK 输入形(数字)→
  // 候选表;US → 原样。无效符号 chart 返回 error 壳/404(不抛,逐个试探,轻量
  // range=5d 仅定符号 + 取 meta;全量日K 走下方分页)。
  const hkStoreForm = /^(\d{1,5})\.HK$/i.exec(ticker)?.[1];
  const candidates =
    hkStoreForm !== undefined
      ? [...new Set([ticker, ...hkCandidates(hkStoreForm)])]
      : detectMarket(ticker) === 'hk'
        ? hkCandidates(ticker)
        : [ticker];
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
  if (symbol === null || result === null) throw new Error('无法解析港股代码');
  const metaRaw = rec(result['meta']);
  const fmt = tzDateFmt(metaRaw);
  const skipDaily = opts?.skipDaily === true;
  const firstTradeDate = metaRaw['firstTradeDate'];
  // 全量日K(range=max 降级月K → period 窗口分页;skipDaily → 跳过分页)
  const bars = skipDaily
    ? []
    : await fetchFullDailyBars(symbol, typeof firstTradeDate === 'number' ? firstTradeDate : NaN);
  // chart meta 无 previousClose(实测 HK/US 均缺;chartPreviousClose 是窗口前
  // 收盘):以 bars 推算最近交易日收盘注入 meta,compose/snapshot 消费正确前收
  const prevClose = prevCloseOf(bars, metaRaw, fmt);
  const meta =
    typeof metaRaw['previousClose'] === 'number' || !Number.isFinite(prevClose)
      ? metaRaw
      : { ...metaRaw, previousClose: prevClose };
  const snapshot = snapshotFromMeta(meta);
  // quoteSummary 失败(crumb 失效)→ 概览仅 chart meta 可映射字段 + reports 空
  const summary = await quoteSummaryOrNull(client, symbol);
  // 收入表语句源归一化(HK quarterly 键名/期数差异,见 normalizeIncomeStatements)
  const composed = summary === null ? null : normalizeIncomeStatements(summary);
  const firstClose = bars.length ? bars[0].close : undefined;
  const lastClose = bars.length ? bars[bars.length - 1].close : undefined;
  const { overview, capital } = composeYahooOverview(meta, composed ?? {}, { firstClose, lastClose });
  const name = typeof overview.name === 'string' && overview.name !== '' ? overview.name : '';
  const reports =
    composed === null
      ? []
      : composeYahooReports(
          composed,
          Number.isFinite(capital.zongguben) ? capital.zongguben : null,
          { ticker: symbol, name, industry: '' },
        );
  return {
    ticker: symbol,
    name: name !== '' ? name : null,
    bars,
    snapshot,
    overview,
    reports,
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
  // A3 预取(模块级缓存)→ 同步 cookieProvider 注入(免 YahooClient 内部网络
  // 请求;RN fetch 可读 set-cookie,浏览器禁读——故 web 走代理)
  const a3 = await obtainA3();
  const client = new YahooClient(undefined, () => a3);
  const payload = await collectYahooPayload(client, ticker, { skipDaily: skipDaily === true });
  await mergeFinnhubIndustry(payload, market, finnhub ?? null);
  return applyYahooCollectedToStore(store, payload, market);
}
