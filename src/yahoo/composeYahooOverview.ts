// 港股/美股概览合成 —— Yahoo chart meta + quoteSummary → 与 CN 22 键对齐的
// OverviewRow + capital（纯函数，零网络；键名对齐 src/overview.ts）。
//
// 键集（CN 22 键全覆盖，另加 Yahoo 专有 5 键，共 27 键）：
//   CN 对齐：ticker/name/latest_price/change_percent/change_amount/volume/
//     amount/amplitude/high/low/open_/prev_close/volume_ratio(NaN)/
//     turnover_rate/pe_dynamic/pb/market_cap/circulating_market_cap/
//     momentum(NaN)/change_percent_5min(NaN)/change_percent_60d/
//     change_percent_ytd(NaN——本函数无年初基准数据来源，S3 如需可另行合成)
//   Yahoo 专有：dividend_yield（股息率，summaryDetail.dividendYield.raw；
//     注意 Yahoo raw 为小数：0.005 = 0.5%，消费方显示时 ×100）、eps
//     （defaultKeyStatistics.trailingEps.raw）、week_52_high/week_52_low
//     （52 周高低，defaultKeyStatistics 或 summaryDetail 52Week*）、
//     currency（meta.currency）
//
// 值语义（对齐 overview.ts）：
// - {raw, fmt} 值形态取 .raw；缺失字段 {} → NaN
// - 除零/分母 ≤0 → NaN（divide 语义 overview.ts:26-30）
// - 量比/涨速/5 分钟涨跌 → NaN（Yahoo 无对应字段，对齐 CN pytdx 缺字段约定）
// - 涨跌幅：优先 summary.price.regularMarketChangePercent.raw（Yahoo 为
//   小数，×100 转百分数对齐 CN 语义），缺失 → (price-prev_close)/prev_close
// - change_percent_60d：调用方传窗口首末 close（opts.firstClose/lastClose）
//   → (lastClose-firstClose)/firstClose×100；opts 缺 → NaN
// - amount（成交额）：Yahoo 无标准字段（chart meta 仅部分响应含
//   regularMarketDayVolume），缺失 → NaN（S5 如需可自行 volume×price 估算）
// - market_cap 直取 defaultKeyStatistics.marketCap.raw（Yahoo 原值），
//   circulating_market_cap 派生 = latest_price×liutongguben（CN 语义）
import type { OverviewRow } from '../overview.ts';

export interface YahooOverviewOptions {
  /** 60 日窗口首根收盘（含）——change_percent_60d 分子基准。 */
  firstClose?: number;
  /** 60 日窗口末根收盘（含）。 */
  lastClose?: number;
}

export interface YahooCapital {
  zongguben: number; // 总股本（股）
  liutongguben: number; // 流通股本（股）
}

/** unknown → Record 字典（非对象/null → 空字典，缺失字段 {} → NaN 语义起点）。 */
function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** {raw, fmt} 值形态 → number；缺失/{} → NaN。 */
function rawNum(v: unknown): number {
  if (typeof v === 'number') return v;
  const r = rec(v);
  const raw = r['raw'];
  return typeof raw === 'number' ? raw : NaN;
}

/** 候选链首有限值；全缺 → NaN（容错：meta 缺字段回退 summary，再缺 → NaN）。 */
function firstFinite(...candidates: unknown[]): number {
  for (const c of candidates) {
    const n = rawNum(c);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/** a/b；b 缺失/≤0 → NaN（除零保护；对齐 overview.ts:26-30 约定）。 */
function divide(a: number, b: number): number {
  if (Number.isNaN(a)) return NaN;
  if (Number.isNaN(b) || b <= 0) return NaN;
  return a / b;
}

/** string 字段取值（非字符串 → 空串）。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** quoteSummary 原始 JSON → result[0]（兼容直接传 result[0] 的调用方）。 */
function quoteSummaryResult(summary: unknown): Record<string, unknown> {
  const s = rec(summary);
  const result = rec(s['quoteSummary'])['result'];
  if (Array.isArray(result) && result.length > 0) return rec(result[0]);
  return s;
}

/** Yahoo chart meta + quoteSummary JSON → CN 22 键对齐概览行 + capital。
 *
 * @param meta chart 响应 result[0].meta（任意可 JSON 化的输入均可，
 *   内部按未知结构容错取数）
 * @param summary quoteSummary 原始 JSON（或 result[0]）
 * @param opts 60 日窗口首末收盘（缺 → change_percent_60d NaN）
 * @return overview 概览行（OverviewRow，27 键见文件头）；capital 股本
 *   （defaultKeyStatistics.sharesOutstanding/floatShares，缺失 → NaN） */
export function composeYahooOverview(
  meta: unknown,
  summary: unknown,
  opts?: YahooOverviewOptions,
): { overview: OverviewRow; capital: YahooCapital } {
  const metaRec = rec(meta);
  const r = quoteSummaryResult(summary);
  const price = rec(r['price']);
  const summaryDetail = rec(r['summaryDetail']);
  const defaultKeyStatistics = rec(r['defaultKeyStatistics']);

  const priceNum = firstFinite(metaRec['regularMarketPrice']);
  const prevClose = firstFinite(metaRec['previousClose'], metaRec['chartPreviousClose'], price['previousClose']);
  const open = firstFinite(metaRec['regularMarketDayOpen'], price['regularMarketDayOpen'], summaryDetail['regularMarketOpen']);
  const high = firstFinite(metaRec['regularMarketDayHigh'], price['regularMarketDayHigh'], summaryDetail['regularMarketDayHigh']);
  const low = firstFinite(metaRec['regularMarketDayLow'], price['regularMarketDayLow'], summaryDetail['regularMarketDayLow']);
  const volume = firstFinite(metaRec['regularMarketVolume'], price['regularMarketVolume'], summaryDetail['regularMarketVolume']);
  const amount = firstFinite(metaRec['regularMarketDayVolume']);

  const changePctRaw = rawNum(price['regularMarketChangePercent']);
  const changePercent = Number.isFinite(changePctRaw)
    ? changePctRaw * 100 // Yahoo raw 为小数（0.01=1%），转百分数对齐 CN 语义
    : divide(priceNum - prevClose, prevClose) * 100;
  const changeRaw = rawNum(price['regularMarketChange']);
  const changeAmount = Number.isFinite(changeRaw) ? changeRaw : priceNum - prevClose;

  const zongguben = rawNum(defaultKeyStatistics['sharesOutstanding']);
  const liutongguben = rawNum(defaultKeyStatistics['floatShares']);

  const firstClose = opts?.firstClose;
  const lastClose = opts?.lastClose;
  const changePercent60d =
    firstClose === undefined || lastClose === undefined
      ? NaN
      : divide(lastClose - firstClose, firstClose) * 100;

  const longName = str(price['longName']);
  const name = longName !== '' ? longName : str(price['shortName']);

  return {
    overview: {
      ticker: str(metaRec['symbol']),
      name,
      latest_price: priceNum,
      change_percent: changePercent,
      change_amount: changeAmount,
      volume,
      amount,
      amplitude: divide(high - low, prevClose) * 100,
      high,
      low,
      open_: open,
      prev_close: prevClose,
      volume_ratio: NaN, // Yahoo 无（对齐 CN pytdx 缺字段）
      turnover_rate: divide(volume, liutongguben) * 100,
      pe_dynamic: firstFinite(summaryDetail['trailingPE']), // 动态市盈率（TTM）
      pb: firstFinite(summaryDetail['priceToBook']),
      market_cap: firstFinite(defaultKeyStatistics['marketCap'], summaryDetail['marketCap']),
      circulating_market_cap: priceNum * liutongguben,
      momentum: NaN, // 涨速：Yahoo 无
      change_percent_5min: NaN, // Yahoo 无
      change_percent_60d: changePercent60d,
      change_percent_ytd: NaN, // 本函数无年初基准数据来源
      dividend_yield: firstFinite(summaryDetail['dividendYield']), // 小数（0.005=0.5%）
      eps: firstFinite(defaultKeyStatistics['trailingEps'], summaryDetail['trailingEps']),
      week_52_high: firstFinite(defaultKeyStatistics['52WeekHigh'], summaryDetail['52WeekHigh'], price['fiftyTwoWeekHigh']),
      week_52_low: firstFinite(defaultKeyStatistics['52WeekLow'], summaryDetail['52WeekLow'], price['fiftyTwoWeekLow']),
      currency: str(metaRec['currency']),
    },
    capital: { zongguben, liutongguben },
  };
}
