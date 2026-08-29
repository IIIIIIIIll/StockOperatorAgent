// AnalysisController D15 补充单元 —— 失败运行终态(AC5:错误后 running=false ∧
// hasDone=false,App「✓分析完成」横幅门关闭)与 restore 路径 hasDone 置位点。
// 独立文件避免与 test/analysis-controller.test.ts(TQ1 后续回填)冲突;
// 假 runner/InMemoryStore 注入模式与其一致。
import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/store-memory.ts';
import { LAST_RUN_KEY } from '../src/lastRun.ts';
import type { FinalReport, PipelineEvent, PipelineRunner, RunOptions } from '../src/events.ts';
import {
  AnalysisController,
  type AnalysisDeps,
  type AnalysisSnapshot,
} from '../app/lib/analysisController.ts';
import { defaultSettings } from '../app/lib/settings.ts';

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

function makeHarness(opts: { runnerImpl?: RunnerImpl; storeReady?: () => Promise<void> } = {}) {
  const store = new InMemoryStore();
  const runner = makeFakeRunner(opts.runnerImpl);
  const deps: AnalysisDeps = {
    store,
    runner,
    platform: 'native',
    storeReady: opts.storeReady ?? (async () => {}),
    loadDemoData: () => false,
    loadSettings: () => defaultSettings(),
    saveSettings: () => {},
    applyCapabilitySwitches: () => {},
    buildLlm: () => ({ stub: 'llm' }),
    collect: async () => ({
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
