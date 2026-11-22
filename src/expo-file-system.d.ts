// 环境模块声明:ts/ 根(node-only lib)不含 expo-file-system(实装在 ts/app,
// SDK 57 由 expo install 对齐)。log.ts 的 RN 分支与 store-file.ts 生产默认后端
// 动态 import 该模块,此处镜像 SDK 57 真实 API 中我们用到的面(File/Paths/
// Directory;完整类型见 ts/app/node_modules/expo-file-system/build/)。若 ts/ 根
// 将来能解析到真包,真实类型优先于本声明,删除本文件即可。
declare module 'expo-file-system' {
  export class File {
    constructor(...uris: unknown[]);
    readonly exists: boolean;
    readonly size: number;
    create(): void;
    /** SDK 58 起 `write` 是**异步**的(返回 Promise);同步写用 `writeSync`。
     *  旧声明写 `void` 是 SDK 57 的签名 —— 沿用会让所有「写 tmp → moveSync」
     *  的原子写拿到空文件(安卓 release 实测踩过)。同步调用点统一走
     *  src/fsWrite.ts 的 writeNow()。
     *  FileWriteOptions:{ append?: boolean }(默认 false = 覆写),日志追加依赖它。 */
    write(contents: string, options?: { append?: boolean }): Promise<void>;
    writeSync(contents: string, options?: { append?: boolean }): void;
    text(): Promise<string>;
    textSync(): string;
    /** SDK 57 真实签名带 RelocationOptions:{ overwrite?: boolean },默认 false
     *  (不覆盖已存在目标,直接抛错)—— 原子替换必须显式传 { overwrite: true }
     *  (store-file.ts 生产后端 writeFile 依赖此语义)。 */
    moveSync(destination: File, options?: { overwrite?: boolean }): void;
    /** SDK 57 同步删除(不存在时抛错 —— 调用方先判 exists;历史归档删除用)。 */
    delete(): void;
  }
  export class Directory {
    constructor(...uris: unknown[]);
    readonly exists: boolean;
    readonly uri: string;
    create(options?: { intermediates?: boolean; idempotent?: boolean }): void;
    list(): { name: string }[];
  }
  export const Paths: { document: Directory };
}
