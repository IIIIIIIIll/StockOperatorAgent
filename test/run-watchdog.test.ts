// RunWatchdog 单测(B6 重构:看门狗从 analysisController 抽出后可直接钉边界)。
// 源码里的两处纪律必须在用例里成立:
//   1) 到期 → onTimeout 恰好一次;已 clear 则不再触发。
//   2) 事件驱动的 rearm 有 ≥1s 节流 —— 删掉节流会让每个 token 都重建 timer。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunWatchdog, RUN_IDLE_TIMEOUT_MS, WATCHDOG_REARM_THROTTLE_MS } from '../app/lib/runWatchdog.ts';

function makeWatchdog() {
  let now = 1_000_000;
  const timeouts: number[] = [];
  const wd = new RunWatchdog({
    nowMs: () => now,
    onTimeout: () => timeouts.push(now),
  });
  return {
    wd,
    timeouts,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('RunWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('常量为 300s(与文档/看门狗提示文案一致)', () => {
    expect(RUN_IDLE_TIMEOUT_MS).toBe(300_000);
    expect(WATCHDOG_REARM_THROTTLE_MS).toBe(1_000);
  });

  it('到期触发一次 onTimeout', () => {
    const h = makeWatchdog();
    h.wd.arm();
    vi.advanceTimersByTime(RUN_IDLE_TIMEOUT_MS - 1);
    expect(h.timeouts).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(h.timeouts).toHaveLength(1);
  });

  it('clear 之后不再触发', () => {
    const h = makeWatchdog();
    h.wd.arm();
    h.wd.clear();
    vi.advanceTimersByTime(RUN_IDLE_TIMEOUT_MS * 2);
    expect(h.timeouts).toHaveLength(0);
  });

  it('rearm 在节流窗口内被忽略,超出窗口才重置计时', () => {
    const h = makeWatchdog();
    h.wd.arm();
    // 窗口内(rearm 节流 1s):不重置 → 300s 到点仍然超时
    h.advance(WATCHDOG_REARM_THROTTLE_MS - 1);
    h.wd.rearm();
    vi.advanceTimersByTime(RUN_IDLE_TIMEOUT_MS);
    expect(h.timeouts).toHaveLength(1);

    // 超出窗口:重置成功 → 超时点整体后移
    const h2 = makeWatchdog();
    h2.wd.arm();
    h2.advance(WATCHDOG_REARM_THROTTLE_MS + 1);
    h2.wd.rearm();
    vi.advanceTimersByTime(RUN_IDLE_TIMEOUT_MS - 1);
    expect(h2.timeouts).toHaveLength(0); // 旧计时点已作废
    vi.advanceTimersByTime(WATCHDOG_REARM_THROTTLE_MS + 1);
    expect(h2.timeouts).toHaveLength(1);
  });

  it('重复 arm 幂等:只有最后一个计时器活着', () => {
    const h = makeWatchdog();
    h.wd.arm();
    h.advance(WATCHDOG_REARM_THROTTLE_MS + 1);
    h.wd.arm();
    vi.advanceTimersByTime(RUN_IDLE_TIMEOUT_MS);
    expect(h.timeouts).toHaveLength(1);
  });
});
