// useChartWebView 直测（评审 2026-11-21「do not leave anything unfinished」）。
//
// 三条契约只能从行为上验，读代码无法回归：
//   1) source 引用恒定（变了就让 native 整页重载）
//   2) 只在「已加载 + 前台」时注入；回前台补一次
//   3) onRenderProcessGone → key 自增（重挂拿新渲染进程）且重置已加载标记
//
// 依赖面：react-native 由 vitest alias 指向 test/fixtures/react-native-stub.ts
// （只提供可控 AppState），react-native-webview 同款空组件替身。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useChartWebView, type ChartWebViewHandle, type WebViewHandle } from '../app/hooks/useChartWebView.ts';
import { CHART_HTML } from '../app/lib/chartHtml.ts';
import { __appStateListeners, __resetAppState, __setAppState } from './fixtures/react-native-stub.ts';

/** 渲染结果句柄：sink 每次渲染都会被更新，避免测试拿着旧闭包断言。 */
interface Sink {
  handle: ChartWebViewHandle | null;
}

function Harness({ json, sink }: { json: string; sink: Sink }) {
  sink.handle = useChartWebView(json);
  return null;
}

function mount(json: string): { root: ReactTestRenderer; sink: Sink; latest: () => ChartWebViewHandle } {
  const sink: Sink = { handle: null };
  let root!: ReactTestRenderer;
  act(() => {
    root = create(React.createElement(Harness, { json, sink }));
  });
  return {
    root,
    sink,
    latest: () => {
      if (!sink.handle) throw new Error('hook 未渲染');
      return sink.handle;
    },
  };
}

function update(root: ReactTestRenderer, sink: Sink, json: string): void {
  act(() => {
    root.update(React.createElement(Harness, { json, sink }));
  });
}

function makeInjectSpy(): { handle: WebViewHandle; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    handle: {
      injectJavaScript(script: string) {
        calls.push(script);
      },
      reload() {},
      goBack() {},
      goForward() {},
      stopLoading() {},
      postMessage() {},
    },
  };
}

/** 挂载 + 装好注入 spy + （可选）触发首次 loadEnd。 */
function setup(json: string, loadEnd = true): {
  root: ReactTestRenderer;
  sink: Sink;
  latest: () => ChartWebViewHandle;
  calls: string[];
} {
  const { root, sink, latest } = mount(json);
  const spy = makeInjectSpy();
  latest().ref.current = spy.handle;
  if (loadEnd) act(() => latest().onLoadEnd());
  return { root, sink, latest, calls: spy.calls };
}

describe('useChartWebView', () => {
  beforeEach(() => __resetAppState());
  afterEach(() => __resetAppState());

  it('source 引用跨渲染恒定（否则 native 整页重载）', () => {
    const { root, sink, latest } = mount('{"a":1}');
    const first = latest().source;
    update(root, sink, '{"a":2}');
    expect(latest().source).toBe(first);
    expect(first.html).toBe(CHART_HTML);
  });

  it('onLoadEnd 之后才注入，内容取自渲染时的最新数据', () => {
    const { root, sink, latest, calls } = setup('{"a":1}', false);
    // 尚未 loadEnd：即便前台也不注入
    update(root, sink, '{"a":2}');
    expect(calls).toHaveLength(0);

    act(() => latest().onLoadEnd());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('window.__SOA_CHART_DATA__={"a":2}');
    expect(calls[0]).toContain('window.renderChart');
  });

  it('无数据（空串）时 onLoadEnd 不注入', () => {
    const { calls } = setup('', true);
    expect(calls).toHaveLength(0);
  });

  it('后台变更不注入，回前台补一次（解锁瞬间不炸整图重建）', () => {
    const { root, sink, calls } = setup('{"v":1}', true);
    expect(calls).toHaveLength(1);

    act(() => __setAppState('background'));
    update(root, sink, '{"v":2}');
    expect(calls).toHaveLength(1); // 后台跳过

    act(() => __setAppState('active'));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('{"v":2}'); // 追平后台期间的最新数据
  });

  it('onRenderProcessGone → key 自增且重置已加载标记', () => {
    const { root, sink, latest, calls } = setup('{"v":1}', true);
    expect(latest().key).toBe(0);
    expect(calls).toHaveLength(1);

    act(() => latest().onRenderProcessGone());
    expect(latest().key).toBe(1);

    // 新 WebView 还没 loadEnd → 数据变化不得往死掉的渲染器注入
    update(root, sink, '{"v":2}');
    expect(calls).toHaveLength(1);

    // 新进程 loadEnd 后恢复注入，且是最新数据
    act(() => latest().onLoadEnd());
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('{"v":2}');
  });

  it('卸载时移除 AppState 监听（不留悬空订阅）', () => {
    const { root } = setup('{"v":1}', true);
    expect(__appStateListeners()).toBe(1);
    act(() => root.unmount());
    expect(__appStateListeners()).toBe(0);
  });
});
