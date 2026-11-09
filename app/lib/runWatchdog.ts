// 空闲看门狗 —— 从 analysisController 抽出的独立单元(B6 重构,评审 2026-11-09)。
//
// 职责单一:把"无限等"变成"可恢复的失败"。收到进展 → rearm(带 ≥1s 节流,避免每个
// token 都重建 timer);到期 → 回调 onTimeout,由控制器做收尾(error 横幅 + 复位并发
// 守卫 + finishRun)。**不递增运行代数**:底层 pipeline 可能只是安静(大包 tool 调用),
// 真跑完的 done 仍应落地 —— 见 AnalysisController.timedOut 门。
//
// 为什么要单独成文件:假定时器/时间源注入后可以直接单测"到期/重置/节流/幂等停止",
// 不必为了测一个 300s 边界而把整个控制器(10 个可变字段 + 20 个依赖)搭起来。

/** 单次无进展允许的时长(ms)。原值在 analysisController 里,现随模块一起迁出。 */
export const RUN_IDLE_TIMEOUT_MS = 300_000;

/** 事件驱动重置的节流下限:每个 token 都重建 timer 会新增成千上万次 JSI 调用。 */
export const WATCHDOG_REARM_THROTTLE_MS = 1_000;

export interface WatchdogDeps {
  /** 单调时钟(注入以便测试)。 */
  nowMs(): number;
  /** 到期回调(由控制器实现:写 error、abort runner、finishRun、notify)。 */
  onTimeout(): void;
}

export class RunWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastArm = 0;

  constructor(private readonly deps: WatchdogDeps) {}

  /** 本代最后一次 arm 的时间戳(测试/诊断用)。 */
  get lastArmedAt(): number {
    return this.lastArm;
  }

  /** 立即(重新)计时;已有 timer 先清。 */
  arm(): void {
    this.clear();
    this.lastArm = this.deps.nowMs();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deps.onTimeout();
    }, RUN_IDLE_TIMEOUT_MS);
  }

  /** 事件到达时调用:距上次 arm ≥ 节流下限才重置,否则忽略。 */
  rearm(): void {
    if (this.deps.nowMs() - this.lastArm < WATCHDOG_REARM_THROTTLE_MS) return;
    this.arm();
  }

  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
