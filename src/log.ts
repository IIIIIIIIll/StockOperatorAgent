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
import { envValue } from './env.ts';
import { writeNow } from './fsWrite.ts';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type Platform = 'web' | 'rn' | 'node';

// ts/ 为 node-only lib(tsconfig lib=ES2024+DOM:fetch/AbortSignal 等 web 平台
// 类型取 DOM lib 单源,与 @types/node 26.2 web-globals 的 AbortSignal 形状错位
// 冲突——08-16-tech-debt-cleanup 实证;RN 端类型由 app/ tsconfig 另行覆盖):
// 声明模块级守卫,运行时 typeof 守卫 (webSearch.ts 同款先例)。process 由
// @types/node 提供,RN 端为 Metro polyfill。
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

/** 上报端点白名单（P2 评审 2026-11-21）。
 *
 *  旧实现对 EXPO_PUBLIC_LOG_ENDPOINT 完全不校验：一个手滑的 `http://` 或第三方
 *  主机就会把每次运行的日志（ticker、上游错误文本、LLM 回复前缀）明文发出去。
 *  web 分支本来就钉死为同源；RN 分支按这里收紧：
 *  - https: 一律放行（传输已加密）
 *  - http: 仅回环/私网（开发期本机 server），公网明文一律拒
 *  - 其它协议（file:/javascript: 等）一律拒
 */
export function isAllowedReportEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')) {
    return true;
  }
  // RFC1918 私网:开发机的局域网地址（手机连本机 server 的常见形态）
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/** web → 同源 /logs;RN → EXPO_PUBLIC_LOG_ENDPOINT(空/未设 → '' 不上报)。 */
export function reportEndpoint(): string {
  if (isWebEnv()) {
    const origin = window?.location?.origin;
    return origin ? `${origin}/logs` : '';
  }
  const endpoint = envValue('EXPO_PUBLIC_LOG_ENDPOINT') ?? '';
  if (!endpoint) return '';
  if (!isAllowedReportEndpoint(endpoint)) {
    // 只报一次（用模块级标志），否则每条日志都会刷一行「端点被拒」
    if (!warnedBadEndpoint) {
      warnedBadEndpoint = true;
      console.warn(
        `[soa] EXPO_PUBLIC_LOG_ENDPOINT 被拒(仅接受 https 或回环/私网 http):${endpoint}`,
      );
    }
    return '';
  }
  return endpoint;
}

let warnedBadEndpoint = false;

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
    // S6:远程模式(server HOST=0.0.0.0 非回环)要求 X-SOA-Token == SOA_ACCESS_TOKEN
    // (web 同源 /logs 与 RN EXPO_PUBLIC_LOG_ENDPOINT 均可能指向非回环 server)。
    // 直接成员访问(EXPO_PUBLIC_* 内联契约,architecture 契约 6 豁免);未设 → 不带头。
    const soaToken = process.env.EXPO_PUBLIC_SOA_ACCESS_TOKEN;
    const payload: ReportPayload = { ts: new Date().toISOString(), level, message, platform };
    void doFetch(endpoint, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(soaToken ? { 'X-SOA-Token': soaToken } : {}),
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  };
}

// ─── RN 沙盒文件 transport ────────────────────────────────────────────────
// expo-file-system SDK 52+ 新 API(File/Paths),仅 RN 分支动态 import 一次;
// 追加走 File.write(line, { append: true })(O(行) 而非 O(文件))。
// 文件 ≥5MB → moveSync 到 soa-logs.log.1 再开新文件(对齐 server 轮转语义)。
// NODE_ENV==='test' 或 SOA_LOG_FILE==='0' → 不写文件(vitest 不污染 logs/)。
export const RN_LOG_FILE = 'soa-logs.log';
const RN_LOG_MAX_BYTES = 5 * 1024 * 1024;

/** expo-file-system File 的最小使用面(测试注入 fake file API)。 */
export interface RnFileLike {
  readonly exists: boolean;
  readonly size: number;
  create(): void;
  /** SDK ≤57 是同步写;SDK 58 起返回 Promise —— 同步路径必须走 writeSync
   *  (统一收口在 src/fsWrite.ts 的 writeNow,否则日志会丢写)。 */
  write(contents: string, options?: { append?: boolean }): void | Promise<void>;
  writeSync?(contents: string, options?: { append?: boolean }): void;
  textSync(): string;
  moveSync(destination: RnFileLike, options?: { overwrite?: boolean }): void;
}
export interface RnFileSystem {
  File: new (...uris: unknown[]) => RnFileLike;
  Paths: { document: unknown };
}

export function fileWriteDisabled(): boolean {
  return envValue('NODE_ENV') === 'test' || envValue('SOA_LOG_FILE') === '0';
}

/** RN 沙盒 transport 工厂。_writeDisabled 注入点(测试);失败静默降级 console。
 *  追加走 File.write(line, { append: true })(O(行) 而非 O(文件))。
 *  旧实现每条日志都 textSync() 读回整文件再整体 write —— 单次分析几十条日志、
 *  文件到 MB 级时,把 JS 线程按秒级同步 I/O 卡住(真机解密文件系统更慢)。 */
export function makeRnFileTransport(
  _fs: RnFileSystem,
  _writeDisabled: () => boolean = fileWriteDisabled,
): (level: LogLevel, message: string) => void {
  return (level, message) => {
    if (_writeDisabled()) return;
    try {
      let file = new _fs.File(_fs.Paths.document, RN_LOG_FILE);
      if (file.exists && file.size >= RN_LOG_MAX_BYTES) {
        // F03:二次轮转时 .1 已存在——必须 overwrite,否则 moveSync 抛错 → 日志中断
        file.moveSync(new _fs.File(_fs.Paths.document, `${RN_LOG_FILE}.1`), { overwrite: true });
        file = new _fs.File(_fs.Paths.document, RN_LOG_FILE); // 新句柄指向新文件
      }
      if (!file.exists) file.create();
      const line = formatLogLine(new Date(), level, message, 'rn');
      writeNow(file, `${line}\n`, { append: true });
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
