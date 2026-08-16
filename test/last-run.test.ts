// lastRun 缓存模块单测 —— 见 PRD R1/R5/R6 与 design.md 数据契约节。
import { beforeEach, describe, expect, it } from 'vitest';
import type { FinalReport } from '../src/events.ts';
import { LAST_RUN_KEY, loadLastRun, saveLastRun } from '../src/lastRun.ts';
import { InMemoryStore } from '../src/store-memory.ts';

function report(over: Partial<FinalReport> = {}): FinalReport {
  return {
    ticker: '600036',
    stock_information: '招商银行 最新价 34.12,涨跌幅 +0.86%,换手率 0.21%',
    final_decision: '买入',
    opinions: [
      { key: 'analyst', tabTitle: '分析师', content: '基本面稳健,估值合理。' },
      { key: 'trader', tabTitle: '交易员', content: '技术面多头排列,量能配合。' },
    ],
    ...over,
  };
}

describe('lastRun 缓存 (R1/R5/R6)', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('round-trip:save 后 load 全字段相等(opinions 深度相等)', () => {
    const r = report();
    saveLastRun(store, r, 'real', '2026-08-16T14:23:00.000Z');
    const loaded = loadLastRun(store);
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual({
      ticker: r.ticker,
      stock_information: r.stock_information,
      final_decision: r.final_decision,
      opinions: r.opinions,
      at: '2026-08-16T14:23:00.000Z',
      mode: 'real',
    });
  });

  it('缺失键:未 save → load null', () => {
    expect(store.getMeta(LAST_RUN_KEY)).toBeNull();
    expect(loadLastRun(store)).toBeNull();
  });

  it('损坏 JSON:setMeta 手写非法串 → load null 且不抛', () => {
    store.setMeta(LAST_RUN_KEY, '{not-valid-json');
    expect(() => loadLastRun(store)).not.toThrow();
    expect(loadLastRun(store)).toBeNull();
  });

  it('字段缺失:合法 JSON 但缺 final_decision → null', () => {
    const r = report();
    const { final_decision: _omit, ...rest } = r;
    store.setMeta(LAST_RUN_KEY, JSON.stringify(rest));
    expect(loadLastRun(store)).toBeNull();
  });

  it('覆盖:两次 save 不同内容 → load 取最新', () => {
    saveLastRun(store, report({ ticker: '600036' }), 'demo', '2026-08-16T10:00:00.000Z');
    const second = report({ ticker: '000001', final_decision: '观望' });
    saveLastRun(store, second, 'real', '2026-08-16T15:30:00.000Z');
    const loaded = loadLastRun(store);
    expect(loaded?.ticker).toBe('000001');
    expect(loaded?.final_decision).toBe('观望');
    expect(loaded?.at).toBe('2026-08-16T15:30:00.000Z');
    expect(loaded?.mode).toBe('real');
  });

  it("mode 透传:'real' 与 'demo' 各一次", () => {
    saveLastRun(store, report(), 'real', '2026-08-16T10:00:00.000Z');
    expect(loadLastRun(store)?.mode).toBe('real');
    saveLastRun(store, report(), 'demo', '2026-08-16T11:00:00.000Z');
    expect(loadLastRun(store)?.mode).toBe('demo');
  });

  it('mode 非法值(校验) → null,不抛', () => {
    const r = report();
    store.setMeta(LAST_RUN_KEY, JSON.stringify({ ...r, at: '2026-08-16T10:00:00.000Z', mode: 'mystery' }));
    expect(() => loadLastRun(store)).not.toThrow();
    expect(loadLastRun(store)).toBeNull();
  });
});
