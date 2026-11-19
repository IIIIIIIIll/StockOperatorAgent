// 报告期窗口容差 —— 唯一真值源(2026-11 架构整改)。
//
// 整改前「一季度是多少天」这套数字散在三处,而且**已经漂了**:
//   src/eastmoney/f10Client.ts  classifyPeriod   → 跨度 85~95 判 'Q'
//   src/eastmoney/f10Client.ts  expectedKindForGap → 间隔 88~93 判 'Q'
//   src/reports.ts              adjacentQuarterGap → 间隔 88~93
//   src/yahoo/composeYahooReports.ts periodKindOf → 间隔 88~93
//
// 两个容差本身是**不同语义**,不该统一成一个数:
//   span(跨度)  = 单行 START_DATE → REPORT_DATE 的长度。企业财季长度不规整
//                 (首季可能只有 ~86 天),所以宽一点(85~95)。
//   gap(间隔)   = 相邻两行 REPORT_DATE 的距离。这里宁可窄 —— 判错的代价是把
//                 半年报当季度报,环比分母跨两个季度,直接产出假环比。
//
// 那个真实 bug:86 天的真季度行被 classifyPeriod 认成 'Q',却被只看 88~93 的
// gap 检测器判成「不知道是什么」→ EPS/ROE/毛利率增强被静默跳过,日志里一个字都没有。
// 现在两种语义各自一个具名函数、各自一张表,差异是显式的、可测的。

export const MS_PER_DAY = 86_400_000;

/** 期次类型:Q=单季 / H=半年 / FY=全年 / Y=年内累计不足一年。 */
export type PeriodBandKind = 'Q' | 'H' | 'FY' | 'Y';

/** 单行起止跨度 → 期次(宽容差,财季长度不规整)。 */
export const PERIOD_SPAN_BANDS: ReadonlyArray<readonly [number, number, PeriodBandKind]> = [
  [85, 95, 'Q'],
  [175, 190, 'H'],
  [265, 280, 'Y'],
  [355, 370, 'FY'],
];

/** 相邻报告期间隔 → 期次(窄容差;判错的代价是假环比)。 */
export const QUARTER_GAP_DAYS = { min: 88, max: 93 } as const;
export const HALF_GAP_DAYS = { min: 175, max: 190 } as const;

/** 'YYYY-MM-DD' / 'YYYYMMDD' → 'YYYYMMDD';非法 → ''。 */
export function ymdOf(value: string): string {
  const s = value.replace(/-/g, '');
  return /^\d{8}$/.test(s) ? s : '';
}

/** 'YYYYMMDD' → UTC 毫秒。按 UTC 展开,不按本地时区 —— 东八区会把
 *  2025-03-31 推成 2025-04-01,整条季度序列错位一格。非法输入 → NaN。 */
export function utcMsOf(ymd: string): number {
  if (ymd.length !== 8) return NaN;
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
}

/** 两个 'YYYYMMDD' 相差多少天(b 晚于 a 为正)。任一非法 → NaN。 */
export function daysBetweenYmd(aYmd: string, bYmd: string): number {
  return (utcMsOf(bYmd) - utcMsOf(aYmd)) / MS_PER_DAY;
}

/** 相邻报告期间隔天数 → 期次;落不进任何窗口 → null(不知道就不补)。 */
export function gapKindOf(gapDays: number): 'Q' | 'H' | null {
  if (!Number.isFinite(gapDays) || gapDays <= 0) return null;
  if (gapDays >= QUARTER_GAP_DAYS.min && gapDays <= QUARTER_GAP_DAYS.max) return 'Q';
  if (gapDays >= HALF_GAP_DAYS.min && gapDays <= HALF_GAP_DAYS.max) return 'H';
  return null;
}

/** 单行起止跨度天数 → 期次;落不进任何带 → null(丢弃该行)。 */
export function spanKindOf(spanDays: number): PeriodBandKind | null {
  if (!Number.isFinite(spanDays) || spanDays <= 0) return null;
  for (const [lo, hi, kind] of PERIOD_SPAN_BANDS) {
    if (spanDays >= lo && spanDays <= hi) return kind;
  }
  return null;
}
