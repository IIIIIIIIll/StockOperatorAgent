// 采集实现平台+市场选择(08-16-audit-remediation,collect-refactor;S3 市场感知)。
// 放 app 层而非 src/:动态 import 目标(deviceBridge)须在 metro 项目根内,
// src/ 保持纯净(不反向依赖 app/)。web 直接返回静态 webImpls[market]
// (cn → collectForWeb;hk/us → collectYahooViaProxy,base 由调用方绑定闭包);
// 真机经 loadDeviceImpls 动态加载桥后取 deviceImpls[market](cn →
// collectForDevice;hk/us → collectYahooForDevice)。
// loadDeviceImpls 注入面:测试替换 fake 实现,不触发真实模块加载。
// 签名不设默认实现(避免 app/lib → src/yahoo → app 循环;import 面保持可 fake),
// Record 由调用方(useAnalysis/collectForWeb)组装传入。
import type { MarketCollector } from '../../src/collector.ts';
import type { Market } from '../../src/market.ts';

async function loadDeviceCollectors(): Promise<Record<Market, MarketCollector>> {
  const bridge = await import('./deviceBridge');
  return { cn: bridge.collectForDevice, hk: bridge.collectYahooForDevice, us: bridge.collectYahooForDevice };
}

/** 平台+市场 → 采集实现。web 静态绑定(webImpls[market]);'rn' 经
 *  loadDeviceImpls 动态加载后取 deviceImpls[market]。 */
export async function selectCollector(
  platform: 'web' | 'rn',
  market: Market,
  webImpls: Record<Market, MarketCollector>,
  loadDeviceImpls: () => Promise<Record<Market, MarketCollector>> = loadDeviceCollectors,
): Promise<MarketCollector> {
  return platform === 'web' ? webImpls[market] : (await loadDeviceImpls())[market];
}
