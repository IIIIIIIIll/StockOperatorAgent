// 轻量日志 —— 统一实现已上移 ts/src/log.ts(2026-08-11 ts-log-persistence,
// 环境感知 transport:web 上报 / RN 沙盒文件 / Node console),本文件仅重导出,
// 既有 import(App.tsx / settings.ts)零改动。
export { log, info, warn, error, debug } from '../../src/log.ts';
export type { LogLevel } from '../../src/log.ts';
