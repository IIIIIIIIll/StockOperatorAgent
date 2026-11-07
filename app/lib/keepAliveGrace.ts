// 保活停止的 90s 宽限状态机 —— 从 app/hooks/useAnalysis.ts 抽出(CR-49):
// 锁屏期间运行结束不能立即 stopForegroundService(进程会掉回 cached 桶被冻结),
// 改为「推迟到下次 active 再停」;同时用 90s 上限兜底,避免前台服务/唤醒锁无限期
// 挂着(Android 15 dataSync 6h/24h 上限、Play Vitals「卡住的唤醒锁」)。
// 纯 TS、无 RN 依赖 → 可直接单测(delayMs/timer 可注入)。
export const KEEP_ALIVE_GRACE_MS = 90_000;

export interface GraceStopper {
  /** 请求停止:active 立即停;否则挂起到回前台或 90s 到期。 */
  defer(): void;
  /** 取消待停止(已停止状态不变,仅清定时器/标记)。 */
  cancel(): void;
  readonly pending: boolean;
}

export interface GraceStopperDeps {
  isActive(): boolean;
  hardStop(): void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export function createGraceStopper(deps: GraceStopperDeps): GraceStopper {
  const delayMs = deps.delayMs ?? KEEP_ALIVE_GRACE_MS;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t: ReturnType<typeof setTimeout>) => clearTimeout(t));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const clear = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
  const stop = (): void => {
    pending = false;
    deps.hardStop();
  };

  return {
    defer(): void {
      if (deps.isActive()) {
        clear();
        pending = false;
        stop();
        return;
      }
      pending = true;
      if (timer !== null) return; // 已有宽限计时:不重复挂
      timer = setTimer(() => {
        timer = null;
        if (!pending) return;
        stop();
      }, delayMs);
    },
    cancel(): void {
      clear();
      pending = false;
    },
    get pending(): boolean {
      return pending;
    },
  };
}
