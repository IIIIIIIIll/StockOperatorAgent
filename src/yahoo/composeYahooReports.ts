// 港股/美股季度业绩报告合成 —— quoteSummary 三模块
// （incomeStatementHistoryQuarterly / balanceSheetHistoryQuarterly /
// cashflowStatementHistoryQuarterly）→ PerformanceReport[]（report_date
// '%Y%m%d'，行按 endDate 升序）。纯函数，零网络。
//
// 与 CN composeReports（src/reports.ts）的分歧（契约注明）：
// - 原币原始值，不做万元 ×10⁴（CN 通达信 F10 单位是万元；Yahoo 财报已是
//   原币元，见 coupling-map.md reports.ts:19-39 分歧注释）
// - QoQ 相邻报告期直算，无 adjacentQuarterGap 88~93 天门槛（港股半年报，
//   coupling-map.md reports.ts:41-45）
// - YoY 为同月日上年同季（endDate 年-1 且月日相同；财季末日漂移 → NaN）
// - 除零/缺失 → NaN，divide 语义同 overview.ts:26-30（分母 ≤0 → NaN——
//   与 reports.ts qoqSeries「负分母合法」不同，契约指定）
// - quarterly 模块缺失/空 → 返回 [] 不抛（degrade don't raise）
import type { PerformanceReport } from '../store.ts';
import { divide } from '../overview.ts';

export interface YahooReportsOptions {
  /** 行 fields.ticker（调用方传入；缺省 ''）。 */
  ticker?: string;
  /** 行 fields.name（调用方传入；缺省 ''）。 */
  name?: string;
  /** 行 fields.industry（调用方传入；缺省 ''）。 */
  industry?: string;
}

/** unknown → Record 字典（非对象/null → 空字典）。 */
function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** {raw, fmt} 值形态 → number；缺失/{} → NaN。 */
function rawNum(v: unknown): number {
  if (typeof v === 'number') return v;
  const raw = rec(v)['raw'];
  return typeof raw === 'number' ? raw : NaN;
}

/** 报表语句的 endDate → 日期键 'YYYY-MM-DD'：优先 endDate.fmt（Yahoo 原值，
 *  市场时区准确）；缺失 → endDate.raw（unix 秒）按 UTC 转日期。无 endDate
 *  → null（该语句行丢弃）。 */
function statementDateKey(stmt: unknown): string | null {
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

/** quoteSummary 原始 JSON → result[0]（兼容直接传 result[0] 的调用方）。 */
function quoteSummaryResult(modules: unknown): Record<string, unknown> {
  const m = rec(modules);
  const result = rec(m['quoteSummary'])['result'];
  if (Array.isArray(result) && result.length > 0) return rec(result[0]);
  return m;
}

/** Yahoo 三模块 → 每财季一行业绩报告（fields 键集 = REPORT_COLUMNS 除
 *  report_date；ticker/name/industry 由调用方传入）。
 *
 * @param modules quoteSummary 原始 JSON（或 result[0]）；incomeStatement…
 *   Quarterly 缺失/空 → 返回 []
 * @param sharesOutstanding 总股本（股，defaultKeyStatistics.sharesOutstanding
 *   .raw）；null → 每股类指标 NaN
 * @param opts ticker/name/industry（industry 缺省 ''）
 * @return 行按 report_date 升序；YoY 同月日上年同季、QoQ 相邻期直算；
 *   除零/缺失 → NaN */
export function composeYahooReports(
  modules: unknown,
  sharesOutstanding: number | null,
  opts: YahooReportsOptions = {},
): PerformanceReport[] {
  const r = quoteSummaryResult(modules);
  const quarterlyArr = rec(r['incomeStatementHistoryQuarterly'])['incomeStatementStatements'];
  // F06:年度语句(incomeStatementHistory 模块)独立读取,不混入季度池——年度行
  // 只落库不带率(YoY/QoQ 恒 NaN),且绝不与季度行互比(原合并池中季度行会把
  // 相邻年度行当 QoQ 基数、同月日年度行当 YoY 基数,持久化错误比率)
  const annualArr = rec(r['incomeStatementHistory'])['incomeStatementHistory'];
  const statements: Array<{ stmt: unknown; annual: boolean }> = [
    ...(Array.isArray(quarterlyArr) ? quarterlyArr : []).map((stmt) => ({ stmt, annual: false })),
    ...(Array.isArray(annualArr) ? annualArr : []).map((stmt) => ({ stmt, annual: true })),
  ];
  if (statements.length === 0) return [];

  // 资产负债表/现金流量表按 endDate 键对齐（缺失对齐 → 对应字段 NaN）
  const balanceByKey = new Map<string, number>();
  const balanceStatements = rec(r['balanceSheetHistoryQuarterly'])['balanceSheetStatements'];
  if (Array.isArray(balanceStatements)) {
    for (const stmt of balanceStatements) {
      const key = statementDateKey(stmt);
      if (key !== null) balanceByKey.set(key, rawNum(rec(stmt)['totalStockholderEquity']));
    }
  }
  const cashflowByKey = new Map<string, number>();
  const cashflowStatements = rec(r['cashflowStatementHistoryQuarterly'])['cashflowStatements'];
  if (Array.isArray(cashflowStatements)) {
    for (const stmt of cashflowStatements) {
      const key = statementDateKey(stmt);
      if (key !== null) cashflowByKey.set(key, rawNum(rec(stmt)['operatingCashFlow']));
    }
  }

  const shares =
    typeof sharesOutstanding === 'number' && Number.isFinite(sharesOutstanding)
      ? sharesOutstanding
      : NaN;
  const ticker = opts.ticker ?? '';
  const name = opts.name ?? '';
  const industry = opts.industry ?? '';

  // origin 随行携带(而非按 report_date 标记——HK Q4 季度行与年度行同以 12-31
  // 收尾,日期相同但起源不同,按日期归类会误伤季度行)
  type RowWithOrigin = PerformanceReport & { origin: 'quarterly' | 'annual' };
  const rows: RowWithOrigin[] = [];
  for (const { stmt, annual } of statements) {
    const key = statementDateKey(stmt);
    if (key === null) continue; // 无 endDate 的语句行丢弃
    const stmtRec = rec(stmt);
    const totalRevenue = rawNum(stmtRec['totalRevenue']);
    const netIncome = rawNum(stmtRec['netIncome']);
    const grossProfit = rawNum(stmtRec['grossProfit']);
    // F06:年度行不取季度资产负债/现金流对齐值(不同基),→ NaN
    const equity = annual ? NaN : (balanceByKey.get(key) ?? NaN);
    const opCashFlow = annual ? NaN : (cashflowByKey.get(key) ?? NaN);
    rows.push({
      report_date: key.replace(/-/g, ''), // 'YYYY-MM-DD' → '%Y%m%d'
      origin: annual ? 'annual' : 'quarterly',
      fields: {
        ticker,
        name,
        eps: rawNum(stmtRec['dilutedEPS']),
        total_income: totalRevenue,
        total_income_YoY_rate: NaN, // 下方对齐后填
        total_income_QoQ_rate: NaN, // 下方对齐后填
        net_profit: netIncome,
        net_profit_YoY_rate: NaN,
        net_profit_QoQ_rate: NaN,
        net_worth_per_share: divide(equity, shares),
        net_worth_return_rate: divide(netIncome, equity) * 100,
        cash_flow_per_share: divide(opCashFlow, shares),
        sales_gross_margin: divide(grossProfit, totalRevenue) * 100,
        industry,
      },
    });
  }
  rows.sort((a, b) => (a.report_date < b.report_date ? -1 : a.report_date > b.report_date ? 1 : 0));

  // YoY：同月日上年同季（endDate 年-1 且月日相同；无上年同季 → NaN）
  // F06：年度行恒 NaN；上年同季若是年度行也跳过（同日季度+年度并存时优先季度行）
  const byDate = new Map<string, RowWithOrigin>();
  for (const row of rows) {
    const existing = byDate.get(row.report_date);
    if (existing && existing.origin === 'quarterly') continue; // 季度行优先作比对基
    byDate.set(row.report_date, row);
  }
  for (const row of rows) {
    if (row.origin !== 'quarterly') continue;
    const prevKey = `${Number(row.report_date.slice(0, 4)) - 1}${row.report_date.slice(4)}`;
    const prevRow = byDate.get(prevKey);
    if (!prevRow || prevRow.origin !== 'quarterly') continue;
    const f = row.fields;
    const prevF = prevRow.fields;
    f.total_income_YoY_rate =
      divide(f.total_income as number - (prevF.total_income as number), prevF.total_income as number) * 100;
    f.net_profit_YoY_rate =
      divide(f.net_profit as number - (prevF.net_profit as number), prevF.net_profit as number) * 100;
  }

  // QoQ：相邻季度行直算（无 88~93 天间隔门槛——港股半年报），首个季度行 NaN。
  // F06：年度行跳过——季度序列不因年度行插入而断裂,也不与年度行互比
  let prevQuarterly: RowWithOrigin | undefined;
  for (const row of rows) {
    if (row.origin !== 'quarterly') continue;
    if (prevQuarterly !== undefined) {
      const f = row.fields;
      const prevF = prevQuarterly.fields;
      f.total_income_QoQ_rate =
        divide(f.total_income as number - (prevF.total_income as number), prevF.total_income as number) * 100;
      f.net_profit_QoQ_rate =
        divide(f.net_profit as number - (prevF.net_profit as number), prevF.net_profit as number) * 100;
    }
    prevQuarterly = row;
  }

  // 剥离内部 origin 标记(调用方只见 PerformanceReport 契约)
  return rows.map(({ origin: _origin, ...rest }) => rest);
}
