// freshness 门 + FetchScope —— 移植自 Python（data_acquisition / time_helper）
// 节假日日历未建模（已知缺陷，与 Python 侧一致保留）

/** 北京时间"今天" YYYY-MM-DD（对齐 Python asia_today，全仓唯一"今天"来源）。 */
export function asiaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** get_last_business_day：周六 → 周五(-1)，周日 → 周五(-2)，其余当天。 */
export function getLastBusinessDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun
  const diff = dow === 0 ? 2 : dow === 6 ? 1 : 0;
  return new Date(d.getTime() - diff * 86_400_000).toISOString().slice(0, 10);
}

/** overview 门：overviewLastUpdate 早于最近交易日 → 需刷新（对齐 Python
 *  `overview_last_update.date() < get_last_business_day(asia_today())`）。 */
export function overviewNeedsRefresh(overviewLastUpdate: string | null, today: string): boolean {
  if (overviewLastUpdate === null) return true;
  return overviewLastUpdate < getLastBusinessDay(today);
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

/** FetchScope：单遍拉取去重——复用判定按**请求尺寸**（cached_bars ≥ 请求）
 *  而非实际行数（短历史股票 250 拉取返回 <250 行是完整数据，按 len 判定
 *  会错误重拉——对齐 Python spec）。 */
export class FetchScope {
  private cached = new Map<string, number>();

  /** 记录某 key 已满足的**请求尺寸**（拉取时传请求的 max_bars，非实际行数）。 */
  record(key: string, requestedBars: number): void {
    this.cached.set(key, Math.max(this.cached.get(key) ?? 0, requestedBars));
  }

  /** 请求尺寸满足（cached ≥ requested）→ 可复用。 */
  canReuse(key: string, requestedBars: number): boolean {
    return (this.cached.get(key) ?? 0) >= requestedBars;
  }
}
