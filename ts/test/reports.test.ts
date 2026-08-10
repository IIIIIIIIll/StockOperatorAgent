// 业绩报告构建单测(移植 Python data_source/tdx/reports.py 契约):
// pivot 分组、QoQ 相邻季度自算、report_date '%Y%m%d'、缺指标 NaN;
// 真实 fixture(f10_hk.txt,港澳资讯格式)→ 解析 → 报告非空。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { InMemoryStore } from '../src/store-memory.ts';
import { parseFinanceIndicatorsAllTables } from '../src/f10.ts';
import { applyCollectedToStore } from '../src/webCollect.ts';
import { composeReports } from '../src/reports.ts';
import type { F10Record } from '../src/f10.ts';

function rec(metric: string, period: string, value: number): F10Record {
  return { metric, period, value_raw: String(value), value_num: value };
}

const RECORDS: F10Record[] = [
  rec('净利润(元)', '2025-12-31', 100),
  rec('净利润(元)', '2026-03-31', 130),
  rec('净利润(元)', '2026-06-30', 260),
  rec('营业总收入(元)', '2025-12-31', 1000),
  rec('营业总收入(元)', '2026-03-31', 1100),
  rec('营业总收入(元)', '2026-06-30', 2200),
  rec('基本每股收益(元)', '2026-06-30', 1.5),
];

describe('composeReports(移植 Python reports.py 契约)', () => {
  it('pivot:每报告期一行,report_date %Y%m%d,指标字段映射', () => {
    const rows = composeReports('600036', '招商银行', RECORDS);
    expect(rows.map((r) => r.report_date)).toEqual(['20251231', '20260331', '20260630']);
    const latest = rows[rows.length - 1];
    expect(latest.fields.eps).toBe(1.5);
    expect(latest.fields.net_profit).toBe(260);
    expect(latest.fields.name).toBe('招商银行');
  });

  it('QoQ:相邻季度自算((本期-上期)/上期×100),首期 NaN', () => {
    const rows = composeReports('600036', '招商银行', RECORDS);
    // 100 → 130 = +30%;130 → 260 = +100%
    expect(rows[0].fields.net_profit_QoQ_rate).toBeNaN();
    expect(rows[1].fields.net_profit_QoQ_rate).toBeCloseTo(30, 6);
    expect(rows[2].fields.net_profit_QoQ_rate).toBeCloseTo(100, 6);
  });

  it('跨季缺报告期(间隔非 88~93 天)→ QoQ NaN,不按相邻期硬算', () => {
    const gaps: F10Record[] = [
      rec('净利润(元)', '2025-12-31', 100),
      rec('净利润(元)', '2026-06-30', 200), // 半年间隔 181 天
    ];
    const rows = composeReports('600036', '招商银行', gaps);
    expect(rows[1].fields.net_profit_QoQ_rate).toBeNaN();
  });

  it('除零 → NaN;负分母合法(净利润可为负)', () => {
    const neg: F10Record[] = [
      rec('净利润(元)', '2026-03-31', -50),
      rec('净利润(元)', '2026-06-30', -25), // (-25 - -50)/-50 = -50%(合法)
    ];
    const zeroPrev: F10Record[] = [
      rec('净利润(元)', '2026-03-31', 0),
      rec('净利润(元)', '2026-06-30', 100),
    ];
    const a = composeReports('x', 'x', neg);
    expect(a[1].fields.net_profit_QoQ_rate).toBeCloseTo(-50, 6);
    const b = composeReports('x', 'x', zeroPrev);
    expect(b[1].fields.net_profit_QoQ_rate).toBeNaN();
  });

  it('缺指标 → NaN;sales_gross_margin 恒 NaN、industry 恒空串', () => {
    const rows = composeReports('600036', '招商银行', [rec('净利润(元)', '2026-06-30', 260)]);
    const f = rows[0].fields as Record<string, unknown>;
    expect(f.eps).toBeNaN();
    expect(f.sales_gross_margin).toBeNaN();
    expect(f.industry).toBe('');
    expect(f.total_income_QoQ_rate).toBeNaN();
  });

  it('无可映射指标 / 空输入 → 空数组', () => {
    expect(composeReports('x', 'x', [rec('资产负债比率(%)', '2026-06-30', 60)])).toEqual([]);
    expect(composeReports('x', 'x', [])).toEqual([]);
  });
});

describe('真实 fixture 全链(300750 f10_hk.txt)', () => {
  const fixture = fs.readFileSync('test/fixtures/f10_hk.txt', 'utf8');

  it('F10 → 业绩报告非空,最新期 20260630 字段正确', () => {
    const records = parseFinanceIndicatorsAllTables(fixture);
    expect(records.length).toBeGreaterThan(0);
    const rows = composeReports('300750', '宁德时代', records);
    expect(rows.length).toBeGreaterThan(3);
    const latest = rows[rows.length - 1];
    expect(latest.report_date).toBe('20260630');
    expect((latest.fields.eps as number)).toBeCloseTo(9.51, 2);
    expect((latest.fields.net_profit_YoY_rate as number)).toBeCloseTo(41.9839, 3);
  });

  it('web 采集入库:applyCollectedToStore 带真实 F10 → 业绩报告入库', () => {
    const store = new InMemoryStore();
    applyCollectedToStore(store, {
      ticker: '300750',
      name: '宁德时代',
      bars: [{ date: '2026-06-30', open: 1, close: 1, high: 1, low: 1, volume: 1 }],
      snapshot: null,
      capitalText: '',
      f10Text: fixture,
    });
    const reports = store.getPerformanceReports('300750');
    expect(reports.length).toBeGreaterThan(3);
    expect(reports[reports.length - 1].report_date).toBe('20260630');
    expect(store.getMeta('f10:300750')).toContain('主要财务指标');
  });
});

describe('通达信词表(真实 TDX 服务器格式,600036 f10_tdx.txt)', () => {
  const tdx = fs.readFileSync('test/fixtures/f10_tdx.txt', 'utf8');

  it('归母净利/营业总收(万)→ ×10⁴ 归一为元;总营收同比 → YoY 字段', () => {
    const records = parseFinanceIndicatorsAllTables(tdx);
    const rows = composeReports('600036', '招商银行', records);
    expect(rows.length).toBeGreaterThan(3);
    const latest = rows[rows.length - 1];
    // 2026-03-31 期:归母净利 3785200.00 万 → 3.7852e10 元
    expect(latest.report_date).toBe('20260331');
    expect(latest.fields.net_profit as number).toBeCloseTo(3_785_200 * 10_000, 0);
    expect(latest.fields.total_income as number).toBeCloseTo(8_694_000 * 10_000, 0);
    expect(latest.fields.total_income_YoY_rate as number).toBeCloseTo(3.81, 2);
    expect(latest.fields.net_profit_YoY_rate as number).toBeCloseTo(1.52, 2);
  });

  it('相邻季 QoQ 自算(通达信词表同样生效)', () => {
    const records = parseFinanceIndicatorsAllTables(tdx);
    const rows = composeReports('600036', '招商银行', records);
    // 找一对相邻季度期(QoQ 非 NaN 的行)
    const withQoq = rows.filter((r) => !Number.isNaN(r.fields.net_profit_QoQ_rate));
    expect(withQoq.length).toBeGreaterThan(0);
    for (const r of withQoq) {
      expect(Number.isFinite(r.fields.net_profit_QoQ_rate)).toBe(true);
    }
  });
});
