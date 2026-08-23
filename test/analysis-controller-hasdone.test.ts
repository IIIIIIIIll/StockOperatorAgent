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

function makeHarness(opts: { runnerImpl?: RunnerImpl } = {}) {
  const store = new InMemoryStore();
  const runner = makeFakeRunner(opts.runnerImpl);
  const deps: AnalysisDeps = {
    store,
    runner,
    platform: 'native',
    storeReady: async () => {},
    loadDemoData: () => {},
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
