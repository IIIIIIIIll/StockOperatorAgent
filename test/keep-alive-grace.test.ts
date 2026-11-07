// CR-49:保活 90s 宽限状态机单测(从 useAnalysis 抽出的纯逻辑)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGraceStopper, KEEP_ALIVE_GRACE_MS } from '../app/lib/keepAliveGrace.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('createGraceStopper(CR-49)', () => {
  it('前台 active:defer 立即 hardStop,不挂定时器', () => {
    vi.useFakeTimers();
    const hardStop = vi.fn();
    const s = createGraceStopper({ isActive: () => true, hardStop });
    s.defer();
    expect(hardStop).toHaveBeenCalledTimes(1);
    expect(s.pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('后台:挂起到 90s 到期;重复 defer 不重复计时', () => {
    vi.useFakeTimers();
    const hardStop = vi.fn();
    const s = createGraceStopper({ isActive: () => false, hardStop });
    s.defer();
    s.defer();
    expect(hardStop).not.toHaveBeenCalled();
    expect(s.pending).toBe(true);
    vi.advanceTimersByTime(KEEP_ALIVE_GRACE_MS - 1);
    expect(hardStop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hardStop).toHaveBeenCalledTimes(1);
    expect(s.pending).toBe(false);
  });

  it('cancel 清掉待停止与定时器', () => {
    vi.useFakeTimers();
    const hardStop = vi.fn();
    const s = createGraceStopper({ isActive: () => false, hardStop });
    s.defer();
    s.cancel();
    vi.advanceTimersByTime(KEEP_ALIVE_GRACE_MS + 1000);
    expect(hardStop).not.toHaveBeenCalled();
    expect(s.pending).toBe(false);
  });

  it('自定义 delayMs/timer 注入(不依赖全局时钟)', () => {
    const timers: Array<() => void> = [];
    const hardStop = vi.fn();
    const s = createGraceStopper({
      isActive: () => false,
      hardStop,
      delayMs: 10,
      setTimer: (fn) => {
        timers.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {
        timers.length = 0;
      },
    });
    s.defer();
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(hardStop).toHaveBeenCalledTimes(1);
  });
});
