import { describe, expect, it } from 'vitest';
import { financialTrendSeries } from '/home/tan/StockOperatorAgent/src/chartData.ts';

// S4-3(评审 2026-11-08):净利润/每股收益曾按调用方顺序裸推,而同函数里毛利率/ROE
// 都显式升序 —— lightweight-charts 要求 time 升序,store 顺序变了就会抛。
describe('chartData · 财务序列时间升序(S4-3)', () => {
  it('乱序 reports → 净利润/每股收益均为升序', () => {
    const reports = [
      { report_date: '20260630', fields: { net_profit: 3e8, eps: 3 } },
      { report_date: '20260331', fields: { net_profit: 1e8, eps: 1 } },
      { report_date: '20260930', fields: { net_profit: 4e8, eps: 4 } },
      { report_date: '20251231', fields: { net_profit: 2e8, eps: 2 } },
    ];
    const series = financialTrendSeries(reports, [], 'cn');
    for (const s of series) {
      const times = s.points.map((p) => p.time);
      expect(times, s.label).toEqual([...times].sort());
    }
  });
});
