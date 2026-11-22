// expo-file-system 的写入口径 —— SDK 58 把 `File.write()` 改成了**异步**
// (返回 Promise),同步版本拆成 `writeSync()`。
//
// 为什么必须收口到一处:本仓所有落盘都是「写 tmp(或目标)→ moveSync 原子替换」。
// 只要 write 是异步而调用点没 await,move 就会在内容落地之前执行 → 目标文件是
// **空文件**。安卓 release 实测症状:历史归档出现 0 字节的 `<id>.json` 与
// `index.json`(冷启动时「历史正文损坏:Unexpected end of input」,点开历史永远
// 「历史记录不存在或已损坏」),且 App 自己的日志一片干净。
//
// 同步调用点(settingsStore 的同步 save 契约、log 的追加)必须走 writeSync;
// 异步调用点直接 `await file.write(...)`(await 非 Promise 也无害,兼容 SDK 57)。

/** 同步写所需的最小面(expo `File` 的结构子集;测试可注入 fake)。 */
export interface SyncWritableFile {
  /** SDK ≤57 是同步写(void);SDK 58 起返回 Promise(不接手会丢失写入)。 */
  write(contents: string, options?: { append?: boolean }): void | Promise<void>;
  /** SDK 58 起的同步写。缺席 = 旧运行时(write 本身同步)。 */
  writeSync?(contents: string, options?: { append?: boolean }): void;
}

/** 同步写入:有 writeSync 就用它,否则退回旧运行时的同步 write。
 *  绝不 `void file.write()` —— 在 SDK 58 上那等于「发起写入然后假装完成」。 */
export function writeNow(
  file: SyncWritableFile,
  contents: string,
  options?: { append?: boolean },
): void {
  if (file.writeSync) {
    file.writeSync(contents, options);
    return;
  }
  // 旧运行时:write 本身同步。显式丢弃返回值(SDK 58 上这里是 Promise)。
  void file.write(contents, options);
}
