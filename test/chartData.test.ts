// UI 补齐(B2/B3/B4)纯函数测试:日K 涨跌幅/换手率列值、涨跌幅柱数据过滤、
// 财务趋势图数据(N/A 跳过 + 空态)、业绩卡片销售毛利率。
import { describe, expect, it } from 'vitest';
import { changePercentSeries, turnoverPct } from '../src/pipeline.ts';
import { changePctHistData, financialTrendSeries, salesGrossMargin } from '../src/chartData.ts';
import type { DailyBar } from '../src/store.ts';
import type { F10Record } from '../src/f10.ts';

const UP = '#ff0000';
const DOWN = '#00ff00';

describe('changePercentSeries (日K 涨跌幅列,复用 pipeline 公式)', () => {
  const bars: DailyBar[] = [
    { date: '2026-08-03', open: 10, close: 10.5, high: 10.8, low: 9.9, volume: 1000 },
    { date: '2026-08-04', open: 10.5, close: 10.2, high: 10.6, low: 10.1, volume: 1200 },
    { date: '2026-08-05', open: 10.2, close: 10.7, high: 10.9, low: 10.0, volume: 900 },
  ];

  it('首根 NaN(无前值),其余按相邻收盘自算', () => {
    const pct = changePercentSeries(bars);
    expect(Number.isNaN(pct[0])).toBe(true);
    expect(pct[1]).toBeCloseTo(((10.2 - 10.5) / 10.5) * 100, 6);
    expect(pct[2]).toBeCloseTo(((10.7 - 10.2) / 10.2) * 100, 6);
  });

  it('空 bars → 空数组', () => {
    expect(changePercentSeries([])).toEqual([]);
  });
});

describe('turnoverPct (日K 换手率列,复用 pipeline 公式)', () => {
  const bar: DailyBar = { date: '2026-08-04', open: 10, close: 10.2, high: 10.6, low: 10.1, volume: 1_000_000 };
  const capital = { liutongguben: 1e9 };

  it('量(手)×10⁴/流通股本(股) = 换手率%', () => {
    expect(turnoverPct(bar, capital)).toBeCloseTo((1_000_000 * 10_000) / 1e9, 6);
  });

  it('缺股本 → NaN(表格显示 N/A,与 Python 一致)', () => {
    expect(Number.isNaN(turnoverPct(bar, null))).toBe(true);
    expect(Number.isNaN(turnoverPct(bar, { liutongguben: 0 }))).toBe(true);
  });
});

describe('changePctHistData (涨跌幅柱:NaN 过滤 + 正负着色)', () => {
  it('正红负绿;首根 NaN 过滤;0 归红(涨)', () => {
    const out = changePctHistData([NaN, 1.2, -0.5, 0], ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'], UP, DOWN);
    expect(out).toEqual([
      { time: '2026-08-04', value: 1.2, color: UP },
      { time: '2026-08-05', value: -0.5, color: DOWN },
      { time: '2026-08-06', value: 0, color: UP },
    ]);
  });

  it('非有限值(±Infinity)过滤;空输入 → 空数组', () => {
    expect(changePctHistData([Infinity, -Infinity, 2], ['a', 'b', 'c'], UP, DOWN)).toEqual([
      { time: 'c', value: 2, color: UP },
    ]);
    expect(changePctHistData([], [], UP, DOWN)).toEqual([]);
    expect(changePctHistData([NaN, NaN], ['a', 'b'], UP, DOWN)).toEqual([]);
  });

  it('values/dates 不等长 → 取较短一侧,不越界', () => {
    const out = changePctHistData([1, 2, 3], ['a', 'b'], UP, DOWN);
    expect(out).toHaveLength(2);
  });
});

describe('financialTrendSeries (财务跨期折线)', () => {
  it('净利润/每股收益取自 performance_reports,报告期转 YYYY-MM-DD', () => {
    const reports = [
      { report_date: '20260331', fields: { eps: 1.49, net_profit: 15200000000, sales_gross_margin: NaN } },
      { report_date: '20260630', fields: { eps: 2.9, net_profit: 31000000000, sales_gross_margin: NaN } },
    ];
    const out = financialTrendSeries(reports, []);
    expect(out.map((s) => s.label)).toEqual(['净利润', '每股收益']);
    const np = out.find((s) => s.label === '净利润')!;
    expect(np.points).toEqual([
      { time: '2026-03-31', value: 15200000000 },
      { time: '2026-06-30', value: 31000000000 },
    ]);
    const eps = out.find((s) => s.label === '每股收益')!;
    expect(eps.points[1]).toEqual({ time: '2026-06-30', value: 2.9 });
  });

  it('销售毛利率取自 F10 盈利能力节(reports 恒 NaN 时仍成线),F10 表列序新→旧仍升序输出', () => {
    const profit: F10Record[] = [
      { metric: '销售毛利率', period: '2026-06-30', value_raw: '45.2', value_num: 45.2 },
      { metric: '销售毛利率', period: '2026-03-31', value_raw: '44.8', value_num: 44.8 },
      { metric: '销售净利率', period: '2026-06-30', value_raw: '30.0', value_num: 30.0 },
    ];
    const out = financialTrendSeries([], profit);
    expect(out.map((s) => s.label)).toEqual(['销售毛利率']);
    expect(out[0].points).toEqual([
      { time: '2026-03-31', value: 44.8 },
      { time: '2026-06-30', value: 45.2 },
    ]);
  });

  it('N/A 期跳过(非数值字段/NaN);某指标全 N/A → 该线省略', () => {
    const reports = [
      { report_date: '20260331', fields: { eps: 'n/a' as unknown as number, net_profit: NaN, sales_gross_margin: NaN } },
      { report_date: '20260630', fields: { eps: 2.9, net_profit: NaN, sales_gross_margin: NaN } },
    ];
    const out = financialTrendSeries(reports, []);
    expect(out.map((s) => s.label)).toEqual(['每股收益']);
    expect(out[0].points).toEqual([{ time: '2026-06-30', value: 2.9 }]);
  });

  it('空数据 → [] (财务图不渲染不崩)', () => {
    expect(financialTrendSeries([], [])).toEqual([]);
  });
});

describe('salesGrossMargin (业绩卡片销售毛利率)', () => {
  const profit: F10Record[] = [
    { metric: '销售毛利率', period: '2026-03-31', value_raw: '44.8', value_num: 44.8 },
    { metric: '销售毛利率', period: '2026-06-30', value_raw: '45.2', value_num: 45.2 },
  ];

  it('按报告期(YYYYMMDD)匹配 F10 期(YYYY-MM-DD)返回 %;缺失 → NaN', () => {
    expect(salesGrossMargin(profit, '20260331')).toBeCloseTo(44.8, 6);
    expect(salesGrossMargin(profit, '20260630')).toBeCloseTo(45.2, 6);
    expect(Number.isNaN(salesGrossMargin(profit, '20251231'))).toBe(true);
  });

  it('该期毛利率为 N/A(value_num NaN)→ NaN', () => {
    const profitWithNa: F10Record[] = [
      { metric: '销售毛利率', period: '2026-03-31', value_raw: '---', value_num: NaN },
    ];
    expect(Number.isNaN(salesGrossMargin(profitWithNa, '20260331'))).toBe(true);
  });
});
