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

/** 各市场收盘时刻（本地时区 时:分）。无集合竞价/半日市建模（与 marketToday
 *  的周末口径一致保留）。 */
const MARKET_CLOSE_HHMM: Record<Market, readonly [number, number]> = {
  cn: [15, 0],
  hk: [16, 0],
  us: [16, 0],
};

/** 该市场"当日交易是否已收盘"（按市场时区判定）。
 *
 *  用途（评审 2026-11-09 P1-7）：日K 的 lastDataUpdate 戳会被 dailyFresh 当作
 *  "今天已经采过、可跳过"的依据。盘中采集到的末根是**未收盘**的进行中 bar
 *  （close=当时价、量未累计完），若照样盖今天的戳，收盘后的分析就会按
 *  skipDaily 复用这根残缺 bar 一整天（仓库已在
 *  .trellis/spec/data_source/tdx.md:165-168 记录同类问题）。
 *
 *  周末恒 true（无交易）。Intl 解析失败 → 保守返回 true（维持旧行为，不因
 *  时区/ICU 差异改变持久化语义）。 */
export function marketSessionClosed(market: Market, now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: marketInfo(market).timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = pick('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return true;
  const hh = Number(pick('hour'));
  const mm = Number(pick('minute'));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return true;
  const [closeH, closeM] = MARKET_CLOSE_HHMM[market];
  return hh * 60 + mm >= closeH * 60 + closeM;
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
