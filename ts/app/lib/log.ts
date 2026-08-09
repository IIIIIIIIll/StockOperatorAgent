// 轻量日志 —— 对齐 Python loguru 的信息层级,前缀 [soa]
// 浏览器 console 可见;Expo dev server 会把客户端 console 转发到终端。
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const DEBUG = (globalThis as { __SOA_DEBUG?: string }).__SOA_DEBUG === '1';

export function log(level: LogLevel, message: string): void {
  const line = `[soa ${level}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'debug' && DEBUG) console.debug(line);
  else console.log(line);
}

export const info = (m: string): void => log('info', m);
export const warn = (m: string): void => log('warn', m);
export const error = (m: string): void => log('error', m);
export const debug = (m: string): void => log('debug', m);
