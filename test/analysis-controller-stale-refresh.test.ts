// S5-1(评审 2026-11-08):在飞的 refreshHistory 快照过期守卫 —— 判别性用例。
//
// 评审当时记的是「本 harness 构造不出可区分的回归用例」,所以只留了守卫没留测试。
// 实际上可以:把 runArchive.list() 换成「手动 resolve 的 Promise」,就能精确制造
// 「list() 还没返回 → 用户先删了 → 才拿到陈旧快照」这个真实时序,无需多点竞速。
//
// 两个用例都做过判别性验证:注释里写明删掉哪一行守卫会让它变红。
import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/store-memory.ts';
import type { PipelineRunner } from '../src/events.ts';
import { AnalysisController, type AnalysisDeps, type AnalysisSnapshot } from '../app/lib/analysisController.ts';
import type { RunArchive } from '../app/lib/runArchive.ts';
import type { RunSummary } from '../src/runHistory.ts';
import { defaultSettings } from '../app/lib/settings.ts';

function runSummary(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-a',
    at: '2026-11-03T02:00:00.000Z',
    mode: 'real',
    ticker: '600036',
    market: 'cn',
    decisionPreview: '持有',
    ...over,
  };
}

/** list() 可手动 resolve 的归档:用来把「读盘期间」这个窗口拉长到确定。 */
function makeDeferredArchive() {
  const pending: Array<(list: RunSummary[]) => void> = [];
  const removed: string[] = [];
  const archive: RunArchive = {
    list: () => new Promise<RunSummary[]>((resolve) => pending.push(resolve)),
    load: async () => null,
    put: async () => {},
    remove: async (ids) => {
      removed.push(...ids);
      return ids.length;
    },
    clear: async () => {},
  };
  return {
    archive,
    removed,
    /** 放行第 n 个尚未返回的 list() */
    resolveNext(list: RunSummary[]) {
      const next = pending.shift();
      if (!next) throw new Error('没有在飞的 list() 调用');
      next(list);
    },
    pendingCount: () => pending.length,
  };
}

function makeController(archive: RunArchive) {
  const store = new InMemoryStore();
  const logs = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  const deps: AnalysisDeps = {
    store,
    runArchive: archive,
    runner: {
      subscribe: () => () => {},
      run: async () => undefined,
    } satisfies PipelineRunner,
    platform: 'rn',
    storeReady: async () => {},
    loadDemoData: () => false,
    loadSettings: () => defaultSettings(),
    saveSettings: () => {},
    applyCapabilitySwitches: () => {},
    buildLlm: () => ({ stub: 'llm' }),
    collect: async (ticker: string) => ({
      ticker,
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
      info: (m: string) => logs.info.push(m),
      warn: (m: string) => logs.warn.push(m),
      error: (m: string) => logs.error.push(m),
    },
    nowMs: () => 1_000_000,
    isoNow: () => '2026-11-04T08:00:00.000Z',
  };
  const ctrl = new AnalysisController(deps);
  let snap: AnalysisSnapshot = ctrl.snapshot();
  ctrl.subscribe((s) => {
    snap = s;
  });
  return { ctrl, logs, snap: () => snap };
}

/** 列表按 id 排序取,避免依赖 mergeRunSummaries 的合并顺序。
 *  注意取的是**实时 state**(ctrl.snapshot()),不是订阅缓存的 snap ——
 *  陈旧刷新在 finally 里不 notify,缓存快照看不到它写进去的东西,
 *  用它断言会得到「删掉守卫也绿」的假用例(已实测)。 */
const ids = (h: { ctrl: { snapshot(): AnalysisSnapshot } }) =>
  h.ctrl.snapshot().history.map((x) => x.id).sort();

/** 让已完成的 Promise 链跑完(refreshHistory 的 await 之后还有几跳)。 */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('S5-1 · 陈旧 refreshHistory 快照', () => {
  it('读盘期间删除 → 陈旧快照不得复活已删除的行', async () => {
    const d = makeDeferredArchive();
    const h = makeController(d.archive);

    // 先用一次正常刷新把两行放进 s.history
    const seed = h.ctrl.refreshHistory();
    d.resolveNext([runSummary({ id: 'run-a' }), runSummary({ id: 'run-b' })]);
    await seed;
    expect(ids(h)).toEqual(['run-a', 'run-b']);

    // 第二次刷新:list() 挂着不返回 —— 这段时间用户删掉了 run-a
    const inFlight = h.ctrl.refreshHistory();
    await flush();
    expect(d.pendingCount()).toBe(1);
    await h.ctrl.deleteRuns(['run-a']);
    expect(ids(h)).toEqual(['run-b']);

    // 现在才放行那份「磁盘读到的」陈旧快照(里面仍有 run-a)
    d.resolveNext([runSummary({ id: 'run-a' }), runSummary({ id: 'run-b' })]);
    await inFlight;

    // 去掉 analysisController.ts 里 `if (seq !== this.historyListSeq) return;`
    // 这一行,mergeRunSummaries 会把 run-a 拼回来 → 本断言变红(已实测)。
    expect(ids(h)).toEqual(['run-b']);
    // 删除后 run-a 读盘仍在,但 UI 不能显示它 → 用户点开必然「记录不存在」。
    expect(d.removed).toEqual(['run-a']);
  });

  it('两轮刷新交错 → 陈旧那轮的收尾不得清掉新一轮的 loading', async () => {
    const d = makeDeferredArchive();
    const h = makeController(d.archive);

    const first = h.ctrl.refreshHistory(); // 代数 1
    await flush();
    const second = h.ctrl.refreshHistory(); // 代数 2(用户手动重试)
    await flush();
    expect(h.snap().historyLoading).toBe(true);
    expect(d.pendingCount()).toBe(2);

    // 先放行旧那轮:它的 finally 若不加 seq 判断,会把 loading 清零
    d.resolveNext([runSummary({ id: 'run-a' })]);
    await first;
    expect(h.snap().historyLoading).toBe(true);

    // 新一轮落地后才允许收圈
    d.resolveNext([runSummary({ id: 'run-a' }), runSummary({ id: 'run-b' })]);
    await second;
    expect(h.snap().historyLoading).toBe(false);
    expect(ids(h)).toEqual(['run-a', 'run-b']);
  });
});
