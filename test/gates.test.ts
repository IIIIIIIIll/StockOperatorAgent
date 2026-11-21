// gates 时间门单测(S1 增补):marketToday 三时区(固定时间戳注入)+ asiaToday
// 委托逐字节一致 + resolveSkipGates market 分支(hk/us 恒 skipF10=false)。
// 既有 gates 用例在 store-gates.test.ts,零改动;resolveSkipGates 定义面在
// src/collector.ts(本文件跨模块消费其 market 参数,collector.test.ts 不动)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asiaToday, latestPastQuarterEnd, marketSessionClosed, marketToday } from '../src/gates.ts';
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

// P1-7 的"是否已收盘"判定此前**零直测** —— 只有一条依赖真实日历的集成路径
// (test/yahoo-collect.test.ts 的 P1-7 块),于是周末跑测试必红而无人发现。
// 这里直测 gates 层,把"交易日内部时刻 / 收盘边界 / 周末恒 true"钉成契约。
describe('marketSessionClosed(市场时区收盘判定)', () => {
  // 2026-08-20 = 周四;2026-08-21 = 周五;2026-08-22 = 周六;2026-08-23 = 周日
  const at = (iso: string): Date => new Date(iso);

  it('交易日盘中 → false(港市 10:00 / 美股开盘后)', () => {
    expect(marketSessionClosed('hk', at('2026-08-20T02:00:00Z'))).toBe(false); // 10:00 HKT
    expect(marketSessionClosed('cn', at('2026-08-20T02:00:00Z'))).toBe(false); // 10:00 CST
    expect(marketSessionClosed('us', at('2026-08-20T14:30:00Z'))).toBe(false); // 10:30 EDT
  });

  it('收盘边界:恰好到点即算已收盘(>= 而非 >)', () => {
    expect(marketSessionClosed('hk', at('2026-08-20T07:59:00Z'))).toBe(false); // 15:59 HKT
    expect(marketSessionClosed('hk', at('2026-08-20T08:00:00Z'))).toBe(true); // 16:00 HKT
    expect(marketSessionClosed('cn', at('2026-08-20T06:59:00Z'))).toBe(false); // 14:59 CST
    expect(marketSessionClosed('cn', at('2026-08-20T07:00:00Z'))).toBe(true); // 15:00 CST
  });

  it('收盘后 → true', () => {
    expect(marketSessionClosed('hk', at('2026-08-20T08:30:00Z'))).toBe(true); // 16:30 HKT
    expect(marketSessionClosed('cn', at('2026-08-20T08:30:00Z'))).toBe(true); // 16:30 CST
  });

  it('周末恒 true(即便时刻落在盘中)—— 这就是 P1-7 用例只能钉日期的原因', () => {
    expect(marketSessionClosed('hk', at('2026-08-22T02:00:00Z'))).toBe(true); // 周六 10:00
    expect(marketSessionClosed('hk', at('2026-08-23T02:00:00Z'))).toBe(true); // 周日 10:00
    expect(marketSessionClosed('cn', at('2026-08-22T02:00:00Z'))).toBe(true);
  });

  it('开市前(未到收盘)按现有语义返回 false —— 仅表达"尚未收盘",不等于"已开市"', () => {
    // 已知口径:本函数不建模开市时刻/集合竞价/半日市(见 src/gates.ts 注释)。
    // 记录现状是为了让调用方（P1 修复:lastDataUpdate 不再无条件盖今天）不会被误读。
    expect(marketSessionClosed('hk', at('2026-08-20T00:00:00Z'))).toBe(false); // 08:00 HKT
  });
});

describe('marketToday(at) 与注入时钟一致(消除两个时钟)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('at 参数决定"今天",与 setSystemTime 结果逐字节一致', () => {
    const at = new Date('2026-08-20T02:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(at);
    expect(marketToday('hk', at)).toBe(marketToday('hk'));
    expect(marketToday('us', at)).toBe(marketToday('us'));
  });

  it('at 跨日 → 输出跟随 at,不跟真实时钟', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z'));
    // 纽约 2026-08-19 22:00(前一日)vs 2026-08-20 12:00
    expect(marketToday('us', new Date('2026-08-20T02:00:00Z'))).toBe('2026-08-19');
    expect(marketToday('us', new Date('2026-08-20T16:00:00Z'))).toBe('2026-08-20');
  });
});
