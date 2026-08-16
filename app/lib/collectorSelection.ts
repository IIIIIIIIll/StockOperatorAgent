// 采集实现平台选择(08-16-audit-remediation,collect-refactor)。
// 放 app 层而非 src/:动态 import 目标(deviceBridge)须在 metro 项目根内,
// src/ 保持纯净(不反向依赖 app/)。web 直接返回静态实现(collectForWeb);
// 真机经 loadDeviceImpl 动态加载桥(默认 deviceBridge.collectForDevice)。
// loadDeviceImpl 注入面:测试替换 fake 实现,不触发真实模块加载。
import type { MarketCollector } from '../../src/collector.ts';

async function loadDeviceCollector(): Promise<MarketCollector> {
  return (await import('./deviceBridge')).collectForDevice;
}

/** 平台 → 采集实现。web 静态绑定;'rn' 经 loadDeviceImpl 动态加载。 */
export async function selectCollector(
  platform: 'web' | 'rn',
  webImpl: MarketCollector,
  loadDeviceImpl: () => Promise<MarketCollector> = loadDeviceCollector,
): Promise<MarketCollector> {
  return platform === 'web' ? webImpl : await loadDeviceImpl();
}
