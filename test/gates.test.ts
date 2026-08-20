// gates 时间门单测(S1 增补):marketToday 三时区(固定时间戳注入)+ asiaToday
// 委托逐字节一致 + resolveSkipGates market 分支(hk/us 恒 skipF10=false)。
// 既有 gates 用例在 store-gates.test.ts,零改动;resolveSkipGates 定义面在
// src/collector.ts(本文件跨模块消费其 market 参数,collector.test.ts 不动)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asiaToday, latestPastQuarterEnd, marketToday } from '../src/gates.ts';
import { resolveSkipGates } from '../src/collector.ts';
import { InMemoryStore } from '../src/store-memory.ts';
import type { StoreLike } from '../src/store.ts';

const TICKER = '600036';

function freshStore(): StoreLike {
  return new InMemoryStore();
}

describe('marketToday', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('固定锚点 2026-08-20T02:00:00Z:上海/香港同日(10:00),纽约跨日(8/19 22:00)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z'));
    expect(marketToday('cn')).toBe('2026-08-20');
    expect(marketToday('hk')).toBe('2026-08-20'); // 香港与上海同为 UTC+8
    expect(marketToday('us')).toBe('2026-08-19'); // 纽约 EDT(UTC-4)跨日
  });

  it('固定锚点 2026-08-20T23:30:00Z:上海/香港已跨日(8/21),纽约仍同日(8/20)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T23:30:00Z'));
    expect(marketToday('cn')).toBe('2026-08-21');
    expect(marketToday('hk')).toBe('2026-08-21');
    expect(marketToday('us')).toBe('2026-08-20');
  });

  it('2-digit 补零:个位日/月输出 YYYY-MM-DD 全零填充', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T02:00:00Z')); // 上海 8/05
    expect(marketToday('cn')).toBe('2026-08-05');
    expect(marketToday('hk')).toBe('2026-08-05');
    expect(marketToday('us')).toBe('2026-08-04'); // 纽约 8/04 22:00 EDT
  });

  it('asiaToday 委托 marketToday(cn):同一瞬间输出逐字节一致', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z'));
    expect(asiaToday()).toBe(marketToday('cn'));
    expect(asiaToday()).toBe('2026-08-20');
  });
});

describe('resolveSkipGates market 分支', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hk:同日 lastDataUpdate → skipDaily true;同季业绩仍 skipF10 恒 false', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z')); // 香港今天 2026-08-20
    const store = freshStore();
    store.putStock({
      ticker: '00700',
      name: '腾讯控股',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: '2026-08-20',
    });
    store.addPerformanceReports('00700', [{ report_date: '20260630', fields: {} }]); // 同季 → f10Fresh 本为 true
    expect(resolveSkipGates(store, '00700', undefined, 'hk')).toEqual({
      skipDaily: true,
      skipF10: false,
      skipped: ['日K(同日已采集)'],
    });
  });

  it('hk:opts.skipF10 显式 true 也被忽略,恒 false(Yahoo 全量拉取 + PK 幂等)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z'));
    const store = freshStore();
    store.putStock({
      ticker: '09988',
      name: '阿里巴巴-W',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: '2026-08-19', // 跨日 → skipDaily false
    });
    store.addPerformanceReports('09988', [
      { report_date: latestPastQuarterEnd(marketToday('hk'))!, fields: {} },
    ]);
    expect(resolveSkipGates(store, '09988', { skipF10: true }, 'hk')).toEqual({
      skipDaily: false,
      skipF10: false,
      skipped: [],
    });
  });

  it('us:同日 skipDaily true;skipF10 恒 false(纽约时区判定)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z')); // 纽约今天 2026-08-19
    const store = freshStore();
    store.putStock({
      ticker: 'AAPL',
      name: 'Apple',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: '2026-08-19',
    });
    store.addPerformanceReports('AAPL', [{ report_date: '20260630', fields: {} }]);
    expect(resolveSkipGates(store, 'AAPL', undefined, 'us')).toEqual({
      skipDaily: true,
      skipF10: false,
      skipped: ['日K(同日已采集)'],
    });
  });

  it('cn 回归:同日日K + 同季业绩均跳过(与既有行为一致)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z'));
    const store = freshStore();
    store.putStock({
      ticker: TICKER,
      name: '招商银行',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: '2026-08-20',
    });
    store.addPerformanceReports(TICKER, [{ report_date: '20260630', fields: {} }]);
    expect(resolveSkipGates(store, TICKER, undefined, 'cn')).toEqual({
      skipDaily: true,
      skipF10: true,
      skipped: ['日K(同日已采集)', 'F10财务分析(同季已入库)'],
    });
    // 缺省 market 参数 → 等同 cn(调用方零改动)
    expect(resolveSkipGates(store, TICKER)).toEqual({
      skipDaily: true,
      skipF10: true,
      skipped: ['日K(同日已采集)', 'F10财务分析(同季已入库)'],
    });
  });

  it('cn:opts 显式布尔仍覆盖自动判定(既有契约不变)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z'));
    const store = freshStore();
    store.putStock({
      ticker: TICKER,
      name: '招商银行',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: '2026-08-20',
    });
    store.addPerformanceReports(TICKER, [{ report_date: '20260630', fields: {} }]);
    expect(resolveSkipGates(store, TICKER, { skipDaily: false, skipF10: false }, 'cn')).toEqual({
      skipDaily: false,
      skipF10: false,
      skipped: [],
    });
  });
});
