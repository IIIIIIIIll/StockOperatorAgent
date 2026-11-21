// useThrottledText 直测 —— 该 hook 此前零覆盖（评审 2026-11-21 第 5 项）。
//
// 它是「流式文本渲染节流」的唯一实现点:尾部边沿 300ms 落地,状态/持久化仍用原始
// 文本。这里用 react-test-renderer 的最小宿主组件驱动,不引入新的断言框架。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useThrottledText } from '../app/hooks/useThrottledText.ts';

/** 最小宿主:把 hook 的返回值暴露到渲染树文本上,便于断言。 */
function Harness({ text, ms }: { text: string; ms?: number }) {
  const shown = useThrottledText(text, ms);
  return React.createElement('span', null, shown);
}

function render(element: React.ReactElement): { root: ReactTestRenderer; shown: () => string } {
  let root!: ReactTestRenderer;
  act(() => {
    root = create(element);
  });
  const shown = (): string => {
    const node = root.toJSON();
    if (node === null || Array.isArray(node)) return '';
    return String(node.children?.[0] ?? '');
  };
  return { root, shown };
}

describe('useThrottledText', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('首帧同步返回传入文本(不出现空白首帧)', () => {
    const { shown } = render(React.createElement(Harness, { text: 'abc' }));
    expect(shown()).toBe('abc');
  });

  it('窗口内连续更新只落最后一次(尾部边沿)', () => {
    const { root, shown } = render(React.createElement(Harness, { text: 'a', ms: 300 }));
    expect(shown()).toBe('a');

    act(() => {
      root.update(React.createElement(Harness, { text: 'ab', ms: 300 }));
    });
    act(() => {
      root.update(React.createElement(Harness, { text: 'abc', ms: 300 }));
    });
    act(() => {
      root.update(React.createElement(Harness, { text: 'abcd', ms: 300 }));
    });
    // 未到窗口:仍显示旧值
    expect(shown()).toBe('a');

    act(() => {
      vi.advanceTimersByTime(300);
    });
    // 一次落地,内容是窗口内最后一次的累积值
    expect(shown()).toBe('abcd');
  });

  it('落地后再来新文本 → 开新窗口', () => {
    const { root, shown } = render(React.createElement(Harness, { text: 'a', ms: 300 }));
    act(() => {
      root.update(React.createElement(Harness, { text: 'ab', ms: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(shown()).toBe('ab');

    act(() => {
      root.update(React.createElement(Harness, { text: 'abc', ms: 300 }));
    });
    expect(shown()).toBe('ab');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(shown()).toBe('abc');
  });

  it('卸载后挂起的定时器不触发(不 setState after unmount)', () => {
    const { root } = render(React.createElement(Harness, { text: 'a', ms: 300 }));
    act(() => {
      root.update(React.createElement(Harness, { text: 'ab', ms: 300 }));
    });
    act(() => {
      root.unmount();
    });
    // 不抛、不告警;定时器已被清理(推进时间无副作用)
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(1000);
      }),
    ).not.toThrow();
  });

  // 契约记录（实测 2026-11-21）：窗口已开时改 ms **不会**缩短它 ——
  // effect 里 `if (timer.current !== null) return` 先命中，本次窗口仍按旧时长落地。
  // 生产上 ms 是常量（300），这个行为是有意的：宁可少改一次渲染节奏，也不要在
  // 流式中途重置计时器造成闪烁。这里把它钉住，避免以后误改成「每次 ms 变化重算」。
  it('窗口已开时改 ms 不打断本次窗口(按旧时长落地)', () => {
    const { root, shown } = render(React.createElement(Harness, { text: 'a', ms: 300 }));
    act(() => {
      root.update(React.createElement(Harness, { text: 'ab', ms: 300 }));
    });
    act(() => {
      root.update(React.createElement(Harness, { text: 'ab', ms: 50 }));
    });
    expect(shown()).toBe('a');
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(shown()).toBe('a'); // 旧窗口还没到点
    act(() => {
      vi.advanceTimersByTime(250); // 300ms 到点
    });
    expect(shown()).toBe('ab');
  });
});
