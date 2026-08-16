// 平台无关采集接口 + 共享 freshness 门(08-16-collect-refactor,D1)
// 两个采集实现同形:web 走同源代理(collectForWeb,runner.ts)/真机 TDX 直连
// (collectForDevice,tdx/deviceCollect.ts)——输入 ticker+CollectSkipOpts、
// 输出 WebCollectResult,skip 判定共用 resolveSkipGates(store 现状自动判定,
// 显式布尔覆盖)。平台选择(selectCollector)在 app 层(app/lib/
// collectorSelection.ts)——动态 import 目标须在 metro 项目根内,src 不反向
// 依赖 app。
// 纯 TS、零平台依赖:仅 import type 触碰 webCollect/store(better-sqlite3 链
// 不进 bundle);gates/log 为全端共享轻量模块。
import type { StoreLike } from './store.ts';
import type { CollectSkipOpts, WebCollectResult } from './webCollect.ts';
import { asiaToday, freshnessGates } from './gates.ts';
import { info } from './log.ts';

/** 平台无关采集器:web(collectForWeb)与真机(collectForDevice)两实现均满足
 *  同一可调用契约(签名逐字对齐,结构兼容)。失败抛错 → 调用方中止分析,不喂
 *  空数据。选可调用函数而非 {collect} 对象面:两实现即裸函数,零包装。 */
export type MarketCollector = (ticker: string, opts?: CollectSkipOpts) => Promise<WebCollectResult>;

/** 采集跳过判定(collectForWeb / collectForDevice 共享,原两处逐行重复逻辑):
 *  opts 缺省(undefined)按 store 现有数据自动判定——dailyFresh 同日跳过日K、
 *  f10Fresh 同季跳过 F10(performance_reports 最新 report_date == 最近已过
 *  季度末);显式布尔值覆盖自动判定(测试/调试用)。部分 fresh 不整体短路。
 *  skipped 为可跳过源的中文标签(日志/测试断言用)。 */
export function resolveSkipGates(
  store: StoreLike,
  ticker: string,
  opts?: CollectSkipOpts,
): { skipDaily: boolean; skipF10: boolean; skipped: string[] } {
  const today = asiaToday();
  const stock = store.getStock(ticker);
  const reports = store.getPerformanceReports(ticker);
  const latestReportDate = reports.reduce((m, r) => (r.report_date > m ? r.report_date : m), '') || null;
  const gates = freshnessGates(stock?.lastDataUpdate ?? null, latestReportDate, today);
  const skipDaily = opts?.skipDaily ?? gates.dailyFresh;
  const skipF10 = opts?.skipF10 ?? gates.f10Fresh;
  const skipped: string[] = [];
  if (skipDaily) skipped.push('日K(同日已采集)');
  if (skipF10) skipped.push('F10财务分析(同季已入库)');
  if (skipped.length) info(`跳过采集:${skipped.join('、')},沿用既有数据`);
  return { skipDaily, skipF10, skipped };
}
