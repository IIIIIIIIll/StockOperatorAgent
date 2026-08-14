// 图表数据纯函数(展示层;零 RN 依赖可单测)。
// 涨跌幅柱/财务趋势线的数据准备:NaN 过滤、正负着色、N/A 跳过、
// 财务指标跨期折线(净利润/销售毛利率/每股收益)。
// 消费方:IndicatorChart.tsx(涨跌幅 pane)、FinancialTrendChart.tsx、DataScreen 业绩卡片。
import type { PerformanceReport } from './store.ts';
import type { F10Record } from './f10.ts';
import { fmtDate } from './format.ts';

// ─── 涨跌幅柱 ─────────────────────────────────────────────────────────────

export interface ChangePctBar {
  time: string;
  value: number;
  color: string;
}

/** 涨跌幅柱数据:NaN/非有限值过滤(首根无前值 → NaN 跳过),正红负绿着色。
 *  values 与 dates 同长同序(DataScreen computeAll 同窗口切片);0 归红(涨)。 */
export function changePctHistData(
  values: number[],
  dates: string[],
  upColor: string,
  downColor: string,
): ChangePctBar[] {
  const out: ChangePctBar[] = [];
  const n = Math.min(values.length, dates.length);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    out.push({ time: dates[i], value: v, color: v >= 0 ? upColor : downColor });
  }
  return out;
}

// ─── 财务跨期趋势(净利润/销售毛利率/每股收益) ──────────────────────────────

export interface FinancialPoint {
  time: string; // 'YYYY-MM-DD'(lightweight-charts 业务日)
  value: number;
}

export interface FinancialSeries {
  label: string;
  color: string;
  points: FinancialPoint[];
}

// 财务折线色(对齐 Python charts._FINANCIAL_LINES:净利润/销售毛利率/每股收益)
export const FINANCIAL_COLORS = {
  netProfit: '#E03131',
  grossMargin: '#2563EB',
  eps: '#D97706',
} as const;

/** 财务跨期折线数据:净利润/每股收益取 performance_reports 跨期;
 *  销售毛利率取 F10 盈利能力节(performance_reports 恒 NaN——reports.ts
 *  composeReports 对齐 Python reports.py「F10 无 → NaN」;真实值在 F10
 *  盈利能力节,审计 py-ui P14)。N/A 期跳过;全 N/A 指标 → 该线省略;全空 → []。
 *  time 升序(报告期稀疏季度轴,与日K 共享 time scale 会拉平——独立成图)。 */
export function financialTrendSeries(reports: PerformanceReport[], profit: F10Record[]): FinancialSeries[] {
  const series: FinancialSeries[] = [];

  const netProfit: FinancialPoint[] = [];
  const eps: FinancialPoint[] = [];
  for (const r of reports) {
    const time = fmtDate(r.report_date); // '%Y%m%d' → 'YYYY-MM-DD'
    const np = r.fields.net_profit;
    const e = r.fields.eps;
    if (typeof np === 'number' && Number.isFinite(np)) netProfit.push({ time, value: np });
    if (typeof e === 'number' && Number.isFinite(e)) eps.push({ time, value: e });
  }

  const grossMargin: FinancialPoint[] = [];
  for (const rec of profit) {
    if (rec.metric !== '销售毛利率' || Number.isNaN(rec.value_num)) continue;
    grossMargin.push({ time: rec.period, value: rec.value_num });
  }
  grossMargin.sort((a, b) => a.time.localeCompare(b.time)); // F10 表列序新→旧,图表需升序

  if (netProfit.length) series.push({ label: '净利润', color: FINANCIAL_COLORS.netProfit, points: netProfit });
  if (grossMargin.length) series.push({ label: '销售毛利率', color: FINANCIAL_COLORS.grossMargin, points: grossMargin });
  if (eps.length) series.push({ label: '每股收益', color: FINANCIAL_COLORS.eps, points: eps });
  return series;
}

/** 业绩卡片:报告期('YYYYMMDD')对应销售毛利率(%)。数据源 F10 盈利能力节
 *  (performance_reports 恒 NaN,见 financialTrendSeries 注释);缺失 → NaN。 */
export function salesGrossMargin(profit: F10Record[], reportDate: string): number {
  const period = fmtDate(reportDate);
  for (const rec of profit) {
    if (rec.metric === '销售毛利率' && rec.period === period && !Number.isNaN(rec.value_num)) {
      return rec.value_num;
    }
  }
  return NaN;
}
