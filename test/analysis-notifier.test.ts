// AnalysisNotifier 直测(1.0.0 评审 S3)—— 此前该类零直接用例:它自己的注入口
// (`setTimer`/`clearTimer`,注释写着「测试用」)没人消费,于是两条只由它负责的
// 契约无断言:①订阅者抛错各自隔离(一个 UI 崩溃不该掐断其余),②`clear()` 丢掉
// 挂起的合并帧(收尾后不该再补一帧)。
//
// 时序全部走注入面,不用 vi.useFakeTimers:本模块的窗口行为就是由 setTimer 决定的,
// 真时钟/假时钟都只会多一层不确定。
import { describe, expect, it } from 'vitest';
import { AnalysisNotifier } from '../app/lib/analysisNotifier.ts';

interface TimerKit {
  /** 已排队的定时器(windowMs 原值一并记录,用来断言缺省窗口) */
  readonly windows: number[];
  pending(): number;
  setTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer(t: ReturnType<typeof setTimeout>): void;
  flush(): void;
}

function makeTimerKit(): TimerKit {
  let id = 0;
  const queued = new Map<number, () => void>();
  const windows: number[] = [];
  return {
    windows,
    pending: () => queued.size,
    setTimer(fn, ms) {
      const t = ++id;
      queued.set(t, fn);
      windows.push(ms);
      return t as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer(t) {
      queued.delete(t as unknown as number);
    },
    flush() {
      const fns = [...queued.values()];
      queued.clear();
      for (const fn of fns) fn();
    },
  };
}

function makeNotifier(opts: { windowMs?: number } = {}) {
  const kit = makeTimerKit();
  let state = 0;
  const notifier = new AnalysisNotifier<number>({
    getSnapshot: () => state,
    setTimer: kit.setTimer,
    clearTimer: kit.clearTimer,
    ...(opts.windowMs === undefined ? {} : { windowMs: opts.windowMs }),
  });
  return {
    kit,
    notifier,
    setState: (v: number) => {
      state = v;
    },
  };
}

describe('AnalysisNotifier(token 尾部合并广播)', () => {
  it('notify() 立即广播,不排任何定时器', () => {
    const { kit, notifier, setState } = makeNotifier();
    const seen: number[] = [];
    notifier.subscribe((s) => seen.push(s));

    setState(1);
    notifier.notify();

    expect(seen).toEqual([1]);
    expect(kit.pending()).toBe(0);
    expect(notifier.pending).toBe(false);
  });

  it('scheduleNotify() 窗口内只排一帧,窗口结束时取最新快照(缺省 120ms)', () => {
    const { kit, notifier, setState } = makeNotifier();
    const seen: number[] = [];
    notifier.subscribe((s) => seen.push(s));

    setState(1);
    notifier.scheduleNotify();
    setState(2);
    notifier.scheduleNotify();
    setState(3);
    notifier.scheduleNotify();

    expect(kit.windows).toEqual([120]); // 三次调用 → 一个 120ms 窗口
    expect(seen).toEqual([]); // 窗口内不广播
    expect(notifier.pending).toBe(true);

    kit.flush();
    expect(seen).toEqual([3]); // 广播的是"当时"的最新快照
    expect(notifier.pending).toBe(false);
  });

  it('clear() 丢掉挂起的合并帧 —— 收尾后不再补一帧', () => {
    const { kit, notifier, setState } = makeNotifier({ windowMs: 50 });
    const seen: number[] = [];
    notifier.subscribe((s) => seen.push(s));

    setState(7);
    notifier.scheduleNotify();
    expect(kit.pending()).toBe(1);

    notifier.clear();
    expect(notifier.pending).toBe(false);
    expect(kit.pending()).toBe(0); // 定时器被真正清掉,不是只把标记置空

    kit.flush(); // 即便有人误触 flush,也没有回调可跑
    expect(seen).toEqual([]);

    // 清掉之后仍能正常排下一帧(clear 不得把状态机弄坏)
    notifier.scheduleNotify();
    setState(8);
    kit.flush();
    expect(seen).toEqual([8]);
  });

  it('订阅者抛错各自隔离:一个 UI 崩溃不掐断其余订阅者', () => {
    const { notifier, setState } = makeNotifier();
    const got: string[] = [];
    notifier.subscribe(() => {
      throw new Error('订阅者崩了');
    });
    notifier.subscribe(() => got.push('second'));
    notifier.subscribe(() => {
      throw new Error('第三个也崩了');
    });
    notifier.subscribe(() => got.push('fourth'));

    setState(1);
    expect(() => notifier.notify()).not.toThrow();
    expect(got).toEqual(['second', 'fourth']);
  });

  it('退订后不再收到广播,且退订是幂等的', () => {
    const { kit, notifier, setState } = makeNotifier();
    const seen: number[] = [];
    const off = notifier.subscribe((s) => seen.push(s));

    setState(1);
    notifier.notify();
    expect(seen).toEqual([1]);

    off();
    off();
    setState(2);
    notifier.notify();
    notifier.scheduleNotify();
    kit.flush();
    expect(seen).toEqual([1]);
  });
});
