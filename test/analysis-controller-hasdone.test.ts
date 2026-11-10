// AnalysisController D15 补充单元 —— 失败运行终态(AC5:错误后 running=false ∧
// hasDone=false,App「✓分析完成」横幅门关闭)与 restore 路径 hasDone 置位点。
// 独立文件避免与 test/analysis-controller.test.ts(TQ1 后续回填)冲突;
// 假 runner/InMemoryStore 注入模式与其一致。
import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/store-memory.ts';
import type { StoreLike } from '../src/store.ts';
import { LAST_RUN_KEY } from '../src/lastRun.ts';
import type { FinalReport, PipelineEvent, PipelineRunner, RunOptions } from '../src/events.ts';
import {
  AnalysisController,
  type AnalysisDeps,
  type AnalysisSnapshot,
} from '../app/lib/analysisController.ts';
import { defaultSettings } from '../app/lib/settings.ts';
import { createMemoryRunArchive } from './fixtures/memoryRunArchive.ts';

type RunnerImpl = (ticker: string, opts?: RunOptions) => Promise<FinalReport | undefined>;

/** 可手动放行的 Promise(bootstrap/start 交错用例:storeReady/runner 挂起控制)。 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeFakeRunner(impl?: RunnerImpl) {
  const listeners = new Set<(e: PipelineEvent) => void>();
  const runs: Array<{ ticker: string; opts?: RunOptions }> = [];
  const fake: PipelineRunner & {
    runs: typeof runs;
    emit(e: PipelineEvent): void;
    listenerCount(): number;
  } = {
    runs,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async run(ticker, opts) {
      runs.push({ ticker, opts });
      return impl ? impl(ticker, opts) : undefined;
    },
    emit(e) {
      for (const fn of [...listeners]) fn(e);
    },
    listenerCount() {
      return listeners.size;
    },
  };
  return fake;
}

function makeHarness(
  opts: { runnerImpl?: RunnerImpl; storeReady?: () => Promise<void>; store?: StoreLike } = {},
) {
  const store = opts.store ?? new InMemoryStore();
  const runner = makeFakeRunner(opts.runnerImpl);
  const deps: AnalysisDeps = {
    store,
    runArchive: createMemoryRunArchive(),
    runner,
    platform: 'rn',
    storeReady: opts.storeReady ?? (async () => {}),
    loadDemoData: () => false,
    loadSettings: () => defaultSettings(),
    saveSettings: () => {},
    applyCapabilitySwitches: () => {},
    buildLlm: () => ({ stub: 'llm' }),
    collect: async (ticker) => ({
      ticker,
      f10Text: '【主要财务指标】\n净资产收益率: 15.2',
      snapshot: { price: 38.8, high: 39.1, low: 38.48, open: 38.9, volume: 10000, amount: 380000 },
      name: '测试股',
      capital: null,
    }),
    fetchIntel: async () => ({}),
    makeBillionsClient: () => undefined,
    assembleTools: () => [],
    keepAliveStart: () => {},
    stopKeepAlive: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    nowMs: (() => {
      let t = 1_000_000;
      return () => (t += 1000);
    })(),
    isoNow: () => '2026-08-23T08:00:00.000Z',
  };
  const ctrl = new AnalysisController(deps);
  let snap: AnalysisSnapshot = ctrl.snapshot();
  ctrl.subscribe((s) => {
    snap = s;
  });
  return { store, runner, ctrl, snap: () => snap };
}

function makeReport(): FinalReport {
  return {
    ticker: '600036',
    stock_information: '【采集数据】600036 测试股',
    final_decision: '持有观察',
    opinions: [{ key: 'fundamental_analysis', tabTitle: '基本面分析', content: 'FUND_REPORT' }],
  };
}

describe('AnalysisController 失败运行终态(D15/AC5)', () => {
  it('成功后再失败:error 终态 running=false ∧ hasDone=false——完成横幅三条件全灭', async () => {
    let phase = 0;
    const h = makeHarness({
      runnerImpl: async () => {
        if (phase === 0) {
          h.runner.emit({ type: 'done', report: makeReport() });
          return makeReport();
        }
        // 第二次运行:先有进度事件(旧实现会渲染「✓ 分析完成(N 步)」),再失败
        h.runner.emit({ type: 'progress', message: '正在整理最终回答' });
        h.runner.emit({ type: 'error', error: 'LLM 连接失败' });
        return undefined;
      },
    });
    await h.ctrl.start('600036', 'cn');
    expect(h.snap().hasDone).toBe(true); // 第一次成功 → 完成横幅条件成立

    phase = 1;
    await h.ctrl.start('600036', 'cn');
    const s = h.snap();
    // App 门(progress.length>0 && (running||hasDone)):失败运行整体不渲染
    expect(s.running).toBe(false); // error 事件后 finally 复位
    expect(s.hasDone).toBe(false); // error 归约撤销完成标记
    expect(s.error).toBe('LLM 连接失败'); // 错误横幅在
    expect(s.events.some((e) => e.type === 'progress')).toBe(true); // 进度事件存在但门仍关
  });

  it('首次即失败(无前置成功):终态同样 running=false ∧ hasDone=false', async () => {
    const h = makeHarness({
      runnerImpl: async () => {
        throw new Error('boom');
      },
    });
    await h.ctrl.start('600036', 'cn');
    const s = h.snap();
    expect(s.running).toBe(false);
    expect(s.hasDone).toBe(false);
    expect(s.error).toBe('boom');
  });
});

describe('AnalysisController.restore hasDone(D15 置位点)', () => {
  it('lastRun.final_decision 非空 → 恢复后 hasDone=true', async () => {
    const h = makeHarness();
    h.store.setMeta(
      LAST_RUN_KEY,
      JSON.stringify({
        ticker: '0700.HK',
        stock_information: '【采集数据】腾讯',
        final_decision: '持有',
        opinions: [{ key: 'bullish_opinions', tabTitle: '看涨观点', content: 'BULL' }],
        at: '2026-08-22T10:00:00.000Z',
        mode: 'real',
      }),
    );
    await h.ctrl.bootstrap();
    expect(h.snap().hasDone).toBe(true);
  });

  it('lastRun.final_decision 空白 → 恢复后 hasDone=false(经理 chip 同款条件)', async () => {
    const h = makeHarness();
    h.store.setMeta(
      LAST_RUN_KEY,
      JSON.stringify({
        ticker: '600036',
        stock_information: '【采集数据】demo',
        final_decision: '  ',
        opinions: [],
        at: '2026-08-22T10:00:00.000Z',
        mode: 'demo',
      }),
    );
    await h.ctrl.bootstrap();
    expect(h.snap().hasDone).toBe(false);
  });

  it('无缓存(demo 上下文)→ hasDone 保持 false', async () => {
    const h = makeHarness();
    await h.ctrl.bootstrap();
    expect(h.snap().hasDone).toBe(false);
  });
});

describe('AnalysisController bootstrap/start 交错(N-2)', () => {
  it('storeReady 挂起期间 start() 先行:bootstrap 恢复段跳过,不覆盖运行中会话', async () => {
    const storeReadyGate = deferred<void>();
    const runnerGate = deferred<void>();
    const runnerEntered = deferred<void>();
    const h = makeHarness({
      storeReady: () => storeReadyGate.promise,
      runnerImpl: async () => {
        // 运行保持 in-flight:先发一个活运行事件,再挂起到测试放行
        h.runner.emit({ type: 'progress', message: '正在采集行情' });
        runnerEntered.resolve();
        await runnerGate.promise;
        return undefined;
      },
    });
    // 预置上次分析缓存:若无 N-2 守卫,恢复块会把旧会话报告/标记/状态写回
    h.store.setMeta(
      LAST_RUN_KEY,
      JSON.stringify({
        ticker: '0700.HK',
        stock_information: '【采集数据】腾讯',
        final_decision: '持有',
        opinions: [{ key: 'bullish_opinions', tabTitle: '看涨观点', content: 'BULL' }],
        at: '2026-08-22T10:00:00.000Z',
        mode: 'real',
      }),
    );
    const boot = h.ctrl.bootstrap(); // 挂起在 storeReady
    const startPromise = h.ctrl.start('600036', 'cn'); // start() 内部 await runner.run → 挂起
    await runnerEntered.promise; // 确定 start() 已进入 runner(running=true)
    expect(h.snap().running).toBe(true);

    storeReadyGate.resolve(); // bootstrap 恢复 → 守卫(running)应跳过 demo/lastRun 恢复块
    await boot;
    const s = h.snap();
    expect(s.running).toBe(true); // 运行未被 bootstrap 干扰
    expect(s.events.map((e) => e.type)).toEqual(['progress']); // 无上次会话 report 事件混入
    expect(s.lastRunTicker).toBe('600036'); // 未恢复旧 ticker(0700.HK)
    expect(s.statuses).toEqual({}); // 未恢复旧角色完成 chips
    expect(s.hasDone).toBe(false); // 恢复块未置 hasDone

    runnerGate.resolve(); // 放行运行 → start() 正常收尾
    await startPromise;
    expect(h.snap().running).toBe(false);
  });
});

// ─── 评审 2026-11-08:S1-1/CR-21(降级不入档)+ S3-2/CR-28(落盘失败要等队列)──
describe('AnalysisController 降级运行不入档(S1-1/CR-21)', () => {
  it('degraded done:不写 lastRun、不进历史归档、不置 hasDone', async () => {
    const h = makeHarness({
      runnerImpl: async () => {
        const r = { ...makeReport(), degraded: true };
        h.runner.emit({ type: 'done', report: r });
        return r;
      },
    });
    await h.ctrl.start('600036', 'cn');
    expect(h.snap().hasDone).toBe(false);
    // 旧实现先写后判:重启会复活「✓分析完成」的空壳(LastRunRecord 无 degraded 可回辨)
    expect(h.store.getMeta(LAST_RUN_KEY)).toBeNull();
    await h.ctrl.refreshHistory();
    expect(h.snap().history).toHaveLength(0);
  });

  it('对照(非 degraded):lastRun 与历史归档照常写入', async () => {
    const h = makeHarness({
      runnerImpl: async () => {
        const r = makeReport();
        h.runner.emit({ type: 'done', report: r });
        return r;
      },
    });
    await h.ctrl.start('600036', 'cn');
    expect(h.snap().hasDone).toBe(true);
    expect(h.store.getMeta(LAST_RUN_KEY)).toContain('持有观察');
    await h.ctrl.refreshHistory();
    expect(h.snap().history).toHaveLength(1);
  });
});

describe('AnalysisController 落盘失败可见性(S3-2/CR-28)', () => {
  it('等写队列排空后再读 getLastPersistError(同步读只能看到上一次)', async () => {
    const base = new InMemoryStore();
    let persistError: string | null = null;
    const { promise: gate, resolve: releaseFlush } = Promise.withResolvers<void>();
    // flush 排空之前 flag 恒 null:旧实现的同步读必然读不到本次失败
    const store: StoreLike = Object.assign(base, {
      getLastPersistError: () => persistError,
      flush: async () => {
        await gate;
        persistError = 'QuotaExceededError: 存储已满';
      },
    });
    const h = makeHarness({
      store,
      runnerImpl: async () => {
        const r = makeReport();
        h.runner.emit({ type: 'done', report: r });
        return r;
      },
    });
    await h.ctrl.start('600036', 'cn');
    expect(h.snap().error).toBeNull(); // 队列未排空 → 还没读
    releaseFlush();
    await new Promise((r) => setTimeout(r, 0)); // flush.then 落地
    expect(h.snap().error).toContain('本地保存失败');
  });

  it('读侧损坏文件可见(getLastLoadError):提示下次采集可能覆盖历史', async () => {
    const base = new InMemoryStore();
    const store: StoreLike = Object.assign(base, {
      getLastLoadError: () => 'BROKEN.json(Unexpected end of JSON input)',
    });
    const h = makeHarness({
      store,
      runnerImpl: async () => {
        const r = makeReport();
        h.runner.emit({ type: 'done', report: r });
        return r;
      },
    });
    await h.ctrl.start('600036', 'cn');
    expect(h.snap().hasDone).toBe(true); // 读侧告警不得吞掉 done
    expect(h.snap().error).toContain('本地数据部分损坏');
    expect(h.snap().error).toContain('BROKEN.json');
  });

  it('读侧告警与写侧失败共存时,写侧更紧急(后者覆盖 error 文案)', async () => {
    const base = new InMemoryStore();
    const store: StoreLike = Object.assign(base, {
      getLastLoadError: () => 'BROKEN.json(bad)',
      getLastPersistError: () => 'QuotaExceededError: 存储已满',
      flush: async () => {},
    });
    const h = makeHarness({
      store,
      runnerImpl: async () => {
        const r = makeReport();
        h.runner.emit({ type: 'done', report: r });
        return r;
      },
    });
    await h.ctrl.start('600036', 'cn');
    await new Promise((r) => setTimeout(r, 0));
    expect(h.snap().error).toContain('本地保存失败');
    expect(h.snap().error).not.toContain('本地数据部分损坏');
  });

  it('无读侧错误时不写 error(空库不报噪声)', async () => {
    const h = makeHarness({
      runnerImpl: async () => {
        const r = makeReport();
        h.runner.emit({ type: 'done', report: r });
        return r;
      },
    });
    await h.ctrl.start('600036', 'cn');
    expect(h.snap().hasDone).toBe(true);
    expect(h.snap().error).toBeNull();
  });
});
