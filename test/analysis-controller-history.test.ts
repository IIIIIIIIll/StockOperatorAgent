// 分析历史归档控制器接线单测 —— done 落档、bootstrap 迁移、openRun/closeRun
// 实时态存取、删除/清空、失败降级(PRD R1/R2/R5/R6)。
// 假 runner + InMemoryStore + 内存归档注入(与 analysis-controller.test.ts 同模式)。
import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/store-memory.ts';
import { saveLastRun } from '../src/lastRun.ts';
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

function makeHarness(over: { archive?: RunArchive; runner?: PipelineRunner & { emit(e: PipelineEvent): void }; store?: InMemoryStore } = {}) {
  const store = over.store ?? new InMemoryStore();
  const archive = over.archive ?? createMemoryRunArchive();
  const runner = over.runner ?? makeFakeRunner();
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

    // 同一 store + 同一 archive 再起一个控制器(= 重启,共享 lastRun 与标记)
    // R-07:原来的 h2 用的是新 InMemoryStore → 根本没有 lastRun,迁移即使被
    // 重复执行也看不出来。这里必须传同一个 store。
    const h2 = makeHarness({ archive: h.archive, store: h.store });
    await h2.ctrl.bootstrap();
    expect(await h.archive.list()).toHaveLength(1);

    // 用户清空历史后重启:迁移标记已置位 → 不复活(删掉标记检查这条会红)
    await h.ctrl.clearHistory();
    expect(await h.archive.list()).toEqual([]);
    const h3 = makeHarness({ archive: h.archive, store: h.store });
    await h3.ctrl.bootstrap();
    expect(await h.archive.list()).toEqual([]);
    expect(h3.snap().history).toEqual([]);
  });

  // R-08:迁移写盘失败的半成品态 —— 只 warn、不置标记、下次启动还能再试。
  it('迁移写盘失败 → 不置标记,下次启动重试成功', async () => {
    const base = createMemoryRunArchive();
    let deny = true;
    const flaky: RunArchive = {
      ...base,
      async put(r) {
        if (deny) throw new Error('quota exceeded');
        return base.put(r);
      },
    };
    const h = makeHarness({ archive: flaky });
    saveLastRun(h.store, report(), 'real', '2026-11-02T01:00:00.000Z');
    await h.ctrl.bootstrap();

    expect(h.logs.warn.some((m) => m.includes('历史迁移失败'))).toBe(true);
    expect(h.store.getMeta(RUN_HISTORY_MIGRATED_KEY)).toBeNull(); // 未置标记 → 下次再试
    expect(await flaky.list()).toEqual([]);
    expect(h.snap().historyError).toBeNull(); // 迁移失败不得污染抽屉错误

    deny = false;
    const h2 = makeHarness({ archive: flaky, store: h.store });
    await h2.ctrl.bootstrap();
    expect((await flaky.list()).map((s) => s.id).length).toBe(1);
    expect(h.store.getMeta(RUN_HISTORY_MIGRATED_KEY)).toBe('1');
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

  // R-01(docs/code-review-2026-11-05.md P0):applyReportBody 不清 partials →
  // ReportContent 的 `partial || fallback` 让取消那次的半截草稿盖住归档正文。
  it('取消后的流式分片不得盖住历史正文;closeRun 仍能恢复实时分片', async () => {
    const archive = createMemoryRunArchive([
      run({ id: 'hb', final_decision: '持有', opinions: [{ key: 'fundamental_analysis', tabTitle: '基本面分析', content: 'A-FUND' }] }),
    ]);
    const h = makeHarness({ archive });
    await h.ctrl.bootstrap();
    // 不 await:start() 同步置 running=true(取消需要 running 态)
    const inflight = h.ctrl.start('600036', 'cn');
    h.runner.emit({ type: 'token', roleKey: 'final_decision', node: 'investment_manager', delta: '半截经理草稿' });
    h.runner.emit({ type: 'token', roleKey: 'fundamental_analysis', node: 'fundamental_analysis_expert', delta: '半截基本面' });
    h.ctrl.cancel();
    await inflight;
    // 取消有意保留分片(实时视图显示最后进度)
    const cancelled = { investment_manager: '半截经理草稿', fundamental_analysis_expert: '半截基本面' };
    expect(h.snap().partials).toEqual(cancelled);

    await h.ctrl.openRun('hb');
    // 回归点:历史查看态读不到任何实时分片 → 槽位回落到归档正文
    expect(h.snap().partials).toEqual({});
    expect(h.snap().finalDecision).toBe('持有');
    expect(h.snap().events).toEqual([
      { type: 'report', key: 'fundamental_analysis', tabTitle: '基本面分析', content: 'A-FUND' },
    ]);

    h.ctrl.closeRun();
    expect(h.snap().partials).toEqual(cancelled);
  });

  // R-02(同评审 P1):进函数时那次 running 检查在 await 之前 → 读盘期间发起的新分析
  // 会被随后落地的历史正文覆盖(events/decision 混写)。
  it('读盘期间发起新分析 → 历史正文不得盖到实时运行上', async () => {
    let releaseLoad!: () => void;
    const gate = new Promise<void>((r) => {
      releaseLoad = r;
    });
    const base = createMemoryRunArchive([run({ id: 'hb', final_decision: '持有' })]);
    const slow: RunArchive = {
      ...base,
      async load(id: string) {
        const out = await base.load(id);
        await gate; // 读盘挂住:模拟用户在 await 期间点了「开始分析」
        return out;
      },
    };
    let settleRun!: (r?: FinalReport) => void;
    const pending = makeFakeRunner(() => new Promise<FinalReport | undefined>((r) => {
      settleRun = r;
    }));
    const h = makeHarness({ archive: slow, runner: pending });
    await h.ctrl.bootstrap();

    const opening = h.ctrl.openRun('hb');
    const inflight = h.ctrl.start('600036', 'cn'); // start 同步置 running=true
    releaseLoad();
    await opening;

    expect(h.snap().viewingRun).toBeNull();
    expect(h.snap().finalDecision).toBe(''); // start() 的重置没被历史正文盖回
    expect(h.snap().events).toEqual([]);

    h.ctrl.cancel();
    settleRun(undefined);
    await inflight;
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

describe('历史归档 · 列表刷新(R-03)', () => {
  // R-03:list() 的快照不含刷新期间新落档的运行(recordRun 已 prepend 进 s.history)
  // → 直接赋值会把刚完成的运行从抽屉与 ☰ 徽标里抹掉,直到下一次刷新。
  it('刷新期间完成的运行不被陈旧的 list 快照覆盖', async () => {
    let releaseList!: () => void;
    const gate = new Promise<void>((r) => {
      releaseList = r;
    });
    const base = createMemoryRunArchive();
    let calls = 0;
    const gated: RunArchive = {
      ...base,
      async list() {
        calls += 1;
        const snapshot = await base.list(); // 先取快照(此时还没有本次运行)
        if (calls >= 2) await gate;         // 第 2 次刷新:快照取完再挂住
        return snapshot;
      },
    };
    const h = makeHarness({ archive: gated });
    await h.ctrl.bootstrap(); // 第 1 次 list:不挂

    const refreshing = h.ctrl.refreshHistory(); // 第 2 次:拿到 [] 后挂住
    await h.ctrl.start('600036', 'cn');
    h.runner.emit({ type: 'done', report: report() }); // 刷新途中完成
    expect(h.snap().history).toHaveLength(1);
    const doneId = h.snap().history[0].id;

    releaseList();
    await refreshing;
    expect(h.snap().history.map((s) => s.id)).toEqual([doneId]);
  });
});
