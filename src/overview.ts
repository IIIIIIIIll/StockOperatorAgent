// 22 列个股概览 —— 移植自 data_source/chinese_mainland/tdx/overview.py
// compose_overview 纯函数:由 snapshot/capital/F10/日K 合成;NaN 语义逐项对齐
// （pytdx 无字段:量比/涨速/5分钟涨跌 → NaN;除零/分母≤0 → NaN）。
// 字段名说明（C4 决策 2026-08-14）：TS 键为 amount/open_/prev_close/
// change_percent_60d，对应 Python StockOverview 的 turnover/open/
// previous_close/change_percent_60days——4 键更名仅为 TS 内部一致性，
// 消费方全部读 TS 键，键名保持现状；值语义与 Python 逐项一致。
import type { F10Record } from './f10.ts';
import type { DailyBar } from './store.ts';

export interface SnapshotData {
  price: number;
  high: number;
  low: number;
  open: number;
}

export interface CapitalData {
  zongguben: number; // 总股本（股）
  liutongguben: number; // 流通股本（股）
}

export const LOT_SIZE = 100; // 手 → 股

/** a/b；b 缺失/≤0 → NaN（除零保护；PE/PB 分母 ≤0 时 NaN 的约定）。
 *  单源导出：Yahoo 合成（composeYahooOverview/composeYahooReports）复用同一
 *  语义，防两处漂移。 */
export function divide(numerator: number, denominator: number): number {
  if (Number.isNaN(numerator)) return NaN;
  if (Number.isNaN(denominator) || denominator <= 0) return NaN;
  return numerator / denominator;
}

/** F10 tidy long → 指定指标在**最新报告期**的 value_num（period 字典序最大）。 */
export function latestPeriodValue(f10: F10Record[], metric: string): number {
  let latest: F10Record | null = null;
  for (const r of f10) {
    if (r.metric !== metric) continue;
    if (latest === null || r.period > latest.period) latest = r;
  }
  return latest ? latest.value_num : NaN;
}

/** 末根 bar 是否为"当日"（盘中/收盘后当日 bar 已存在）；周末/盘前 → false。 */
function lastBarIsToday(bars: DailyBar[], today: string): boolean {
  if (!bars.length) return false;
  return bars[bars.length - 1].date === today;
}

/** 年初 YTD 基准收盘（未复权窗口内）；对齐 Python _ytd_base_close 三分支。 */
function ytdBaseClose(bars: DailyBar[], today: string): number {
  if (!bars.length) return NaN;
  const lastYear = Number(bars[bars.length - 1].date.slice(0, 4));
  if (lastYear !== Number(today.slice(0, 4))) return NaN; // 跨年停牌
  let i = bars.length - 1;
  while (i >= 0 && Number(bars[i].date.slice(0, 4)) === lastYear) i--;
  if (i >= 0) return bars[i].close; // 上年末最后一根
  return bars[0].close; // 当年新上市 → 当年首根
}

export interface OverviewInput {
  ticker: string;
  name: string;
  snapshot?: Partial<SnapshotData> | null;
  capital?: CapitalData | null;
  f10: F10Record[];
  bars: DailyBar[];
  today: string; // YYYY-MM-DD（北京时间"今天"）
}

export type OverviewRow = Record<string, number | string>;

/** 由各源原始数据合成 22 列概览（纯函数，不访问网络）。 */
export function composeOverview(input: OverviewInput): OverviewRow {
  const { ticker, name, f10, bars, today } = input;
  const snapshot = input.snapshot ?? null;
  const capital = input.capital ?? null;

  const price = Number.isFinite(snapshot?.price as number)
    ? (snapshot!.price as number)
    : bars.length
      ? bars[bars.length - 1].close
      : NaN;
  const prevClose = bars.length >= 2 ? bars[bars.length - 2].close : NaN;
  const high = Number.isFinite(snapshot?.high as number) ? (snapshot!.high as number) : NaN;
  const low = Number.isFinite(snapshot?.low as number) ? (snapshot!.low as number) : NaN;
  const open = Number.isFinite(snapshot?.open as number) ? (snapshot!.open as number) : NaN;

  // 盘中语义：当日 bar 已存在才给 volume/amount（对齐 Python _last_bar_is_today）
  const last = lastBarIsToday(bars, today) ? bars[bars.length - 1] : null;
  const volume = last ? last.volume : NaN;
  const amount = last && last.amount !== null && last.amount !== undefined ? last.amount : NaN;

  const zongguben = capital?.zongguben ?? NaN;
  const liutongguben = capital?.liutongguben ?? NaN;
  const eps = latestPeriodValue(f10, '基本每股收益(元)');
  const netWorthPerShare = latestPeriodValue(f10, '每股净资产(元)');

  const changePercent = divide(price - prevClose, prevClose) * 100;
  const changeAmount = price - prevClose;
  const amplitude = divide(high - low, prevClose) * 100;
  const turnoverRate = divide(volume * LOT_SIZE, liutongguben) * 100;

  // 60 交易日前收盘（对齐 _close_n_bars_ago：bar 不足 61 根 → NaN）
  const close60d = bars.length > 60 ? bars[bars.length - 61].close : NaN;
  const changePercent60d = divide(price - close60d, close60d) * 100;
  const ytdClose = ytdBaseClose(bars, today);
  const changePercentYtd = divide(price - ytdClose, ytdClose) * 100;

  return {
    ticker: String(ticker),
    name,
    latest_price: price,
    change_percent: changePercent,
    change_amount: changeAmount,
    volume,
    amount,
    amplitude,
    high,
    low,
    open_: open,
    prev_close: prevClose,
    volume_ratio: NaN, // pytdx 无
    turnover_rate: turnoverRate,
    pe_dynamic: divide(price, eps),
    pb: divide(price, netWorthPerShare),
    market_cap: price * zongguben,
    circulating_market_cap: price * liutongguben,
    momentum: NaN, // pytdx 无
    change_percent_5min: NaN, // pytdx 无
    change_percent_60d: changePercent60d,
    change_percent_ytd: changePercentYtd,
  };
}
