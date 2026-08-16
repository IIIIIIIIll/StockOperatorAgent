// 进程环境读取单点 —— 自 log.ts 提升(2026-08-16 config-injection)
// 全端共用:web 无 process(守卫返回 undefined)、RN 为 Metro polyfill、Node 原生。
// 纪律(architecture 契约 6):src 下 process.env 访问一律经本文件;EXPO_PUBLIC_*
// 直读例外——babel-preset-expo 仅内联**直接成员访问**(webSearch.defaultSearcher /
// deviceCollect.DEVICE_TDX_HOSTS / settings.ts loadSettings 白名单,见各处注释)。
export function envValue(name: string): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env[name];
}
