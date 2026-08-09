// 进度/报告事件协议 —— 对齐 Python core/llms/progress.py
// ProgressBridge 语义：info(进度文本) / pushReport(节点报告)——线程安全
// 入队、永不抛。M3 接 UI；此处形状契约 + 容错。

export interface ProgressUpdater {
  info(msg: string): void;
  pushReport(key: string, content: string): void;
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
