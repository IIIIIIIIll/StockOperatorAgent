// 设置持久化 —— 平台分发的 JSON 字符串 KV(web:localStorage;RN:沙盒文件;
// Node 桌面:node fs 适配器经 _fs 注入)
// 对接 settings.ts 的 loadSettings/saveSettings(JSON parse/merge 仍在其内);
// 本模块只有 load/save 字符串面,存储层不解析 JSON。RN 用 expo-file-system
// 同步 API(textSync/write)——loadSettings 是 React useState 初始化器的同步
// 调用,不能依赖 storeReady() 异步生命周期。
// 平台安全:不静态 import react-native / expo-file-system / node:fs——web 判定走
// src/log.ts 探针;expo-file-system 仅 RN 分支动态 import(模块级惰性解析一次,
// 失败静默降级 → load null / save no-op,不打断业务,同 log.ts/store-file.ts
// 先例)。**node:fs 禁令**:本文件在 metro 图内,禁止 import node:fs,Node 桌面
// 壳只能经 _fs 注入 src/store-node.ts 的 nodeSettingsFileSystem()(expo File 面
// ↔ node fs 面的薄包装)。任何读写失败均不抛出。
import { isRnEnv, isWebEnv } from '../../src/log.ts';
import { bridgeStorage, isDesktopBridge } from './desktopBridge.ts';

export interface SettingsStore {
  load(): string | null;
  save(s: string): void;
}

/** localStorage 最小使用面(测试注入 fake;web 分支)。 */
export interface SettingsStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** expo-file-system File 的最小使用面(测试注入 fake;同 log.ts RnFileLike)。 */
export interface RnFileLike {
  readonly exists: boolean;
  create(): void;
  write(contents: string): void;
  textSync(): string;
}
export interface RnFileSystem {
  File: new (...uris: unknown[]) => RnFileLike;
  Paths: { document: unknown };
}

const KEY = 'soa:settings';
const RN_SETTINGS_FILE = 'soa-settings.json';

// ts/ 根无 DOM 类型:localStorage 仅 web 环境存在——模块级环境声明 + 运行时
// 守卫(log.ts 的 window/document/navigator 同款姿势;web 分支兜底时经探针分发)。
declare const localStorage: SettingsStorageLike | undefined;

// ─── RN 后端:expo-file-system 惰性解析一次(同 store-file.ts getExpoBackend /
//     log.ts initRnFileTransport 先例)。动态 import 例外:expo-file-system 是
//     平台专属模块,web/Node 包不含它——静态 specifier 是 Metro 打包要求;
//     vitest(node)解析失败 → catch 静默降级。类型见 src/expo-file-system.d.ts。
let rnFs: RnFileSystem | null = null;
let rnFsPromise: Promise<RnFileSystem | null> | null = null;

function getRnFileSystem(): Promise<RnFileSystem | null> {
  rnFsPromise ??= (async () => {
    try {
      const mod = await import('expo-file-system');
      rnFs = mod as unknown as RnFileSystem; // 动态 import 边界 cast(类型见 d.ts)
    } catch {
      rnFs = null; // 降级:RN 后端不可用 → load null / save no-op
    }
    return rnFs;
  })();
  return rnFsPromise;
}

// RN 冷启动保真:模块加载即触发惰性 import(Metro 打包的本地模块,数个微任务内
// 决议)→ useState 初始化器首次 load() 时后端已就绪;web/Node 不触发(vitest
// 不解析 RN 平台模块,同 log.ts 降级姿态)。
if (isRnEnv()) void getRnFileSystem();

/** web 分支后端:localStorage(运行时守卫;访问抛错/缺失 → undefined)。 */
function webStorage(): SettingsStorageLike | undefined {
  try {
    return localStorage;
  } catch {
    return undefined; // 隐私模式等访问抛错 → 走 RN 分支降级(null)
  }
}

/**
 * settingsStore 工厂。_localStorage/_fs 注入点(测试/桌面壳):
 *  - 显式 _localStorage → 恒走 web 分支(localStorage);
 *  - 显式 _fs → 恒走文件分支 —— RN 传 expo-file-system,Node 桌面壳传
 *    src/store-node.ts 的 nodeSettingsFileSystem()(node:fs 薄包装;本文件
 *    在 metro 图内禁止 import node:fs,只接受注入);
 *  - 生产(都不传)→ 按 isWebEnv 探针分发(RN 惰性解析 expo-file-system)。
 */
export function createSettingsStore(
  _localStorage?: SettingsStorageLike | null,
  _fs?: RnFileSystem | null,
): SettingsStore {
  const web: SettingsStorageLike | undefined =
    _localStorage ?? (isWebEnv() ? webStorage() : undefined);

  function loadFromFile(fs: RnFileSystem | null): string | null {
    if (!fs) {
      void getRnFileSystem(); // 后端未就绪 → 触发惰性 import;本次返回 null
      return null;
    }
    try {
      const file = new fs.File(fs.Paths.document, RN_SETTINGS_FILE);
      return file.exists ? file.textSync() : null;
    } catch {
      return null; // 读取失败 → 视为无存储,不抛出
    }
  }

  return {
    // S7:设置(含 LLM/亿信 API key)以明文存于 localStorage(web)/soa-settings.json
    // (RN/Node 桌面)——本地优先设计使然,无服务端兜底;系统安全存储(Keychain/
    // KeyStore)为后续工作,启用前不承诺密钥落盘加密。
    load(): string | null {
      if (web !== undefined) {
        try {
          return web.getItem(KEY);
        } catch {
          return null; // 读取失败 → 视为无存储,不抛出
        }
      }
      return loadFromFile(_fs ?? rnFs);
    },
    save(s: string): void {
      if (web !== undefined) {
        try {
          web.setItem(KEY, s);
        } catch {
          /* 写入失败 → 静默(同原 settings.ts 语义) */
        }
        return;
      }
      const fs = _fs ?? rnFs;
      if (!fs) {
        void getRnFileSystem();
        return;
      }
      try {
        const file = new fs.File(fs.Paths.document, RN_SETTINGS_FILE);
        if (!file.exists) file.create();
        file.write(s);
      } catch {
        /* 写入失败 → 静默 */
      }
    },
  };
}

// 桌面壳桥接:window.__soaDesktop 存在 → bridgeStorage 注入 web 分支
// (getItem/setItem 映射桥的 settingsLoad/settingsSave,单键语义,零 fs 适配);
// 否则按原 isWebEnv 分发(web/RN 零行为变化)。
const singleton = isDesktopBridge() ? createSettingsStore(bridgeStorage(), null) : createSettingsStore();

export function load(): string | null {
  return singleton.load();
}
export function save(s: string): void {
  singleton.save(s);
}
