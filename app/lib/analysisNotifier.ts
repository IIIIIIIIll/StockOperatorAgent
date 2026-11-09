// 快照广播器 —— 从 analysisController 抽出的独立单元(B6 重构,评审 2026-11-09)。
//
// 职责:订阅集合 + token 专用的尾部合并广播窗口。快照内容由调用方经
// getSnapshot 提供(泛型 T),因此本模块不依赖控制器的状态类型,也不会产生
// 反向 import。
//
// 两种广播语义(与抽取前逐点等价):
//   notify()         —— 立即广播(非 token 事件:报告/状态/错误/历史变更)。
//   scheduleNotify() —— 窗口内只广播一次(流式 token:120ms 一帧,避免每 delta 都
//                       触发 React 树 diff);窗口结束广播"当时"的最新快照。

export interface NotifierOptions<T> {
  /** 取当前快照(每次广播时调用,不缓存)。 */
  getSnapshot(): T;
  /** 合并窗口(ms);缺省 120,与 app/lib/analysisController 的 TOKEN_NOTIFY_MS 一致。 */
  windowMs?: number;
  /** 定时器注入(测试用);缺省 setTimeout/clearTimeout。 */
  setTimer?(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer?(t: ReturnType<typeof setTimeout>): void;
}

const DEFAULT_WINDOW_MS = 120;

export class AnalysisNotifier<T> {
  private readonly listeners = new Set<(s: T) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly getSnapshot: () => T;
  private readonly windowMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (t: ReturnType<typeof setTimeout>) => void;

  constructor(opts: NotifierOptions<T>) {
    this.getSnapshot = opts.getSnapshot;
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t));
  }

  /** 订阅;返回退订函数(同 runner.subscribe 契约)。 */
  subscribe(fn: (s: T) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 立即广播(订阅者抛错各自隔离:一个 UI 崩溃不该掐断其余)。 */
  notify(): void {
    const snap = this.getSnapshot();
    for (const fn of [...this.listeners]) {
      try {
        fn(snap);
      } catch {
        /* 订阅者异常不影响其他订阅者,也不影响控制器状态机 */
      }
    }
  }

  /** 窗口内只广播一次(尾部合并);窗口结束时取"当时"的最新快照。 */
  scheduleNotify(): void {
    if (this.timer !== null) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.notify();
    }, this.windowMs);
  }

  /** 丢弃挂起的合并广播(收尾/取消时调用,避免关闭后还补一帧)。 */
  clear(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /** 是否还有挂起的合并广播(诊断/测试)。 */
  get pending(): boolean {
    return this.timer !== null;
  }
}
