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
  rec('净利润(元)', '2026-03-31', 130),
  rec('净利润(元)', '2026-06-30', 260),
  rec('净利润(元)', '2026-09-30', 360),
  rec('净利润(元)', '2026-12-31', 400),
  rec('营业总收入(元)', '2026-03-31', 1100),
  rec('营业总收入(元)', '2026-06-30', 2200),
  rec('营业总收入(元)', '2026-09-30', 3300),
  rec('营业总收入(元)', '2026-12-31', 4400),
  rec('基本每股收益(元)', '2026-12-31', 1.5),
];

describe('composeReports(移植 Python reports.py 契约)', () => {
  it('pivot:每报告期一行,report_date %Y%m%d,指标字段映射', () => {
    const rows = composeReports('600036', '招商银行', RECORDS);
    expect(rows.map((r) => r.report_date)).toEqual(['20260331', '20260630', '20260930', '20261231']);
    const latest = rows[rows.length - 1];
    expect(latest.fields.eps).toBe(1.5);
    expect(latest.fields.net_profit).toBe(400);
    expect(latest.fields.name).toBe('招商银行');
  });

  it('QoQ:累计值先还原单季再算环比(中报-Q1 / 三季报-中报 / 年报-三季报),首期 NaN', () => {
    const rows = composeReports('600036', '招商银行', RECORDS);
    // 单季:Q1=130,Q2=260-130=130,Q3=360-260=100,Q4=400-360=40
    expect(rows[0].fields.net_profit_QoQ_rate).toBeNaN();
    expect(rows[1].fields.net_profit_QoQ_rate).toBeCloseTo(0, 6);
    expect(rows[2].fields.net_profit_QoQ_rate).toBeCloseTo(((100 - 130) / 130) * 100, 6);
    expect(rows[3].fields.net_profit_QoQ_rate).toBeCloseTo(((40 - 100) / 100) * 100, 6);
  });

  it('跨年 12-31→03-31 无法还原上一年 Q4 → QoQ NaN(不得用累计值硬减)', () => {
    const crossYear: F10Record[] = [
      rec('净利润(元)', '2025-12-31', 100),
      rec('净利润(元)', '2026-03-31', 130),
    ];
    const rows = composeReports('600036', '招商银行', crossYear);
    expect(rows[1].fields.net_profit_QoQ_rate).toBeNaN();
    expect(rows[1].fields.net_profit_YoY_rate).toBeNaN(); // 无同比列时为 NaN
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
      rec('净利润(元)', '2026-06-30', -25), // 中报累计 -25 → Q2 单季 +25
    ];
    const zeroPrev: F10Record[] = [
      rec('净利润(元)', '2026-03-31', 0),
      rec('净利润(元)', '2026-06-30', 100),
    ];
    const a = composeReports('x', 'x', neg);
    // Q1 单季 -50 → Q2 单季 +25:(25 - -50)/-50 = -150%(负分母合法)
    expect(a[1].fields.net_profit_QoQ_rate).toBeCloseTo(-150, 6);
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

  it('跨年 12-31→03-31 先还原 Q4 单季再算 → +3.96%,不是 -74.8% 的假环比', () => {
    const records = parseFinanceIndicatorsAllTables(tdx);
    const rows = composeReports('600036', '招商银行', records);
    const q1 = rows.find((r) => r.report_date === '20260331')!;
    // 2025-12-31 全年 15018.1 亿 - 2025-09-30 三季报 11377.2 亿 = Q4 单季 3640.9 亿;
    // 2026-03-31 一季报 3785.2 亿 → (3785.2-3640.9)/3640.9 = +3.96%
    expect(q1.fields.net_profit_QoQ_rate).toBeCloseTo(3.9633, 3);
    expect(q1.fields.net_profit_QoQ_rate).not.toBeCloseTo(-74.79, 1);
    expect(q1.fields.total_income_QoQ_rate).toBeCloseTo(0.9615, 3);
  });
});
