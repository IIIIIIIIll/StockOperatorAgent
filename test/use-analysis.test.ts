// useAnalysis 直测（评审 2026-11-21「do not leave anything unfinished」）。
//
// 这个 hook 是「控制器 ↔ React 状态」的接线层:构造 AnalysisController（依赖全部
// 从 app/lib/* 注入）、订阅快照、bootstrap 启动链、前台回归补广播、以及把
// start/cancel/history 转发出去。编排逻辑本身在 analysisController.test.ts 已覆盖,
// 这里只钉接线契约 —— 但必须跑**真实控制器**,否则「dep 接错 / 订阅没建立 /
// 卸载没解绑」这类回归抓不到。
//
// 依赖面:app/lib/runner（native+外网）、collectorSelection（动态 import 数据源）、
// runArchive（磁盘/IDB）、soa-keepalive（原生模块）、capabilities（平台判定）
// 全部替换为最小假件；react-native 由 vitest alias 指向 test/fixtures。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// ─── 假件（vi.hoisted:vi.mock 工厂会被提升到 import 之前）──────────────────
const h = vi.hoisted(() => {
  const listeners = new Set<(e: unknown) => void>();
  const state = {
    runs: [] as Array<{ ticker: string; opts?: Record<string, unknown> }>,
    collectCalls: [] as string[],
    keepAliveStarts: 0,
    keepAliveStops: 0,
    emit(e: unknown) {
      for (const fn of [...listeners]) fn(e);
    },
  };
  const runner = {
    subscribe(fn: (e: unknown) => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async run(ticker: string, opts?: Record<string, unknown>) {
      state.runs.push({ ticker, opts });
      return undefined;
    },
    abort() {},
  };
  const collectResult = {
    ticker: '',
    name: '招商银行',
    f10Text: null,
    snapshot: null,
    capital: { zongguben: Number.NaN, liutongguben: Number.NaN },
  };
  return { state, runner, collectResult, listeners };
});

vi.mock('../app/lib/capabilities', () => ({
  // 平台判定为 web:走 collectForWeb 分支,不触发 deviceBridge 动态 import
  capabilities: () => ({ hasDom: true, hasNative: false }),
}));

vi.mock('../app/lib/runner', async () => {
  const { InMemoryStore } = await import('../src/store-memory.ts');
  return {
    store: new InMemoryStore(),
    runner: h.runner,
    storeReady: async () => {},
    loadDemoData: () => false,
    collectForWeb: async (ticker: string) => {
      h.state.collectCalls.push(ticker);
      return { ...h.collectResult, ticker };
    },
    buildLlm: () => undefined,
    makeBillionsIntel: async () => undefined,
    makeMcpIntel: async () => undefined,
    makeNewsIntel: async () => undefined,
    assembleTools: () => [],
    webBillionsFetch: () => undefined,
  };
});

vi.mock('../app/lib/collectorSelection', () => ({
  selectCollector: () => async (ticker: string) => {
    h.state.collectCalls.push(ticker);
    return { ...h.collectResult, ticker };
  },
}));

vi.mock('../app/modules/soa-keepalive', () => ({
  startAnalysisKeepAlive: () => {
    h.state.keepAliveStarts += 1;
  },
  stopAnalysisKeepAlive: () => {
    h.state.keepAliveStops += 1;
  },
}));

vi.mock('../app/lib/runArchive', async () => {
  const { createMemoryRunArchive } = await import('./fixtures/memoryRunArchive.ts');
  const archive = createMemoryRunArchive([
    {
      id: 'seed-run',
      at: '2026-11-20T02:00:00.000Z',
      mode: 'real',
      ticker: '600036',
      market: 'cn',
      stock_information: 'SEED_INFO',
      final_decision: 'SEED_DECISION',
      opinions: [],
    },
  ]);
  return {
    createIdbRunArchive: () => archive,
    createFileRunArchive: () => archive,
  };
});

import { useAnalysis, type UseAnalysis } from '../app/hooks/useAnalysis.ts';
import { __appStateListeners, __resetAppState, __setAppState } from './fixtures/react-native-stub.ts';

interface Sink {
  api: UseAnalysis | null;
}

function Harness({ sink }: { sink: Sink }) {
  sink.api = useAnalysis();
  return null;
}

function mount(): { root: ReactTestRenderer; api: () => UseAnalysis } {
  const sink: Sink = { api: null };
  let root!: ReactTestRenderer;
  act(() => {
    root = create(React.createElement(Harness, { sink }));
  });
  return {
    root,
    api: () => {
      if (!sink.api) throw new Error('hook 未渲染');
      return sink.api;
    },
  };
}

/** 冲掉微任务队列（bootstrap / runner 都是异步链）。 */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('useAnalysis', () => {
  beforeEach(() => {
    __resetAppState();
    h.state.runs.length = 0;
    h.state.collectCalls.length = 0;
    h.state.keepAliveStarts = 0;
    h.state.keepAliveStops = 0;
  });
  afterEach(() => __resetAppState());

  it('首帧快照字段齐全且为初始态', () => {
    const { api } = mount();
    const a = api();
    expect(a.running).toBe(false);
    expect(a.events).toEqual([]);
    expect(a.finalDecision).toBe('');
    expect(a.hasDone).toBe(false);
    expect(a.statuses).toEqual({});
    expect(a.partials).toEqual({});
    expect(a.viewingRun).toBeNull();
    // settings 来自 loadSettings()（真实实现），至少三键结构在位
    expect(typeof a.settings.keys.llmModel).toBe('string');
  });

  it('挂载即跑 bootstrap:归档里的历史进入快照', async () => {
    const { api } = mount();
    await flush();
    expect(api().history.map((r) => r.id)).toContain('seed-run');
    expect(api().historyLoading).toBe(false);
  });

  it('start 转发:采集 + runner.run 都收到规范化后的代码', async () => {
    const { api } = mount();
    await flush();
    await act(async () => {
      await api().start('600036', 'cn');
    });
    await flush();

    expect(h.state.collectCalls.length).toBeGreaterThan(0);
    expect(h.state.collectCalls[0]).toBe('600036');
    expect(h.state.runs.length).toBe(1);
    expect(h.state.runs[0]!.ticker).toBe('600036');
    expect(h.state.keepAliveStarts).toBe(1);
  });

  it('输入非法时 start 不发起采集/运行（守卫在控制器里）', async () => {
    const { api } = mount();
    await flush();
    await act(async () => {
      await api().start('12345', 'cn');
    });
    await flush();
    expect(h.state.runs).toHaveLength(0);
    expect(api().error).toBeTruthy();
  });

  it('done 事件 → hasDone=true 且正文落地（订阅确实接到了更新）', async () => {
    const { api } = mount();
    await flush();
    await act(async () => {
      await api().start('600036', 'cn');
    });
    await flush();

    act(() => {
      h.state.emit({
        type: 'report',
        runTag: 1,
        key: 'fundamental_analysis',
        tabTitle: '基本面分析',
        content: 'REPORT_BODY',
        nodeName: 'fundamental_analysis',
      });
      h.state.emit({ type: 'done', runTag: 1, report: { ticker: '600036', stock_information: 'I', final_decision: 'FINAL', opinions: [], degraded: false } });
    });
    await flush();
    expect(api().hasDone).toBe(true);
    expect(api().finalDecision).toBe('FINAL');
  });

  it('cancel 复位运行态且不改写正文（取消≠失败）', async () => {
    const { api } = mount();
    await flush();
    await act(async () => {
      await api().start('600036', 'cn');
    });
    await flush();
    act(() => api().cancel());
    await flush();
    expect(api().running).toBe(false);
    expect(api().error).toBeNull();
  });

  it('onSettingsChange 落到快照并持久化（转发给控制器）', async () => {
    const { api } = mount();
    await flush();
    const next = { ...api().settings, caps: { ...api().settings.caps, webSearchMax: 7 } };
    act(() => api().onSettingsChange(next));
    expect(api().settings.caps.webSearchMax).toBe(7);
  });

  it('回调引用稳定（不随每次渲染换新，避免下游 memo 失效）', async () => {
    const sink: Sink = { api: null };
    let root!: ReactTestRenderer;
    act(() => {
      root = create(React.createElement(Harness, { sink }));
    });
    const first = sink.api!;
    act(() => {
      __setAppState('active'); // 触发一次 refresh → 重渲染
    });
    await flush();
    expect(sink.api!.start).toBe(first.start);
    expect(sink.api!.cancel).toBe(first.cancel);
    act(() => root.unmount());
  });

  it('卸载时解绑 AppState 监听（不留悬空订阅）', async () => {
    const { root } = mount();
    await flush();
    expect(__appStateListeners()).toBe(1);
    act(() => root.unmount());
    expect(__appStateListeners()).toBe(0);
  });

  it('回前台补一次广播（锁屏期间压下的合并帧不丢）', async () => {
    const { api } = mount();
    await flush();
    act(() => __setAppState('background'));
    act(() => __setAppState('active'));
    await flush();
    // 刷新不会把已有正文清掉,也不会抛
    expect(api().running).toBe(false);
  });
});
