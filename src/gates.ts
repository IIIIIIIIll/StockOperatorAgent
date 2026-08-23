// freshness 门 —— 移植自 Python（data_acquisition / time_helper）
// 节假日日历未建模（已知缺陷，与 Python 侧一致保留）
import { marketInfo, type Market } from './market.ts';

/** 某市场时区"今天" YYYY-MM-DD（en-CA 格式逐字节对齐 Python asia_today）。
 *  港美股沿用 CN 周末规则（getLastBusinessDay 仅周末、无节假日日历，与 CN
 *  一致保留——见 coupling-map）。 */
export function marketToday(market: Market): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: marketInfo(market).timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** 北京时间"今天" YYYY-MM-DD（对齐 Python asia_today，全仓唯一"今天"来源；
 *  委托 marketToday('cn')，输出逐字节不变）。 */
export function asiaToday(): string {
  return marketToday('cn');
}

/** get_last_business_day：周六 → 周五(-1)，周日 → 周五(-2)，其余当天。 */
export function getLastBusinessDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun
  const diff = dow === 0 ? 2 : dow === 6 ? 1 : 0;
  return new Date(d.getTime() - diff * 86_400_000).toISOString().slice(0, 10);
}

/** 最近一个"已到截止日"的季度末（%Y%m%d 字符串；0331/0630/0930/1231）。 */
export function latestPastQuarterEnd(today: string): string | null {
  const y = Number(today.slice(0, 4));
  const todayYmd = today.replace(/-/g, '');
  const candidates = [
    `${y}1231`, `${y}0930`, `${y}0630`, `${y}0331`,
    `${y - 1}1231`, `${y - 1}0930`, `${y - 1}0630`, `${y - 1}0331`,
  ];
  for (const q of candidates) {
    if (q <= todayYmd) return q;
  }
  return null;
}

/** 业绩门：最新 report_date == 最近已过季度末 → 新鲜（不拉远端）。 */
export function reportsFresh(latestReportDate: string | null, today: string): boolean {
  if (latestReportDate === null) return false;
  return latestReportDate === latestPastQuarterEnd(today);
}

/** 日K 门：lastDataUpdate == 北京时间今天 → 同日已采集，跳过重拉（对齐 Python
 *  acquire_historical_data_tdx `last_data_update == asia_today()` 跳过语义）。 */
export function dailyFresh(lastDataUpdate: string | null, today: string): boolean {
  return lastDataUpdate !== null && lastDataUpdate === today;
}

/** 采集跳过判定（C8 接线点，供 runner.collectForWeb 消费）：依据 store 现有数据
 *  （stock.lastDataUpdate / performance_reports 最新 report_date）判定本次各源
 *  是否可跳过——dailyFresh 同日跳过日K；f10Fresh 同季跳过 F10 财务分析节。
 *  部分 fresh 不整体短路：各源独立判定，调用方按源传递跳过标记。 */
export interface FreshnessGates {
  dailyFresh: boolean;
  f10Fresh: boolean;
}

export function freshnessGates(
  lastDataUpdate: string | null,
  latestReportDate: string | null,
  today: string,
): FreshnessGates {
  return {
    dailyFresh: dailyFresh(lastDataUpdate, today),
    f10Fresh: reportsFresh(latestReportDate, today),
  };
}
