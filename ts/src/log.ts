// 统一日志 —— 环境感知多 transport(2026-08-11 ts-log-persistence)
// 上移自 app/lib/log.ts,web/RN/Node/vitest 全端共用。路由:
//   web : console + POST 同源 /logs(server 汇聚落盘 logs/soa-ts.log)
//   RN  : console + expo-file-system 沙盒文件(Paths.document/soa-logs.log,
//         5MB 轮转)+ EXPO_PUBLIC_LOG_ENDPOINT 配置时上报
//   Node: console(server 端点原生 fs 落盘,不经客户端分支);vitest 不写文件
// 平台安全:不静态 import react-native / node:fs / expo-file-system——环境判定
// 用全局探针;expo-file-system 仅 RN 分支动态 import(模块级惰性初始化一次,
// 失败静默降级 console,不打断业务——error-handling 降级风格)。
// 密钥不写日志(settings.ts 已 mask,上报内容与 console 相同)。
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type Platform = 'web' | 'rn' | 'node';

// ts/ 为 node-only lib(tsconfig 无 DOM/RN 类型):声明全局,运行时 typeof 守卫
// (webSearch.ts 同款先例)。process 由 @types/node 提供,RN 端为 Metro polyfill。
declare const window: { location?: { origin?: string } } | undefined;
declare const document: unknown;
declare const navigator: { product?: string } | undefined;
declare global {
  var __SOA_DEBUG: string | undefined;
}

// ─── 环境探针 ──────────────────────────────────────────────────────────────
export function isWebEnv(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function isRnEnv(): boolean {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
}

export function isNodeEnv(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node;
}

/** web → rn → node(兜底:未知环境按 node,仅 console 不上报不落盘)。 */
export function detectPlatform(): Platform {
  if (isWebEnv()) return 'web';
  if (isRnEnv()) return 'rn';
  return 'node';
}

// ─── console transport(格式 [soa <level>] 逐字节不变,AC5)─────────────────
function consoleTransport(level: LogLevel, message: string): void {
  const line = `[soa ${level}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'debug' && __SOA_DEBUG === '1') console.debug(line);
  else console.log(line); // debug 未开门控时保持既有 fallthrough 行为
}

// ─── 行格式(server 端点与 RN 沙盒共用;server 侧实现见 app/lib/logs-server.cjs)─
export function formatLogLine(d: Date, level: LogLevel, message: string, platform: Platform): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return `${ts} | ${level.toUpperCase()} | [soa] ${message} (platform:${platform})`;
}

// ─── 上报 transport(fire-and-forget,失败静默)──────────────────────────────
export interface ReportPayload {
  ts: string;
  level: LogLevel;
  message: string;
  platform: Platform;
}

/** 进程环境读取(web 无 process;RN 为 Metro polyfill)。 */
function envValue(name: string): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env[name];
}

/** web → 同源 /logs;RN → EXPO_PUBLIC_LOG_ENDPOINT(空/未设 → '' 不上报)。 */
export function reportEndpoint(): string {
  if (isWebEnv()) {
    const origin = window?.location?.origin;
    return origin ? `${origin}/logs` : '';
  }
  return envValue('EXPO_PUBLIC_LOG_ENDPOINT') ?? '';
}

/** fire-and-forget POST {ts, level, message, platform}(keepalive 保底页面
 * 关闭前送达);失败 catch 静默,不打断业务。_fetch/_endpoint 注入点(测试)。 */
export function makeReporter(
  _fetch?: typeof fetch,
  _endpoint: () => string = reportEndpoint,
): (level: LogLevel, message: string, platform: Platform) => void {
  return (level, message, platform) => {
    const endpoint = _endpoint();
    if (!endpoint) return;
    const doFetch = _fetch ?? globalThis.fetch;
    const payload: ReportPayload = { ts: new Date().toISOString(), level, message, platform };
    void doFetch(endpoint, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  };
}

// ─── RN 沙盒文件 transport ────────────────────────────────────────────────
// expo-file-system SDK 52+ 新 API(File/Paths),仅 RN 分支动态 import 一次;
// append 走 read-modify-write(file.create + textSync + write,对齐设计);
// 文件 ≥5MB → moveSync 到 soa-logs.log.1 再开新文件(对齐 server 轮转语义)。
// NODE_ENV==='test' 或 SOA_LOG_FILE==='0' → 不写文件(vitest 不污染 logs/)。
export const RN_LOG_FILE = 'soa-logs.log';
const RN_LOG_MAX_BYTES = 5 * 1024 * 1024;

/** expo-file-system File 的最小使用面(测试注入 fake file API)。 */
export interface RnFileLike {
  readonly exists: boolean;
  readonly size: number;
  create(): void;
  write(contents: string): void;
  textSync(): string;
  moveSync(destination: RnFileLike): void;
}
export interface RnFileSystem {
  File: new (...uris: unknown[]) => RnFileLike;
  Paths: { document: unknown };
}

export function fileWriteDisabled(): boolean {
  return envValue('NODE_ENV') === 'test' || envValue('SOA_LOG_FILE') === '0';
}

/** RN 沙盒 transport 工厂。_writeDisabled 注入点(测试);失败静默降级 console。 */
export function makeRnFileTransport(
  _fs: RnFileSystem,
  _writeDisabled: () => boolean = fileWriteDisabled,
): (level: LogLevel, message: string) => void {
  return (level, message) => {
    if (_writeDisabled()) return;
    try {
      let file = new _fs.File(_fs.Paths.document, RN_LOG_FILE);
      if (file.exists && file.size >= RN_LOG_MAX_BYTES) {
        file.moveSync(new _fs.File(_fs.Paths.document, `${RN_LOG_FILE}.1`)); // 轮转:旧文件 → .1
        file = new _fs.File(_fs.Paths.document, RN_LOG_FILE); // 新句柄指向新文件
      }
      if (!file.exists) file.create();
      const line = formatLogLine(new Date(), level, message, 'rn');
      file.write(`${file.textSync()}${line}\n`);
    } catch {
      // 失败静默:console transport 已输出,不打断业务
    }
  };
}

// 模块级惰性初始化一次(仅 RN 分支触发)。动态 import 例外:expo-file-system
// 是平台专属模块,web/Node 包不含它——静态 import 会污染其他平台打包(design
// 约束);静态 specifier 是 Metro 打包要求。vitest(ts/ 根)解析不到该模块 →
// import 失败 → catch 静默降级;类型见 expo-file-system.d.ts。
let rnTransport: ((level: LogLevel, message: string) => void) | null = null;
let rnInit: Promise<void> | null = null;

async function initRnFileTransport(): Promise<void> {
  if (rnInit) return rnInit;
  rnInit = (async () => {
    try {
      const mod = await import('expo-file-system');
      rnTransport = makeRnFileTransport(mod as RnFileSystem); // 动态 import 边界 cast(类型见 d.ts)
    } catch {
      rnTransport = null; // 降级:仅 console
    }
  })();
  return rnInit;
}

// ─── 统一入口 ──────────────────────────────────────────────────────────────
const reporter = makeReporter();

export function log(level: LogLevel, message: string): void {
  consoleTransport(level, message);
  const p = detectPlatform();
  if (p === 'web') {
    reporter(level, message, 'web');
  } else if (p === 'rn') {
    reporter(level, message, 'rn');
    void initRnFileTransport().then(() => rnTransport?.(level, message));
  }
  // node:仅 console(server 端点原生落盘;vitest 不写文件)
}

export const info = (m: string): void => log('info', m);
export const warn = (m: string): void => log('warn', m);
export const error = (m: string): void => log('error', m);
export const debug = (m: string): void => log('debug', m);
