// 运行能力接缝 —— 「我是什么端、能做什么」的唯一判定点(2026-11 架构整改)。
//
// 整改前的状况:同一个问题有两套探针在独立回答,散在 8 个文件 20 处。
//   `Platform.OS === 'web'`        (react-native 侧)        ×13
//   `detectPlatform() === 'web'`   (src/log.ts 环境嗅探)     ×5
//   `isDesktopBridge()`            (window.__soaDesktop)     ×2
// 今天三者答案一致(RNW 下 window/document 都在、Platform.OS 也是 'web'),但
// 任何新平台(或 jsdom 测试壳)都会让它们分叉 —— 而分叉的表现是图表走 WebView
// 分支、采集走直连分支,静默错,不报错。useAnalysis.ts:43-46 的注释记录过一次
// 擦肩而过。
//
// 本模块只做一件事:把三套探针合成一个 memoized 的只读对象。它**不 import
// react-native**(否则 node/vitest 下的 runner/settingsStore 会连带引入 RN
// 运行时)。需要 OS 精确粒度的少数位置(android 原生保活模块、iOS/Android 的
// cleartext 提示、drawer 动画类型)继续直接读 Platform.OS —— 那是「原生模块在
// 不在 / 系统长什么样」,不是「我是哪个端」,不属于本接缝。

import { detectPlatform } from '../../src/log.ts';
import { isDesktopBridge } from './desktopBridge.ts';

/** desktop = Electron renderer(存在 window.__soaDesktop 桥);其余来自环境嗅探。 */
export type AppPlatform = 'web' | 'rn' | 'node' | 'desktop';

export interface AppCapabilities {
  /** 端身份。desktop 优先于 web —— Electron renderer 同时满足 window+document。 */
  readonly platform: AppPlatform;
  /** 有 DOM(浏览器 / Electron renderer):图表可直接挂 DOM,采集需同源代理。 */
  readonly hasDom: boolean;
  readonly isWeb: boolean;
  readonly isRn: boolean;
  readonly isNode: boolean;
  readonly isDesktop: boolean;
  /** 采集必须经 server.mjs 同源代理(浏览器无原始 TCP / 无 CORS)。 */
  readonly collectViaProxy: boolean;
  /** 初始存储后端。desktop 仍走 idb —— 桥注入后由 DesktopStore 顶替(不变)。 */
  readonly storageBackend: 'idb' | 'file';
}

function compute(): AppCapabilities {
  let platform: AppPlatform;
  if (isDesktopBridge()) {
    // Electron renderer 同时满足 window+document,必须排在 web 之前。
    platform = 'desktop';
  } else {
    platform = detectPlatform(); // 'web' | 'rn' | 'node'
  }
  const isDesktop = platform === 'desktop';
  const isWeb = platform === 'web';
  const isRn = platform === 'rn';
  const hasDom = isWeb || isDesktop;
  return {
    platform,
    hasDom,
    isWeb,
    isRn,
    isNode: platform === 'node',
    isDesktop,
    collectViaProxy: hasDom,
    // 与整改前逐字节一致:只有浏览器族走 IdbStore,rn/node 走 FileStore
    // (desktop renderer 与 web 同 —— 随后被 DesktopStore 顶替,不动)。
    storageBackend: hasDom ? 'idb' : 'file',
  };
}

let cached: AppCapabilities | null = null;

/** 惰性 memo:探针只跑一次(桌面桥在模块加载后才存在,故不在模块顶层求值)。 */
export function capabilities(): AppCapabilities {
  if (!cached) cached = compute();
  return cached;
}

/** 测试专用:清缓存以重算探针(桥注入 / store 注入类测试用)。 */
export function resetCapabilitiesCache(): void {
  cached = null;
}
