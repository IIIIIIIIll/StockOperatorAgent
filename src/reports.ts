// 业绩报告构建 —— 移植 Python data_source/chinese_mainland/tdx/reports.py
// F10 tidy long(metric × period)→ 每报告期一行 15 列;QoQ 需先把**累计值**
// 还原为单季值再算(年报−三季报/三季报−中报/中报−一季报),不得用累计值直接相减;
// report_date '%Y%m%d'(store 去重/比较契约)。纯函数,零网络。
import type { PerformanceReport } from './store.ts';
import type { F10Record } from './f10.ts';

/** 输出列序 = Python REPORT_COLUMNS(与 StockPerformanceReport 字段序一致)。 */
export const REPORT_COLUMNS = [
  'ticker', 'name', 'eps', 'total_income', 'total_income_YoY_rate',
  'total_income_QoQ_rate', 'net_profit', 'net_profit_YoY_rate',
  'net_profit_QoQ_rate', 'net_worth_per_share', 'net_worth_return_rate',
  'cash_flow_per_share', 'sales_gross_margin', 'industry', 'report_date',
] as const;

/** F10 metric 名 → 输出字段名 + 单位倍率。双词表:
 *  港澳资讯(旧 fixture):净利润(元)/营业总收入(元)——元;
 *  通达信(真实 TDX 服务器):归母净利(未调整:万)/营业总收(未调整:万)——万元 ×10⁴。
 *  8 个指标列,顺序勿改(REPORT_COLUMNS 对齐)。 */
export const METRIC_COLUMNS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, number]>]> = [
  ['eps', [['基本每股收益(元)', 1]]],
  ['total_income', [
    ['营业总收入(元)', 1],
    ['营业总收(未调整:万)', 10_000],
    ['营业总收(调整后:万)', 10_000],
  ]],
  ['total_income_YoY_rate', [
    ['营业总收入增长率(%)', 1],
    ['总营收同比增长率(%)', 1],
  ]],
  ['net_profit', [
    ['净利润(元)', 1],
    ['归母净利(未调整:万)', 10_000],
    ['归母净利(调整后:万)', 10_000],
  ]],
  ['net_profit_YoY_rate', [['净利润增长率(%)', 1]]],
  ['net_worth_per_share', [['每股净资产(元)', 1]]],
  ['net_worth_return_rate', [['加权净资产收益率(%)', 1]]],
  ['cash_flow_per_share', [['每股经营现金流量(元)', 1]]],
];

/** 相邻报告期校验:间隔恰为一季度(88~93 天,季度末 90/91/92 + 容差);缺报告期 → 不算环比。 */
function adjacentQuarterGap(a: string, b: string): boolean {
  const gap = (Date.parse(b) - Date.parse(a)) / 86_400_000;
  return gap >= 88 && gap <= 93;
}

/** 报告期月份(3/6/9/12);格式异常 → NaN(后续相减自然得 NaN)。 */
function periodMonth(period: string): number {
  return Number(period.slice(5, 7));
}

/** 累计口径 → 单季值:中国/港股 F10 利润表指标均为年初至今累计(Q1=Q1,
 *  中报=Q1+Q2,三季报=Q1+Q2+Q3,年报=全年)。QoQ 必须用单季值相减——直接用
 *  累计值相减会把「年报 − 一季报」算成 −74% 的假环比(2026-11-07 评审 CR-01)。
 *  缺同年上一季累计值(无法还原) → NaN。 */
function singleQuarterSeries(values: number[], periods: string[]): number[] {
  return values.map((v, i) => {
    if (Number.isNaN(v)) return NaN;
    const month = periodMonth(periods[i]);
    if (month === 3) return v; // 一季报累计值即单季
    if (i === 0) return NaN;
    const prevMonth = periodMonth(periods[i - 1]);
    const sameYear = periods[i].slice(0, 4) === periods[i - 1].slice(0, 4);
    // 必须与同年上一季累计值相减(中报−一季报 / 三季报−中报 / 年报−三季报)
    if (!sameYear || prevMonth !== month - 3 || !adjacentQuarterGap(periods[i - 1], periods[i])) return NaN;
    const prev = values[i - 1];
    return Number.isNaN(prev) ? NaN : v - prev;
  });
}

/** 环比序列:单季值 vs 上一季单季值;首期/无法还原/除零 → NaN;
 *  负分母合法(净利润可为负——与 overview 的"分母≤0 → NaN"约定不同)。 */
function qoqSeries(values: number[], periods: string[]): number[] {
  const singles = singleQuarterSeries(values, periods);
  return singles.map((cur, i) => {
    if (i === 0) return NaN;
    const prev = singles[i - 1];
    if (Number.isNaN(cur) || Number.isNaN(prev) || prev === 0) return NaN;
    if (!adjacentQuarterGap(periods[i - 1], periods[i])) return NaN;
    return ((cur - prev) / prev) * 100;
  });
}

/** F10 tidy long → 每报告期一行(纯函数;无任何可映射指标 → 空数组)。
 *  缺失指标 → NaN;sales_gross_margin 恒 NaN、industry 恒 ''(对齐 Python)。 */
export function composeReports(ticker: string, name: string, records: F10Record[]): PerformanceReport[] {
  const metricToField: Record<string, { field: string; mult: number }> = {};
  for (const [field, sources] of METRIC_COLUMNS) {
    for (const [metricName, mult] of sources) metricToField[metricName] = { field, mult };
  }
  // 按 period 分组;同 metric+period 去重(aggfunc first 语义——文本序首个命中)
  const byPeriod = new Map<string, Map<string, number>>();
  const periodOrder: string[] = [];
  for (const r of records) {
    const hit = metricToField[r.metric];
    if (!hit || !r.period) continue;
    let row = byPeriod.get(r.period);
    if (!row) {
      row = new Map();
      byPeriod.set(r.period, row);
      periodOrder.push(r.period);
    }
    if (!row.has(hit.field)) row.set(hit.field, r.value_num * hit.mult);
  }
  periodOrder.sort(); // ISO 字符串升序 = 时间升序
  if (!periodOrder.length) return [];

  const rows: PerformanceReport[] = [];
  for (const period of periodOrder) {
    const row = byPeriod.get(period)!;
    const num = (f: string): number => {
      const v = row.get(f);
      return typeof v === 'number' ? v : NaN;
    };
    rows.push({
      report_date: period.replace(/-/g, ''), // 'YYYY-MM-DD' → '%Y%m%d'
      fields: {
        ticker,
        name,
        eps: num('eps'),
        total_income: num('total_income'),
        total_income_YoY_rate: num('total_income_YoY_rate'),
        total_income_QoQ_rate: NaN, // 下方对齐后填
        net_profit: num('net_profit'),
        net_profit_YoY_rate: num('net_profit_YoY_rate'),
        net_profit_QoQ_rate: NaN,
        net_worth_per_share: num('net_worth_per_share'),
        net_worth_return_rate: num('net_worth_return_rate'),
        cash_flow_per_share: num('cash_flow_per_share'),
        sales_gross_margin: NaN, // F10 无(对齐 Python float64 NaN)
        industry: '', // F10 无;空串保持 str 契约
      },
    });
  }
  const ti = rows.map((r) => r.fields.total_income as number);
  const np = rows.map((r) => r.fields.net_profit as number);
  const qoqTi = qoqSeries(ti, periodOrder);
  const qoqNp = qoqSeries(np, periodOrder);
  rows.forEach((r, i) => {
    r.fields.total_income_QoQ_rate = qoqTi[i];
    r.fields.net_profit_QoQ_rate = qoqNp[i];
  });
  return rows;
}
