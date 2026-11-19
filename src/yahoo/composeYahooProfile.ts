// 港股/美股公司画像 + 分析师预期 —— quoteSummary 五模块合成(纯函数,零网络)。
//
// 数据源(与 composeYahooOverview 同一次 quoteSummary 请求,只多 modules 参数):
// - assetProfile:行业/板块/国家/官网/员工数/业务简介(CN 的 F10 公司资料在
//   hk/us 的替代源)
// - calendarEvents:下次财报日(含预期标记)
// - earningsTrend:本季/明年 EPS 一致预期(period '0q' / '+1y')
// - financialData:分析师目标价(均值/区间)、评级键/均值、覆盖分析师数
//   ——该模块 QUOTE_SUMMARY_MODULES 一直在拉,旧链从未消费(白拿)
// - majorHoldersBreakdown:内部人/机构持股比例
//
// 取舍:缺失一律 '' 或 NaN(消费方按 N/A 渲染),不抛错——公司画像缺失不该
// 阻断分析(error-handling spec: degrade don't raise)。
import { marketInfo, type Market } from '../market.ts';

/** 数值 → 'N/A' / 定小数文本（与 pipeline.fmtNumber 同语义；不直接 import —
 *  pipeline 反过来 import 本模块的文本段，循环 import 会拉出 TDZ 风险）。 */
function fmt(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'N/A';
}

export interface YahooProfile {
  industry: string;
  sector: string;
  country: string;
  website: string;
  employees: number; // NaN → 未披露
  businessSummary: string; // 截断到 400 字符
  nextEarningsDate: string; // 'YYYY-MM-DD';'' → 无
  nextEarningsEstimated: boolean; // true = 券商预估日(非公司公告)
  epsEstimateCurrentQ: number;
  epsEstimateNextY: number;
  targetMeanPrice: number;
  targetHighPrice: number;
  targetLowPrice: number;
  recommendationKey: string; // Yahoo 原键(strong_buy/buy/hold/...)
  recommendationMean: number; // 1=强烈买入 … 5=卖出
  analystCount: number;
  insiderPct: number; // 小数(0.317 = 31.7%)
  institutionPct: number;
  /** 净资产收益率（小数：0.16 = 16%；financialData.returnOnEquity）。 */
  returnOnEquity: number;
  /** 净利率 / 毛利率（小数；financialData.profitMargins / grossMargins）。 */
  profitMargins: number;
  grossMargins: number;
}

/** 评级键 → 中文(Yahoo recommendationKey;未知/缺失 → 空串)。 */
const RATING_LABELS: Record<string, string> = {
  strong_buy: '强烈买入',
  buy: '买入',
  hold: '持有',
  underperform: '跑输大盘',
  sell: '卖出',
  none: '无评级',
};

/** 评级键 → 中文（Yahoo recommendationKey；未知/缺失 → 空串）。DataScreen 与
 *  文本段共用同一张表，防两处文案漂移。 */
export function ratingLabel(key: string): string {
  return RATING_LABELS[key] ?? '';
}

/** unknown → Record 字典（非对象/null → 空字典）。 */
function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** {raw, fmt} 值形态 → number;缺失/{} → NaN。 */
function rawNum(v: unknown): number {
  if (typeof v === 'number') return v;
  const raw = rec(v)['raw'];
  return typeof raw === 'number' ? raw : NaN;
}

/** 字符串字段(非字符串 → '')。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** quoteSummary 原始 JSON → result[0](兼容直接传 result[0])。 */
function quoteSummaryResult(summary: unknown): Record<string, unknown> {
  const s = rec(summary);
  const result = rec(s['quoteSummary'])['result'];
  if (Array.isArray(result) && result.length > 0) return rec(result[0]);
  return s;
}

/** earningsTrend 数组 → 指定 period 的 EPS 一致预期均值(缺失 → NaN)。 */
function epsEstimate(trend: unknown, period: string): number {
  const list = Array.isArray(trend) ? trend : [];
  for (const item of list) {
    const row = rec(item);
    if (str(row['period']) !== period) continue;
    return rawNum(rec(row['earningsEstimate'])['avg']);
  }
  return NaN;
}

/** quoteSummary → 公司画像(缺字段 NaN/'';业务简介截断 400 字符)。 */
export function composeYahooProfile(summary: unknown): YahooProfile {
  const r = quoteSummaryResult(summary);
  const asset = rec(r['assetProfile']);
  const calendar = rec(rec(r['calendarEvents'])['earnings']);
  const financial = rec(r['financialData']);
  const holders = rec(r['majorHoldersBreakdown']);
  const earningsDate = Array.isArray(calendar['earningsDate']) ? calendar['earningsDate'] : [];
  const summaryText = str(asset['longBusinessSummary']);
  // earningsTrend 实测为 {trend:[…]};兼容直接传数组的调用方
  const trendRaw = r['earningsTrend'];
  const trend = Array.isArray(trendRaw) ? trendRaw : rec(trendRaw)['trend'];

  return {
    industry: str(asset['industry']),
    sector: str(asset['sector']),
    country: str(asset['country']),
    website: str(asset['website']),
    employees: rawNum(asset['fullTimeEmployees']),
    businessSummary: summaryText.length > 400 ? `${summaryText.slice(0, 400)}…` : summaryText,
    nextEarningsDate: str(rec(earningsDate[0])['fmt']),
    nextEarningsEstimated: calendar['isEarningsDateEstimate'] === true,
    epsEstimateCurrentQ: epsEstimate(trend, '0q'),
    epsEstimateNextY: epsEstimate(trend, '+1y'),
    targetMeanPrice: rawNum(financial['targetMeanPrice']),
    targetHighPrice: rawNum(financial['targetHighPrice']),
    targetLowPrice: rawNum(financial['targetLowPrice']),
    recommendationKey: str(financial['recommendationKey']),
    recommendationMean: rawNum(financial['recommendationMean']),
    analystCount: rawNum(financial['numberOfAnalystOpinions']),
    insiderPct: rawNum(holders['insidersPercentHeld']),
    institutionPct: rawNum(holders['institutionsPercentHeld']),
    returnOnEquity: rawNum(financial['returnOnEquity']),
    profitMargins: rawNum(financial['profitMargins']),
    grossMargins: rawNum(financial['grossMargins']),
  };
}

/** 画像是否全空(无任何可展示字段)——空画像不产文本段,避免占位噪音。 */
export function isEmptyYahooProfile(p: YahooProfile): boolean {
  return (
    p.industry === '' &&
    p.sector === '' &&
    p.country === '' &&
    p.website === '' &&
    !Number.isFinite(p.targetMeanPrice) &&
    !Number.isFinite(p.recommendationMean) &&
    p.nextEarningsDate === '' &&
    p.businessSummary === ''
  );
}

/** 画像 → 中文文本块(pipeline 块 1.5;空画像 → '' ,调用方不拼接)。
 *
 * @param p composeYahooProfile 产物
 * @param market 币种标签(目标价显示用)
 */
export function yahooProfileText(p: YahooProfile, market: Market): string {
  if (isEmptyYahooProfile(p)) return '';
  const currency = marketInfo(market).currency;
  const lines = ['【公司画像与分析师预期（Yahoo）】'];
  const sector = [p.sector, p.industry].filter((s) => s !== '').join(' / ');
  if (sector !== '') lines.push(`行业: ${sector}`);
  const meta = [p.country, p.website].filter((s) => s !== '');
  if (meta.length) lines.push(`国家/官网: ${meta.join('  ')}`);
  if (Number.isFinite(p.employees)) lines.push(`员工人数: ${fmt(p.employees, 0)}`);
  if (p.nextEarningsDate !== '') {
    lines.push(`下次财报: ${p.nextEarningsDate}${p.nextEarningsEstimated ? '（券商预估）' : '（公司公告）'}`);
  }
  if (Number.isFinite(p.epsEstimateCurrentQ) || Number.isFinite(p.epsEstimateNextY)) {
    lines.push(
      `EPS 一致预期: 本季 ${fmt(p.epsEstimateCurrentQ, 2)} / 明年 ${fmt(p.epsEstimateNextY, 2)}`,
    );
  }
  if (Number.isFinite(p.targetMeanPrice)) {
    lines.push(
      `分析师目标价: ${fmt(p.targetMeanPrice, 2)} ${currency}`
        + `（区间 ${fmt(p.targetLowPrice, 2)}~${fmt(p.targetHighPrice, 2)}，`
        + `${fmt(p.analystCount, 0)} 位分析师）`,
    );
  }
  const rating = ratingLabel(p.recommendationKey);
  if (rating !== '' || Number.isFinite(p.recommendationMean)) {
    lines.push(`评级: ${rating || 'N/A'}（${fmt(p.recommendationMean, 2)}，1=强烈买入 5=卖出）`);
  }
  if (Number.isFinite(p.insiderPct) || Number.isFinite(p.institutionPct)) {
    lines.push(
      `内部人持股: ${fmt(p.insiderPct * 100, 2)}%  机构持股: ${fmt(p.institutionPct * 100, 2)}%`,
    );
  }
  if (p.businessSummary !== '') lines.push(`业务简介: ${p.businessSummary}`);
  return lines.join('\n');
}

/** meta 里的画像 JSON → YahooProfile;缺失/损坏 → null(消费方回退占位)。 */
export function parseYahooProfile(json: string | null): YahooProfile | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed as YahooProfile;
  } catch {
    return null;
  }
}
