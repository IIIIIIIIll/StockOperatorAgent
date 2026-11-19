// 东财 F10 客户端单测 —— 口径判据（期次天数）与「只补 NaN、宁缺勿错」的合并规则
// 是这一层的全部风险点，重点钉住：'Y'（年内累计）绝不能落进季度行。
import { describe, expect, it } from 'vitest';
import {
  classifyPeriod,
  emSecurityCode,
  enrichReportsWithEm,
  emF10ReportName,
  parseEmF10,
  type EmPeriod,
} from '../src/eastmoney/f10Client.ts';

describe('classifyPeriod(期次天数判据)', () => {
  it('单季 85~95 天 → Q(美股 2026/Q4)', () => {
    expect(classifyPeriod('20260628', '20260926')).toBe('Q'); // 90 天
  });

  it('半年 175~190 天 → H', () => {
    expect(classifyPeriod('20250101', '20250630')).toBe('H'); // 180 天
  });

  it('年内累计 265~280 天 → Y(港股三季报,不可当单季用)', () => {
    expect(classifyPeriod('20260101', '20260930')).toBe('Y'); // 272 天
  });

  it('全年 355~370 天 → FY', () => {
    expect(classifyPeriod('20250101', '20251231')).toBe('FY');
    expect(classifyPeriod('20250928', '20260926')).toBe('FY'); // 美股财年
  });

  it('区间外/非法 → null(宁可丢,不猜)', () => {
    expect(classifyPeriod('20260101', '20260215')).toBeNull(); // 45 天
    expect(classifyPeriod('20260101', '20260331')).toBe('Q'); // 89 天 → 仍在季度窗口
    expect(classifyPeriod('', '20251231')).toBeNull();
    expect(classifyPeriod('20251231', '20251231')).toBeNull();
  });
});

describe('emSecurityCode / emF10ReportName', () => {
  it('hk → 5 位补零数字；us → 大写符号', () => {
    expect(emSecurityCode('hk', '0700.HK')).toBe('00700');
    expect(emSecurityCode('hk', '9988.HK')).toBe('09988');
    expect(emSecurityCode('us', 'aapl')).toBe('AAPL');
  });

  it('cn 无东财 F10(走 TDX)', () => {
    expect(emSecurityCode('cn', '600036')).toBeNull();
    expect(emF10ReportName('cn')).toBeNull();
  });

  it('两个市场各一个 reportName', () => {
    expect(emF10ReportName('hk')).toBe('RPT_HKF10_FN_MAININDICATOR');
    expect(emF10ReportName('us')).toBe('RPT_USF10_FN_GMAININDICATOR');
  });
});

/** 东财行构造器（字段名与线上一致）。 */
function emRow(
  reportDate: string,
  startDate: string,
  over: Record<string, unknown> = {},
  market: 'hk' | 'us' = 'hk',
): Record<string, unknown> {
  return {
    REPORT_DATE: `${reportDate} 00:00:00`,
    START_DATE: `${startDate} 00:00:00`,
    CURRENCY_ABBR: market === 'hk' ? 'HKD' : 'USD',
    BASIC_EPS: 6.47,
    ROE_AVG: 15.03,
    GROSS_PROFIT_RATIO: 56.79,
    OPERATE_INCOME: 194370000000,
    [market === 'hk' ? 'HOLDER_PROFIT' : 'PARENT_HOLDER_NETPROFIT']: 58260000000,
    ...(market === 'hk' ? { BPS: 133.25, PER_NETCASH_OPERATE: 17.24 } : {}),
    ...over,
  };
}

describe('parseEmF10(响应解析)', () => {
  it('hk 行 → 含 BPS/每股现金流；日期归一为 YYYYMMDD；按日期升序', () => {
    const json = {
      result: {
        data: [
          emRow('2026-09-30', '2026-01-01'),
          emRow('2025-12-31', '2025-01-01', { BASIC_EPS: 24.97 }),
        ],
      },
    };
    const out = parseEmF10(json, 'hk');
    expect(out.map((p) => p.reportDate)).toEqual(['20251231', '20260930']);
    expect(out[1]).toMatchObject({
      kind: 'Y',
      currency: 'HKD',
      eps: 6.47,
      bps: 133.25,
      cashFlowPerShare: 17.24,
      grossMargin: 56.79,
      roe: 15.03,
    });
    expect(out[0]!.kind).toBe('FY');
  });

  it('us 行 → 无 BPS/每股现金流(NaN)，净利用 PARENT_HOLDER_NETPROFIT', () => {
    const json = { result: { data: [emRow('2026-09-26', '2025-09-28', {}, 'us')] } };
    const out = parseEmF10(json, 'us');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'FY', currency: 'USD', netProfit: 58260000000 });
    expect(out[0]!.bps).toBeNaN();
    expect(out[0]!.cashFlowPerShare).toBeNaN();
  });

  it('坏输入/坏行 → 空或被丢弃，不抛', () => {
    expect(parseEmF10(null, 'hk')).toEqual([]);
    expect(parseEmF10({}, 'hk')).toEqual([]);
    expect(parseEmF10({ result: { data: 'x' } }, 'hk')).toEqual([]);
    const bad = { result: { data: [{ REPORT_DATE: 'x' }, emRow('2026-09-30', '2026-01-01')] } };
    expect(parseEmF10(bad, 'hk')).toHaveLength(1);
  });
});

describe('enrichReportsWithEm(只补 NaN、按口径白名单匹配)', () => {
  const period = (over: Partial<EmPeriod>): EmPeriod => ({
    reportDate: '20260930',
    kind: 'Q',
    currency: 'HKD',
    eps: 6.47,
    bps: 133.25,
    roe: 15.03,
    grossMargin: 56.79,
    revenue: 194370000000,
    netProfit: 58260000000,
    cashFlowPerShare: 17.24,
    ...over,
  });

  const qRow = {
    report_date: '20260930',
    fields: { period_kind: 'Q', eps: null, sales_gross_margin: null, total_income: 207336000000 },
  };

  it('季度行 + Q 期次 → 补 eps/毛利率/ROE/现金流', () => {
    const [out] = enrichReportsWithEm([qRow], [period({})]);
    expect(out!.fields.eps).toBe(6.47);
    expect(out!.fields.sales_gross_margin).toBe(56.79);
    expect(out!.fields.net_worth_return_rate).toBe(15.03);
    expect(out!.fields.cash_flow_per_share).toBe(17.24);
    expect(out!.fields.net_worth_per_share).toBe(133.25);
  });

  it('已有有效值不覆盖(Yahoo 推导值优先)', () => {
    const [out] = enrichReportsWithEm([qRow], [period({ eps: 6.47 })]);
    expect(out!.fields.total_income).toBe(207336000000); // Yahoo 值保留
  });

  it('★ 季度行 + 只有 Y(年内累计)期次 → 一律不补(防 9 个月毛利率当单季)', () => {
    const [out] = enrichReportsWithEm([qRow], [period({ kind: 'Y' })]);
    expect(out!.fields.eps).toBeNull();
    expect(out!.fields.sales_gross_margin).toBeNull();
    // BPS 是期末时点值 → 任何 kind 都安全
    expect(out!.fields.net_worth_per_share).toBe(133.25);
  });

  it('年度行只接受 FY 期次(Q 期次不得落进 FY 行)', () => {
    const fyRow = { report_date: '20260930', fields: { period_kind: 'FY', eps: null, sales_gross_margin: null } };
    const [withQ] = enrichReportsWithEm([fyRow], [period({ kind: 'Q' })]);
    expect(withQ!.fields.eps).toBeNull();
    const [withFy] = enrichReportsWithEm([fyRow], [period({ kind: 'FY' })]);
    expect(withFy!.fields.eps).toBe(6.47);
  });

  it('日期不匹配 → 原样；入参不被改写', () => {
    const rows = [{ report_date: '20200101', fields: { eps: null } }];
    const out = enrichReportsWithEm(rows, [period({})]);
    expect(out[0]!.fields.eps).toBeNull();
    expect(rows[0]!.fields.eps).toBeNull();
    expect(out[0]).not.toBe(rows[0]);
  });

  it('空期次 → 浅拷贝，不抛', () => {
    const [out] = enrichReportsWithEm([qRow], []);
    expect(out!.fields.eps).toBeNull();
  });
});

describe('enrichReportsWithEm: 期次必须与相邻行实际间隔一致(H1 累计不得落进单季行)', () => {
  const row = (report_date: string, kind: string) => ({
    report_date,
    fields: { period_kind: kind, eps: null as number | null, sales_gross_margin: null as number | null },
  });
  const em = (reportDate: string, kind: 'Q' | 'H' | 'FY', roe: number): EmPeriod => ({
    reportDate,
    kind,
    currency: 'HKD',
    eps: 6.47,
    bps: NaN,
    roe,
    grossMargin: 56.79,
    revenue: 1,
    netProfit: 1,
    cashFlowPerShare: 1,
  });

  it('Q1(20260331)→Q2(20260630) 间隔 91 天 → 只接受 Q；东财给 H 则不补', () => {
    const out = enrichReportsWithEm(
      [row('20260331', 'Q'), row('20260630', 'Q')],
      [em('20260331', 'Q', 5.09), em('20260630', 'H', 9.97)],
    );
    expect(out[0]!.fields.sales_gross_margin).toBe(56.79); // Q 命中
    expect(out[1]!.fields.sales_gross_margin).toBeNull(); // H 被拒(半年累计 ≠ 单季)
  });

  it('同一组数据换成 H 期望(上一行间隔 182 天)→ H 才被接受', () => {
    const out = enrichReportsWithEm(
      [row('20241231', 'Q'), row('20250630', 'Q')],
      [em('20241231', 'Q', 1), em('20250630', 'H', 9.97)],
    );
    expect(out[1]!.fields.net_worth_return_rate).toBe(9.97);
  });
});

describe('enrichReportsWithEm: 财年末非月末(±7 天容差)', () => {
  it('美股 FY 末 2026-09-26 能匹配 Yahoo 行 20260930', () => {
    const reports = [
      { report_date: '20260630', fields: { period_kind: 'Q', eps: null as number | null, sales_gross_margin: null as number | null } },
      { report_date: '20260930', fields: { period_kind: 'FY', eps: null as number | null, sales_gross_margin: null as number | null } },
    ];
    const periods: EmPeriod[] = [
      { reportDate: '20260627', kind: 'Q', currency: 'USD', eps: 2.11, bps: NaN, roe: 30, grossMargin: 46.3, revenue: 109e9, netProfit: 29e9, cashFlowPerShare: NaN },
      { reportDate: '20260926', kind: 'FY', currency: 'USD', eps: 9.01, bps: NaN, roe: 142.3, grossMargin: 48.8, revenue: 478e9, netProfit: 132e9, cashFlowPerShare: NaN },
    ];
    const out = enrichReportsWithEm(reports, periods);
    expect(out[0]!.fields.sales_gross_margin).toBe(46.3); // Q: 2026-06-27 ↔ 20260630
    expect(out[1]!.fields.sales_gross_margin).toBe(48.8); // FY: 2026-09-26 ↔ 20260930
    expect(out[1]!.fields.net_worth_return_rate).toBe(142.3);
  });

  it('超出容差(8 天以上)不匹配', () => {
    const reports = [{ report_date: '20260930', fields: { period_kind: 'FY', sales_gross_margin: null as number | null } }];
    const periods: EmPeriod[] = [
      { reportDate: '20260920', kind: 'FY', currency: 'USD', eps: 1, bps: NaN, roe: 1, grossMargin: 48.8, revenue: 1, netProfit: 1, cashFlowPerShare: NaN },
    ];
    expect(enrichReportsWithEm(reports, periods)[0]!.fields.sales_gross_margin).toBeNull();
  });
});
