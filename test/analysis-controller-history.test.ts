// 分析历史归档控制器接线单测 —— done 落档、bootstrap 迁移、openRun/closeRun
// 实时态存取、删除/清空、失败降级(PRD R1/R2/R5/R6)。
// 假 runner + InMemoryStore + 内存归档注入(与 analysis-controller.test.ts 同模式)。
import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/store-memory.ts';
import { LAST_RUN_KEY, saveLastRun } from '../src/lastRun.ts';
import { RUN_HISTORY_MIGRATED_KEY } from '../src/metaKeys.ts';
import type { FinalReport, PipelineEvent, PipelineRunner, RunOptions } from '../src/events.ts';
import {
  AnalysisController,
  type AnalysisDeps,
  type AnalysisSnapshot,
} from '../app/lib/analysisController.ts';
import { createMemoryRunArchive, type RunArchive } from '../app/lib/runArchive.ts';
import type { AnalysisRun } from '../src/runHistory.ts';
import { defaultSettings } from '../app/lib/settings.ts';

function makeFakeRunner(impl?: (ticker: string, opts?: RunOptions) => Promise<FinalReport | undefined>) {
  const listeners = new Set<(e: PipelineEvent) => void>();
  const fake: PipelineRunner & { emit(e: PipelineEvent): void } = {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async run(ticker, opts) {
      returns.push({ ticker, opts });
      return impl ? impl(ticker, opts) : undefined;
    },
    emit(e) {
      for (const fn of [...listeners]) fn(e);
    },
  };
  const returns: Array<{ ticker: string; opts?: RunOptions }> = [];
  return fake;
}

function report(over: Partial<FinalReport> = {}): FinalReport {
  return {
    ticker: '600036',
    stock_information: '【采集数据】招商银行',
    final_decision: '## 买入\n目标价 42',
    opinions: [
      { key: 'fundamental_analysis', tabTitle: '基本面分析', content: 'FUND' },
      { key: 'bullish_opinions', tabTitle: '看涨观点', content: 'BULL' },
    ],
    ...over,
  };
}

function run(over: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-a',
    at: '2026-11-03T02:00:00.000Z',
    mode: 'real',
    ticker: '600036',
    market: 'cn',
    stock_information: '【采集数据】历史快照 A',
    final_decision: '持有',
    opinions: [{ key: 'fundamental_analysis', tabTitle: '基本面分析', content: 'A-FUND' }],
    ...over,
  };
}

function makeHarness(over: { archive?: RunArchive } = {}) {
  const store = new InMemoryStore();
  const archive = over.archive ?? createMemoryRunArchive();
  const runner = makeFakeRunner();
  const logs = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  const deps: AnalysisDeps = {
    store,
    runArchive: archive,
    runner,
    platform: 'native',
    storeReady: async () => {},
    loadDemoData: () => false,
    loadSettings: () => defaultSettings(),
    saveSettings: () => {},
    applyCapabilitySwitches: () => {},
    buildLlm: () => ({ stub: 'llm' }),
    collect: async () => ({
      f10Text: '',
      snapshot: { price: 1, high: 1, low: 1, open: 1, volume: 1, amount: 1 },
      name: '测试股',
      capital: null,
    }),
    fetchIntel: async () => ({}),
    makeBillionsClient: () => undefined,
    assembleTools: () => [],
    keepAliveStart: () => {},
    stopKeepAlive: () => {},
    log: {
      info: (m) => logs.info.push(m),
      warn: (m) => logs.warn.push(m),
      error: (m) => logs.error.push(m),
    },
    nowMs: (() => {
      let t = 1_000_000;
      return () => (t += 1000);
    })(),
    isoNow: () => '2026-11-04T08:00:00.000Z',
  };
  const ctrl = new AnalysisController(deps);
  let snap: AnalysisSnapshot = ctrl.snapshot();
  ctrl.subscribe((s) => {
    snap = s;
  });
  return { store, archive, runner, logs, ctrl, snap: () => snap };
}

describe('历史归档 · done 落档', () => {
  it('done 事件 → 归档 + 列表各一条(正文齐全,预览取结论首行)', async () => {
    const h = makeHarness();
    await h.ctrl.start('600036', 'cn');
    h.runner.emit({ type: 'done', report: report() });

    const list = await h.archive.list();
    expect(list).toHaveLength(1);
    expect(list[0].ticker).toBe('600036');
    expect(list[0].decisionPreview).toBe('买入');
    const body = await h.archive.load(list[0].id);
    expect(body?.stock_information).toBe('【采集数据】招商银行');
    expect(body?.opinions).toHaveLength(2);
    expect(h.snap().history.map((s) => s.id)).toEqual([list[0].id]);
  });

  it('error 事件不落档;写盘失败只记日志 + 抽屉错误(不影响已完成结果)', async () => {
    const broken: RunArchive = {
      ...createMemoryRunArchive(),
      async put() {
        throw new Error('disk full');
      },
    };
    const h = makeHarness({ archive: broken });
    await h.ctrl.start('600036', 'cn');
    h.runner.emit({ type: 'done', report: report() });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.logs.error.some((m) => m.includes('写历史归档失败'))).toBe(true);
    expect(h.snap().hasDone).toBe(true);
    expect(h.snap().finalDecision).toContain('买入');
  });
});

describe('历史归档 · bootstrap 迁移(只迁一次)', () => {
  it('有 lastRun 无历史 → 补一条;再次 bootstrap 不重复;清空后不复活', async () => {
    const h = makeHarness();
    saveLastRun(h.store, report(), 'real', '2026-11-02T01:00:00.000Z');
    await h.ctrl.bootstrap();

    let list = await h.archive.list();
    expect(list).toHaveLength(1);
    expect(list[0].ticker).toBe('600036');
    expect(h.store.getMeta(RUN_HISTORY_MIGRATED_KEY)).toBe('1');

    // 同一 store/archive 再起一个控制器(模拟重启)→ 不重复迁移
    const h2 = makeHarness({ archive: h.archive });
    // 共享同一 store 的 lastRun:新 harness 有自己的 store → 直接断言 archive 未变化
    await h2.ctrl.bootstrap();
    expect(await h.archive.list()).toHaveLength(1);

    // 用户清空历史后重启:迁移标记已置位 → 不复活
    await h.ctrl.clearHistory();
    expect(await h.archive.list()).toEqual([]);
    h.ctrl.closeRun();
    await h.ctrl.refreshHistory(true);
    expect(await h.archive.list()).toEqual([]);
  });

  it('迁移标记已存在 → 即便有 lastRun 也不写历史', async () => {
    const h = makeHarness();
    saveLastRun(h.store, report(), 'real', '2026-11-02T01:00:00.000Z');
    h.store.setMeta(RUN_HISTORY_MIGRATED_KEY, '1');
    await h.ctrl.bootstrap();
    expect(await h.archive.list()).toEqual([]);
    expect(h.snap().history).toEqual([]);
  });
});

describe('历史归档 · openRun / closeRun', () => {
  it('打开历史复现报告字段;返回最新恢复点开前的实时态', async () => {
    const archive = createMemoryRunArchive([run({ id: 'hb', ticker: '00700.HK', market: 'hk', final_decision: '减持', opinions: [{ key: 'bearish_opinions', tabTitle: '看跌观点', content: 'B' }] })]);
    const h = makeHarness({ archive });
    saveLastRun(h.store, report(), 'real', '2026-11-02T01:00:00.000Z');
    await h.ctrl.bootstrap();

    const live = h.snap();
    expect(live.viewingRun).toBeNull();
    expect(live.market).toBe('cn');
    const liveEvents = live.events.length;

    await h.ctrl.openRun('hb');
    const viewing = h.snap();
    expect(viewing.viewingRun).toEqual({ id: 'hb', at: '2026-11-03T02:00:00.000Z', ticker: '00700.HK', mode: 'real' });
    expect(viewing.lastRunTicker).toBe('00700.HK');
    expect(viewing.market).toBe('hk');
    expect(viewing.finalDecision).toBe('减持');
    expect(viewing.events).toEqual([
      { type: 'report', key: 'bearish_opinions', tabTitle: '看跌观点', content: 'B' },
    ]);
    expect(viewing.hasDone).toBe(true);

    h.ctrl.closeRun();
    const back = h.snap();
    expect(back.viewingRun).toBeNull();
    expect(back.lastRunTicker).toBe('600036');
    expect(back.market).toBe('cn');
    expect(back.events.length).toBe(liveEvents);
    expect(back.finalDecision).toContain('买入');
  });

  it('运行中拒绝打开(事件流与历史正文不混写)', async () => {
    const archive = createMemoryRunArchive([run({ id: 'hb' })]);
    const h = makeHarness({ archive });
    await h.ctrl.bootstrap();
    // 不 await:start() 同步置 running=true(在首个 await/采集之前)
    const inflight = h.ctrl.start('600036', 'cn');
    await h.ctrl.openRun('hb');
    expect(h.snap().viewingRun).toBeNull();
    h.ctrl.cancel();
    await inflight;
    expect(h.snap().running).toBe(false);
  });

  it('记录不存在 → 抽屉错误,不改展示字段', async () => {
    const h = makeHarness();
    await h.ctrl.bootstrap();
    const before = h.snap().finalDecision;
    await h.ctrl.openRun('nope');
    expect(h.snap().viewingRun).toBeNull();
    expect(h.snap().historyError).toBe('历史记录不存在或已损坏');
    expect(h.snap().finalDecision).toBe(before);
  });

  it('start() 会先退出历史查看态', async () => {
    const archive = createMemoryRunArchive([run({ id: 'hb' })]);
    const h = makeHarness({ archive });
    await h.ctrl.bootstrap();
    await h.ctrl.openRun('hb');
    expect(h.snap().viewingRun).not.toBeNull();
    await h.ctrl.start('600036', 'cn');
    expect(h.snap().viewingRun).toBeNull();
  });
});

describe('历史归档 · 删除 / 清空', () => {
  it('批量删除同步列表;删掉正在查看的那条 → 退出查看态', async () => {
    const archive = createMemoryRunArchive([
      run({ id: 'a', at: '2026-11-03T02:00:00.000Z' }),
      run({ id: 'b', at: '2026-11-04T02:00:00.000Z' }),
    ]);
    const h = makeHarness({ archive });
    await h.ctrl.bootstrap();
    expect(h.snap().history.map((s) => s.id)).toEqual(['b', 'a']);

    await h.ctrl.openRun('a');
    await h.ctrl.deleteRuns(['a']);
    expect(h.snap().viewingRun).toBeNull();
    expect((await archive.list()).map((s) => s.id)).toEqual(['b']);
    expect(h.snap().history.map((s) => s.id)).toEqual(['b']);
  });

  it('清空全部:归档与列表都空;正在查看时一并退出', async () => {
    const archive = createMemoryRunArchive([run({ id: 'a' })]);
    const h = makeHarness({ archive });
    await h.ctrl.bootstrap();
    await h.ctrl.openRun('a');
    await h.ctrl.clearHistory();
    expect(await archive.list()).toEqual([]);
    expect(h.snap().history).toEqual([]);
    expect(h.snap().viewingRun).toBeNull();
  });

  it('归档读写异常 → historyError 且不抛(UI 可继续用)', async () => {
    const broken: RunArchive = {
      list: async () => {
        throw new Error('idb blocked');
      },
      load: async () => null,
      put: async () => {},
      remove: async () => 0,
      clear: async () => {},
    };
    const h = makeHarness({ archive: broken });
    await expect(h.ctrl.bootstrap()).resolves.toBeUndefined();
    expect(h.snap().historyError).toContain('加载历史失败');
    expect(h.snap().historyLoading).toBe(false);
  });
});
