// RunHistoryController 直测 —— 补上「零直测」的缺口(评审 2026-11-21 第 5 项)。
//
// 该模块自带三份可变状态(historySeq / historyListSeq / liveStash)和一条
// 「打开历史 → 关闭历史」的正文替换链,此前只有经由 AnalysisController 的间接
// 覆盖,代数守卫与 stash 还原本身没有断言。这里用手写 deps + 内存归档直测契约。
import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/store-memory.ts';
import type { RunArchive } from '../app/lib/runArchive.ts';
import { RunHistoryController, type HistoryDeps, type HistoryState } from '../app/lib/historyController.ts';
import { createMemoryRunArchive } from './fixtures/memoryRunArchive.ts';
import type { AnalysisRun } from '../src/runHistory.ts';

function makeRun(over: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    at: '2026-11-20T10:00:00Z',
    mode: 'real',
    ticker: '600036',
    market: 'cn',
    stock_information: 'HIST_INFO',
    final_decision: 'HIST_DECISION',
    opinions: [{ key: 'fundamental_analysis', tabTitle: '基本面分析', content: 'HIST_OPINION' }],
    ...over,
  };
}

/** 只填被测代码真正读写的字段(HistorySlice),避免整份 AnalysisState 噪音。 */
function makeState(): HistoryState {
  return {
    events: [{ type: 'progress', message: 'LIVE_PROGRESS' } as HistoryState['events'][number]],
    finalDecision: 'LIVE_DECISION',
    stockInformation: 'LIVE_INFO',
    partials: { fundamental_analysis: 'LIVE_PARTIAL' },
    statuses: { fundamental_analysis: 'done' },
    hasDone: true,
    lastRunTicker: '600036',
    market: 'cn',
    error: 'LIVE_ERROR',
    history: [],
    historyLoading: false,
    historyError: null,
    viewingRun: null,
  };
}

function makeDeps(over: Partial<HistoryDeps> = {}): HistoryDeps & { logs: string[] } {
  const state = over.state ?? makeState();
  const logs: string[] = [];
  const log = {
    info: (m: string) => logs.push(`info:${m}`),
    warn: (m: string) => logs.push(`warn:${m}`),
    error: (m: string) => logs.push(`error:${m}`),
  };
  return {
    state,
    runArchive: over.runArchive ?? createMemoryRunArchive([makeRun()]),
    store: over.store ?? new InMemoryStore(),
    log: over.log ?? log,
    notify: over.notify ?? (() => {}),
    isRunning: over.isRunning ?? (() => false),
    logs,
  };
}

describe('RunHistoryController.openRun / closeRun', () => {
  it('openRun 用历史正文覆盖当前展示,closeRun 逐字段还原(含 error)', async () => {
    const deps = makeDeps();
    const ctl = new RunHistoryController(deps);

    await ctl.openRun('run-1');
    expect(deps.state.viewingRun?.id).toBe('run-1');
    expect(deps.state.finalDecision).toBe('HIST_DECISION');
    // 失败横幅必须退场:否则旧运行的错误文案盖在新正文上(LiveSlice 漏 error 的根因)
    expect(deps.state.error).toBeNull();

    ctl.closeRun();
    expect(deps.state.viewingRun).toBeNull();
    expect(deps.state.finalDecision).toBe('LIVE_DECISION');
    expect(deps.state.stockInformation).toBe('LIVE_INFO');
    expect(deps.state.partials).toEqual({ fundamental_analysis: 'LIVE_PARTIAL' });
    expect(deps.state.statuses).toEqual({ fundamental_analysis: 'done' });
    expect(deps.state.hasDone).toBe(true);
    expect(deps.state.error).toBe('LIVE_ERROR'); // ← 曾经的回归点
  });

  it('分析运行中拒绝打开历史(事件流会与历史正文混写)', async () => {
    const deps = makeDeps({ isRunning: () => true });
    const ctl = new RunHistoryController(deps);
    await ctl.openRun('run-1');
    expect(deps.state.viewingRun).toBeNull();
    expect(deps.state.finalDecision).toBe('LIVE_DECISION');
  });

  it('不存在的 id → historyError 落地,正文不动', async () => {
    const deps = makeDeps();
    const ctl = new RunHistoryController(deps);
    await ctl.openRun('nope');
    expect(deps.state.historyError).toBe('历史记录不存在或已损坏');
    expect(deps.state.finalDecision).toBe('LIVE_DECISION');
    expect(deps.state.viewingRun).toBeNull();
  });

  it('CR-03:先点 A 再点 B,A 的迟到 load 不得把用户拽回 A', async () => {
    // 闸门让 A 的 load 卡住,期间发起 B 并完成
    let openA: () => void = () => {};
    const gateA = new Promise<void>((resolve) => {
      openA = resolve;
    });
    const inner = createMemoryRunArchive([
      makeRun({ id: 'A', final_decision: 'DECISION_A' }),
      makeRun({ id: 'B', final_decision: 'DECISION_B' }),
    ]);
    const archive: RunArchive = {
      list: () => inner.list(),
      put: (r) => inner.put(r),
      remove: (ids) => inner.remove(ids),
      clear: () => inner.clear(),
      load: async (id) => {
        if (id === 'A') await gateA;
        return inner.load(id);
      },
    };
    const deps = makeDeps({ runArchive: archive });
    const ctl = new RunHistoryController(deps);

    const pendingA = ctl.openRun('A');
    await ctl.openRun('B');
    expect(deps.state.viewingRun?.id).toBe('B');
    openA();
    await pendingA;

    expect(deps.state.viewingRun?.id).toBe('B'); // 迟到者作废
    expect(deps.state.finalDecision).toBe('DECISION_B');
    expect(deps.state.historyLoading).toBe(false); // 陈旧收尾不得留转圈
  });

  it('S4:首次 openRun 在飞时点关闭 → 不留永久「载入中」', async () => {
    let openLoad: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openLoad = resolve;
    });
    const inner = createMemoryRunArchive([makeRun()]);
    const archive: RunArchive = {
      list: () => inner.list(),
      put: (r) => inner.put(r),
      remove: (ids) => inner.remove(ids),
      clear: () => inner.clear(),
      load: async (id) => {
        await gate;
        return inner.load(id);
      },
    };
    const deps = makeDeps({ runArchive: archive });
    const ctl = new RunHistoryController(deps);

    const pending = ctl.openRun('run-1');
    expect(deps.state.historyLoading).toBe(true);
    ctl.closeRun(); // 没有 viewingRun 可恢复
    expect(deps.state.historyLoading).toBe(false);
    openLoad();
    await pending;
    // 迟到的 load 不得把正文写进来
    expect(deps.state.viewingRun).toBeNull();
    expect(deps.state.finalDecision).toBe('LIVE_DECISION');
  });
});

describe('RunHistoryController.recordRun', () => {
  // P1（评审 2026-11-21）：recordRun 先把行入列再异步写盘。写盘失败时旧实现只记
  // 日志 —— 行留在列表里，而它从来没落过盘 → 点开必然「历史记录不存在或已损坏」。
  // 安卓模拟器实测：11 条历史里就是这么积出幽灵行的。
  const report = {
    ticker: '600036',
    stock_information: 'INFO',
    final_decision: 'DECISION',
    degraded: false,
    opinions: [{ key: 'fundamental_analysis', tabTitle: '基本面分析', content: 'OPINION' }],
  };

  it('写盘失败 → 刚入列的那行必须撒回，并报错', async () => {
    const archive: RunArchive = {
      ...createMemoryRunArchive(),
      put: async () => {
        throw new Error('disk full');
      },
    };
    const deps = makeDeps({ runArchive: archive });
    const ctl = new RunHistoryController(deps);

    ctl.recordRun(report, '2026-11-21T03:54:00.000Z', 'real');
    // 同步阶段：列表立即可见（UX 不变）
    expect(deps.state.history).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 0)); // 等 put 的 catch
    expect(deps.state.history).toHaveLength(0); // 幽灵行不留在列表里
    expect(deps.state.historyError).toContain('历史归档写入失败');
    expect(deps.logs.some((l) => l.startsWith('error:写历史归档失败'))).toBe(true);
  });

  it('写盘成功 → 行保留且可 openRun', async () => {
    const deps = makeDeps({ runArchive: createMemoryRunArchive() });
    const ctl = new RunHistoryController(deps);
    ctl.recordRun(report, '2026-11-21T03:54:00.000Z', 'real');
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.state.history).toHaveLength(1);
    await ctl.openRun(deps.state.history[0]!.id);
    expect(deps.state.historyError).toBeNull();
    expect(deps.state.finalDecision).toBe('DECISION');
  });
});

describe('RunHistoryController.refreshHistory / deleteRuns', () => {
  it('读盘失败 → historyError 落地且既有列表不被清空', async () => {
    const seed = createMemoryRunArchive([makeRun()]);
    const archive: RunArchive = {
      load: (id) => seed.load(id),
      put: (r) => seed.put(r),
      remove: (ids) => seed.remove(ids),
      clear: () => seed.clear(),
      list: async () => {
        throw new Error('索引损坏');
      },
    };
    const deps = makeDeps({ runArchive: archive });
    deps.state.history = [{ id: 'keep-me' } as HistoryState['history'][number]];
    const ctl = new RunHistoryController(deps);

    await ctl.refreshHistory();
    expect(deps.state.historyError).toBe('加载历史失败:索引损坏');
    expect(deps.state.history.map((h) => h.id)).toEqual(['keep-me']);
    expect(deps.state.historyLoading).toBe(false);
    expect(deps.logs.some((l) => l.startsWith('warn:'))).toBe(true); // 必须留痕
  });

  it('删除正在查看的条目 → 自动退出查看态并还原实时正文', async () => {
    const deps = makeDeps();
    const ctl = new RunHistoryController(deps);
    await ctl.openRun('run-1');
    expect(deps.state.viewingRun?.id).toBe('run-1');

    await ctl.deleteRuns(['run-1']);
    expect(deps.state.viewingRun).toBeNull();
    expect(deps.state.finalDecision).toBe('LIVE_DECISION');
  });
});
