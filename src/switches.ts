// 显式能力开关配置 —— 替代 process.env DISABLED 隐式通道(2026-08-16
// config-injection,父 design.md 契约 2)。语义 = enabled(true=启用)。
//
// 接线时序:app 层(App start/onSettingsChange)经
// `setCapabilitySwitches(switchesToCapabilities(settings.switches))` 显式注入;
// Node/server 无 app 层 → getCapabilitySwitches 懒初始化 fromEnv()——
// 从 process.env DISABLED 键反推,与旧 applySwitchesToEnv/envDisabledBool
// 语义逐位等价(键缺省/空/'0'/'false'/'no' → enabled true)。
// 消费点一律**惰性**读 getCapabilitySwitches()(禁止模块级求值——ROLES.enabled()
// 等谓词运行时求值,开关运行时生效)。
import { envValue } from './env.ts';

export interface CapabilitySwitches {
  tdxMcp: boolean; // TDX MCP(实时市场情报)
  webSearch: boolean; // 联网搜索
  billions: boolean; // 亿信总闸
  findb: boolean; // 金融问数
  search: boolean; // 搜索
  twitter: boolean; // 社交平台
  fetch: boolean; // 数据抓取
  analyst: boolean; // 信息面分析师
}

let current: CapabilitySwitches | null = null;

/** 显式注入(settings 面板语义 enabled → 直映,见 settings.switchesToCapabilities)。 */
export function setCapabilitySwitches(s: CapabilitySwitches): void {
  current = s;
}

/** 惰性读:未注入 → fromEnv()(env 反推,Node 直配 env 场景与旧语义逐位等价)。 */
export function getCapabilitySwitches(): CapabilitySwitches {
  if (!current) current = fromEnv();
  return current;
}

/** 从 process.env DISABLED 键反推(旧 envDisabledBool 语义:键缺省/空/'0'/
 *  'false'/'no' → enabled true;其余值 → disabled)。 */
export function fromEnv(): CapabilitySwitches {
  const enabled = (name: string): boolean => {
    const v = envValue(name);
    if (v === undefined || v === '') return true;
    return ['0', 'false', 'no'].includes(v.toLowerCase());
  };
  return {
    tdxMcp: enabled('TDX_MCP_DISABLED'),
    webSearch: enabled('WEB_SEARCH_DISABLED'),
    billions: enabled('BILLIONS_DISABLED'),
    findb: enabled('BILLIONS_FINDB_DISABLED'),
    search: enabled('BILLIONS_SEARCH_DISABLED'),
    twitter: enabled('BILLIONS_TWITTER_DISABLED'),
    fetch: enabled('BILLIONS_FETCH_DISABLED'),
    analyst: enabled('BILLIONS_ANALYST_DISABLED'),
  };
}
