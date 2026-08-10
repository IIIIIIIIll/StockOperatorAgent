import { describe, expect, it } from 'vitest';
import { Store, type DailyBar } from '../src/store.ts';
import {
  FetchScope,
  getLastBusinessDay,
  latestPastQuarterEnd,
  overviewNeedsRefresh,
  reportsFresh,
} from '../src/gates.ts';

function bars(dates: string[]): DailyBar[] {
  return dates.map((date) => ({ date, open: 1, close: 2, high: 3, low: 0.5, volume: 100 }));
}

describe('store (AC4)', () => {
  it('put/get round-trips overview and name', () => {
    const s = new Store();
    s.putStock({ ticker: '600036', name: '招商银行', overview: { latest_price: 38.8 }, overviewLastUpdate: '2026-08-07', lastDataUpdate: null });
    const r = s.getStock('600036');
    expect(r?.name).toBe('招商银行');
    expect(r?.overview).toEqual({ latest_price: 38.8 });
    s.close();
  });

  it('addDatas rejects bars not newer than last_data_update (align Python add_data)', () => {
    const s = new Store();
    s.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    expect(s.addDatas('T', bars(['2026-01-01', '2026-01-02']))).toBe(2);
    expect(s.getDatas('T')).toHaveLength(2);
    // 全部重复 → 0，不写
    expect(s.addDatas('T', bars(['2026-01-01', '2026-01-02']))).toBe(0);
    expect(s.getDatas('T')).toHaveLength(2);
    // 部分新增
    expect(s.addDatas('T', bars(['2026-01-02', '2026-01-03']))).toBe(1);
    expect(s.getDatas('T')).toHaveLength(3);
    expect(s.getStock('T')?.lastDataUpdate).toBe('2026-01-03');
    s.close();
  });

  it('replaceDatas:全量替换(旧行删除 + last_data_update 更新,单事务)', () => {
    const s = new Store();
    s.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    s.addDatas('T', bars(['2026-01-01', '2026-01-02']));
    expect(s.replaceDatas('T', bars(['2026-02-01', '2026-02-02', '2026-02-03']))).toBe(3);
    const got = s.getDatas('T');
    expect(got).toHaveLength(3); // 旧 01-01/01-02 不残留
    expect(got[0].date).toBe('2026-02-01');
    expect(s.getStock('T')?.lastDataUpdate).toBe('2026-02-03');
    s.close();
  });

  it('addPerformanceReports dedupes by report_date, single transaction', () => {
    const s = new Store();
    s.addPerformanceReports('T', [
      { report_date: '20260331', fields: { net_profit: 1 } },
      { report_date: '20260630', fields: { net_profit: 2 } },
    ]);
    expect(s.addPerformanceReports('T', [
      { report_date: '20260331', fields: { net_profit: 99 } }, // 重复
      { report_date: '20260930', fields: { net_profit: 3 } },
    ])).toBe(1);
    const reports = s.getPerformanceReports('T');
    expect(reports.map((r) => r.report_date)).toEqual(['20260331', '20260630', '20260930']);
    expect(reports[0].fields).toEqual({ net_profit: 1 });
    s.close();
  });

  it('meta get/set persists', () => {
    const s = new Store();
    expect(s.getMeta('x')).toBeNull();
    s.setMeta('x', 'v');
    expect(s.getMeta('x')).toBe('v');
    s.close();
  });
});

describe('gates (AC5)', () => {
  it('getLastBusinessDay: Sat→Fri, Sun→Fri, weekday→same', () => {
    // 2026-08-07 = Friday, 08-08 = Saturday, 08-09 = Sunday, 08-10 = Monday
    expect(getLastBusinessDay('2026-08-07')).toBe('2026-08-07');
    expect(getLastBusinessDay('2026-08-08')).toBe('2026-08-07');
    expect(getLastBusinessDay('2026-08-09')).toBe('2026-08-07');
    expect(getLastBusinessDay('2026-08-10')).toBe('2026-08-10');
  });

  it('overviewNeedsRefresh: null → true; same business day → false; older → true', () => {
    expect(overviewNeedsRefresh(null, '2026-08-10')).toBe(true);
    expect(overviewNeedsRefresh('2026-08-10', '2026-08-10')).toBe(false); // 同日幂等
    // 2026-08-07 周五 < 2026-08-10 周一（最近交易日）→ 跨交易日必刷新
    expect(overviewNeedsRefresh('2026-08-07', '2026-08-10')).toBe(true);
    expect(overviewNeedsRefresh('2026-08-06', '2026-08-10')).toBe(true);
  });

  it('latestPastQuarterEnd picks most recent passed quarter end', () => {
    expect(latestPastQuarterEnd('2026-08-10')).toBe('20260630');
    expect(latestPastQuarterEnd('2026-07-01')).toBe('20260630');
    expect(latestPastQuarterEnd('2026-06-30')).toBe('20260630');
    expect(latestPastQuarterEnd('2026-06-29')).toBe('20260331');
    expect(latestPastQuarterEnd('2026-01-15')).toBe('20251231');
  });

  it('reportsFresh: latest == past quarter end → fresh', () => {
    expect(reportsFresh('20260630', '2026-08-10')).toBe(true);
    expect(reportsFresh('20260331', '2026-08-10')).toBe(false); // 未披露当期 → 不新鲜
    expect(reportsFresh(null, '2026-08-10')).toBe(false);
  });

  it('FetchScope reuses by requested size, not actual rows', () => {
    const s = new FetchScope();
    expect(s.canReuse('daily:600036', 250)).toBe(false);
    s.record('daily:600036', 250); // 请求 250 拉过（即使实际行数 < 250 也算满足）
    expect(s.canReuse('daily:600036', 250)).toBe(true);
    expect(s.canReuse('daily:600036', 800)).toBe(false); // 更大请求 → 不满足
    s.record('daily:600036', 800);
    expect(s.canReuse('daily:600036', 800)).toBe(true);
    // 短历史股票：请求 250 拉取实际返回 120 行——按请求尺寸判定仍满足 250
    expect(s.canReuse('daily:600036', 250)).toBe(true);
  });
});
