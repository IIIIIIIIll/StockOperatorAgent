// 进度/报告事件协议 —— 对齐 Python core/llms/progress.py
// ProgressBridge 语义：info(进度文本) / pushReport(节点报告)——线程安全
// 入队、永不抛。M3 接 UI；此处形状契约 + 容错。
// 08-11-ts-streaming-output 新增(可选):pushDelta/pushStatus —— agent 级流式
// token 增量 + 角色生命周期(方案 B,D1);方法可选 → 现有 fake/调用方零改动。

/** 角色生命周期状态(running 于首调前、done 于 pushReport 后、retry 复位)。 */
export type RoleStatus = 'running' | 'done' | 'retry';

export interface ProgressUpdater {
  info(msg: string): void;
  pushReport(key: string, content: string): void;
  /** 流式文本增量(node 为图节点名;UI 按 node 缓冲)。可选,缺省 no-op。 */
  pushDelta?(node: string, delta: string): void;
  /** 角色生命周期状态(node 为图节点名)。可选,缺省 no-op。 */
  pushStatus?(node: string, status: RoleStatus): void;
}

/** safe_progress：updater 缺失/抛错 → no-op（降级，图不中断）。 */
export function safeProgress(updater: ProgressUpdater | null | undefined, msg: string): void {
  try {
    updater?.info(msg);
  } catch {
    /* 降级：进度丢失不阻断图 */
  }
}

/** push_report：同 safe_progress——None/非 bridge updater 为 no-op。 */
export function pushReport(
  updater: ProgressUpdater | null | undefined,
  key: string,
  content: string,
): void {
  try {
    updater?.pushReport(key, content);
  } catch {
    /* 降级：报告丢失不阻断图 */
  }
}

/** safe_push_delta：同 safeProgress——token 丢失降级,不阻断生成。 */
export function safePushDelta(
  updater: ProgressUpdater | null | undefined,
  node: string,
  delta: string,
): void {
  try {
    updater?.pushDelta?.(node, delta);
  } catch {
    /* 降级：token 丢失不阻断图 */
  }
}

/** safe_push_status：同 safeProgress——状态丢失降级,不阻断生成。 */
export function safePushStatus(
  updater: ProgressUpdater | null | undefined,
  node: string,
  status: RoleStatus,
): void {
  try {
    updater?.pushStatus?.(node, status);
  } catch {
    /* 降级：状态丢失不阻断图 */
  }
}
