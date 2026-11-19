// 东方财富 F10 财务指标客户端（免 key）—— 补港美「每期财务列」。
//
// 为什么存在：2026-11-19 实测 Yahoo 的季度与年度 balanceSheet/cashflow 模块已
// 退化为只剩 endDate 的空壳（`totalStockholderEquity`/`operatingCashFlow` 全无），
// 季度收入表也只有 totalRevenue+netIncome → 每股净资产 / 每股现金流 / 毛利率 /
// ROE / 每期 EPS 在港美恒 N/A。东财 F10 指标接口给出这些字段（原币，带币种）。
//
// 两个市场两个 reportName（field 名一致，语义一致）：
// - hk: RPT_HKF10_FN_MAININDICATOR   （BPS / PER_NETCASH_OPERATE / GROSS_PROFIT_RATIO / ROE_AVG）
// - us: RPT_USF10_FN_GMAININDICATOR  （无 BPS/每股现金流；有 EPS / 毛利率 / ROE / 营收 / 净利）
// CORS：datacenter.eastmoney.com 与 push2his 同族，浏览器可直连，无需同源代理。
//
// **期次口径（关键）**：东财的 DERIVED 指标有单季也有累计行，字段名却一样。
// 唯一可靠的判据是 (REPORT_DATE - START_DATE) 的天数：
//   ~85-95 天 → 'Q'（单季，如美股 2026/Q4）
//   ~175-190 天 → 'H'（半年）
//   ~355-370 天 → 'FY'（全年，港股/美股年报）
//   ~265-280 天 → 'Y'（前三季累计，港股的「三季报」）
// 只有 'Q' / 'H' 的比率列能与我们的季度行对齐；'Y' 行**不可**直接塞进季度行
// （会把 9 个月毛利率写成单季毛利率），因此 enrich 时按 kind 白名单匹配，'Y' 丢弃。
// BPS 是期末时点值（资产负债表项），任何 kind 都安全 → 单独按日期匹配。
//
// 降级纪律（degrade don't raise）：网络/结构/符号未命中 → 空数组 + warn，
// 调用方保留 Yahoo 原值（NaN 或推导值），绝不阻断采集。
import { envValue } from '../env.ts';
import { warn } from '../log.ts';
import type { Market } from '../market.ts';

const EM_DATA = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
const EM_TIMEOUT_MS = 8000;
const PAGE_SIZE = 40;
const MS_PER_DAY = 86_400_000;
const DAYS: ReadonlyArray<readonly [number, number, 'Q' | 'H' | 'FY' | 'Y']> = [
  [85, 95, 'Q'],
  [175, 190, 'H'],
  [265, 280, 'Y'],
  [355, 370, 'FY'],
];

/** 期次类型（Q=单季 / H=半年 / FY=全年 / Y=年内累计不足一年）。 */
export type EmPeriodKind = 'Q' | 'H' | 'FY' | 'Y';

export interface EmPeriod {
  /** 'YYYYMMDD'（与 performance_reports.report_date 同形） */
  reportDate: string;
  kind: EmPeriodKind;
  /** 原币币种（CURRENCY_ABBR，缺失则 ''） */
  currency: string;
  eps: number;
  /** 每股净资产；美股该接口无 → NaN */
  bps: number;
  roe: number; // ROE_AVG（%）
  grossMargin: number; // GROSS_PROFIT_RATIO（%）
  revenue: number;
  netProfit: number; // PARENT_HOLDER_NETPROFIT / HOLDER_PROFIT
  cashFlowPerShare: number; // PER_NETCASH_OPERATE；美股无 → NaN
}

/** 该市场的 F10 reportName；cn 无（走 TDX F10）。 */
export function emF10ReportName(market: Market): string | null {
  if (market === 'hk') return 'RPT_HKF10_FN_MAININDICATOR';
  if (market === 'us') return 'RPT_USF10_FN_GMAININDICATOR';
  return null;
}

/** 东财查询用证券代码（hk: 5 位纯数字；us: 原 ticker 去掉 .- 后缀大写）。
 *  按 SECURITY_CODE 过滤（不带交易所后缀）→ 免「.O/.N/.A 是什么」的探测。 */
export function emSecurityCode(market: Market, ticker: string): string | null {
  if (market === 'hk') {
    const digits = ticker.replace(/\.HK$/i, '').replace(/\D/g, '');
    return digits === '' ? null : digits.padStart(5, '0').slice(-5);
  }
  if (market === 'us') {
    const sym = ticker.trim().toUpperCase();
    return sym === '' ? null : sym;
  }
  return null;
}

/** 'YYYY-MM-DD' / 'YYYYMMDD' → 'YYYYMMDD'；非法 → ''。 */
function ymd(value: unknown): string {
  if (typeof value !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return m === null ? '' : `${m[1]}${m[2]}${m[3]}`;
}

/** (START_DATE, REPORT_DATE) → 期次类型。天数落在任何区间外 → null（丢弃）。 */
export function classifyPeriod(startYmd: string, endYmd: string): EmPeriodKind | null {
  const toUtc = (s: string): number =>
    Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  if (startYmd.length !== 8 || endYmd.length !== 8) return null;
  const days = (toUtc(endYmd) - toUtc(startYmd)) / MS_PER_DAY;
  if (!Number.isFinite(days) || days <= 0) return null;
  for (const [lo, hi, kind] of DAYS) {
    if (days >= lo && days <= hi) return kind;
  }
  return null;
}

/** 东财数值可能是 number / null / '-' / '' → number（不可用 → NaN）。 */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string' || v === '' || v === '-') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** 响应 → EmPeriod[]（按 reportDate 升序）。纯函数，零网络。
 *
 * @param json 原始响应体（任意形态；非对象/无 result.data → 空数组）
 * @param market 决定字段名（hk 有 BPS/每股现金流，us 没有）
 */
export function parseEmF10(json: unknown, market: Market): EmPeriod[] {
  if (json === null || typeof json !== 'object') return [];
  const result = (json as Record<string, unknown>)['result'];
  if (result === null || typeof result !== 'object') return [];
  const rows = (result as Record<string, unknown>)['data'];
  if (!Array.isArray(rows)) return [];
  const out: EmPeriod[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const reportDate = ymd(r['REPORT_DATE']);
    const kind = classifyPeriod(ymd(r['START_DATE']), reportDate);
    if (reportDate === '' || kind === null) continue;
    const isHk = market === 'hk';
    out.push({
      reportDate,
      kind,
      currency: typeof r['CURRENCY_ABBR'] === 'string' ? r['CURRENCY_ABBR'] : '',
      eps: num(r['BASIC_EPS']),
      bps: isHk ? num(r['BPS']) : NaN,
      roe: num(r['ROE_AVG']),
      grossMargin: num(r['GROSS_PROFIT_RATIO']),
      revenue: num(r['OPERATE_INCOME']),
      netProfit: num(isHk ? r['HOLDER_PROFIT'] : r['PARENT_HOLDER_NETPROFIT']),
      cashFlowPerShare: isHk ? num(r['PER_NETCASH_OPERATE']) : NaN,
    });
  }
  return out.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

/** 拉取某股的东财 F10 期次（免 key；失败 → 空数组 + warn）。 */
export async function fetchEmPeriods(market: Market, ticker: string): Promise<EmPeriod[]> {
  const reportName = emF10ReportName(market);
  const code = emSecurityCode(market, ticker);
  if (reportName === null || code === null) return [];
  const url =
    `${EM_DATA}?reportName=${reportName}&columns=ALL` +
    `&filter=${encodeURIComponent(`(SECURITY_CODE="${code}")`)}` +
    `&pageNumber=1&pageSize=${PAGE_SIZE}&sortTypes=-1&sortColumns=REPORT_DATE&source=F10&client=PC`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const resp = await Promise.race([
      fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`东财 F10 超时(${EM_TIMEOUT_MS / 1000}s)`)), EM_TIMEOUT_MS);
      }),
    ]);
    if (!resp.ok) {
      warn(`东财 F10 ${code} HTTP ${resp.status},财务列保留 Yahoo 原值`);
      return [];
    }
    return parseEmF10(await resp.json(), market);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    warn(`东财 F10 ${code} 失败(${detail}),财务列保留 Yahoo 原值`);
    return [];
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 期次天数 → 该行应有的期次类型（由相邻行的实际间隔推）。
 *  88~93 → 单季；175~190 → 半年；其余 → null（不知道就不补）。 */
function expectedKindForGap(days: number): EmPeriodKind | null {
  if (days >= 88 && days <= 93) return 'Q';
  if (days >= 175 && days <= 190) return 'H';
  return null;
}

/** 日期差 ≤ 7 天算同期次。为什么需要：美股财报截止日不落月末（AAPL
 *  2026-09-26），而 Yahoo 行用月末（20260930）→ 精确匹配会全部 miss。
 *  相邻季度相隔 ~90 天，±7 天零歧义（与 gates.reportsFresh 同容差）。 */
const DATE_TOLERANCE_DAYS = 7;

/** 每股期末时点值（BPS）或其他字段的就近查找：先精确、再 ±7 天。 */
function closeEnough(aYmd: string, bYmd: string): boolean {
  const d = Math.abs(daysBetween(aYmd, bYmd));
  return Number.isFinite(d) && d <= DATE_TOLERANCE_DAYS;
}

/** 两个 YYYYMMDD 相差天数（UTC 日）。 */
function daysBetween(aYmd: string, bYmd: string): number {
  const toUtc = (s: string): number =>
    Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  return (toUtc(bYmd) - toUtc(aYmd)) / MS_PER_DAY;
}

/**
 * 用东财期次补齐业绩报告行（纯函数，返回新数组）。
 *
 * 规则（宁缺勿错）：
 * 1. 按 report_date 精确匹配；
 * 2. 非年度行：由**本行与上一个非年度行的实际间隔**推定应有期次（88~93→Q、
 *    175~190→H），只接受同类型期次。反例：0700.HK 的 2026-06-30 行是单季
 *    （上一行 03-31 间隔 91 天→Q），而东财 2026-06-30 是 H1 累计（ROE 9.97 /
 *    每股现金流 16.94 都是半年值）—— 旧规则把 H 当可用，会把半年累计写进单季行；
 * 3. 年度行只接受 kind === 'FY'；
 * 4. 逐字段**只补 NaN**，不覆盖 Yahoo 已有有效值；
 * 5. BPS 是期末时点值 → 任何 kind 都接受（单独按日期匹配）。
 *
 * @param reports 业绩报告行（可含 FY/季度）
 * @param periods 东财期次（fetchEmPeriods 产出）
 * @returns 同长度、同顺序的新数组；无匹配 → 原样浅拷贝
 */
export function enrichReportsWithEm(
  reports: ReadonlyArray<{ report_date: string; fields: Record<string, unknown> }>,
  periods: readonly EmPeriod[],
): Array<{ report_date: string; fields: Record<string, unknown> }> {
  if (periods.length === 0) return reports.map((r) => ({ ...r, fields: { ...r.fields } }));
  const byDate = new Map<string, EmPeriod[]>();
  for (const p of periods) {
    const list = byDate.get(p.reportDate);
    if (list === undefined) byDate.set(p.reportDate, [p]);
    else list.push(p);
  }
  /** 升序排列下，每行应有的期次（季度行靠与上一行的间隔推；无前一行 → 'Q'）。 */
  const expectedKinds = new Map<number, EmPeriodKind | null>();
  let prevQuarterlyDate: string | null = null;
  for (let i = 0; i < reports.length; i++) {
    const row = reports[i]!;
    if (row.fields['period_kind'] === 'FY') {
      expectedKinds.set(i, 'FY');
      continue;
    }
    const expected = prevQuarterlyDate === null ? 'Q' : expectedKindForGap(daysBetween(prevQuarterlyDate, row.report_date));
    expectedKinds.set(i, expected);
    prevQuarterlyDate = row.report_date;
  }
  /** 该行可用的期次（期次类型必须与期望一致；日期先精确再 ±7 天）。 */
  const pickFor = (index: number, reportDate: string): EmPeriod | null => {
    const expected = expectedKinds.get(index) ?? null;
    if (expected === null) return null;
    const exact = byDate.get(reportDate) ?? [];
    const exactHit = exact.find((p) => p.kind === expected);
    if (exactHit !== undefined) return exactHit;
    return periods.find((p) => p.kind === expected && closeEnough(p.reportDate, reportDate)) ?? null;
  };
  /** 期末时点值（BPS）：任何 kind 都安全，按日期先精确再 ±7 天取第一个非 NaN。 */
  const bpsFor = (reportDate: string): number => {
    const exact = byDate.get(reportDate) ?? [];
    for (const c of exact) {
      if (Number.isFinite(c.bps)) return c.bps;
    }
    for (const c of periods) {
      if (closeEnough(c.reportDate, reportDate) && Number.isFinite(c.bps)) return c.bps;
    }
    return NaN;
  };

  return reports.map((row, index) => {
    const fields = { ...row.fields };
    const em = pickFor(index, row.report_date);
    const fill = (key: string, value: number): void => {
      const current = fields[key];
      const isValid = typeof current === 'number' && Number.isFinite(current);
      if (!isValid && Number.isFinite(value)) fields[key] = value;
    };
    if (em !== null) {
      fill('eps', em.eps);
      fill('total_income', em.revenue);
      fill('net_profit', em.netProfit);
      fill('net_worth_return_rate', em.roe);
      fill('sales_gross_margin', em.grossMargin);
      fill('cash_flow_per_share', em.cashFlowPerShare);
    }
    fill('net_worth_per_share', bpsFor(row.report_date));
    return { ...row, fields };
  });
}

/** 是否启用东财 F10 补全（默认开；EM_F10_DISABLED=1/0/false/no 关闭）。 */
export function emF10Enabled(): boolean {
  const raw = envValue('EM_F10_DISABLED');
  if (raw === undefined || raw === '') return true;
  return !['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}
