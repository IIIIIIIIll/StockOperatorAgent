// TDX 数据采集 —— node-tdx-market 封装（与 live 探针同姿势）
// 单位对齐:价格分 → 元(/1000);volume 手;amount 厘 → 元(/1000)。
// name 经 getStockList 全量拉取(失败回退 null,调用方用 ticker 兜底)。
import { TdxClient, KlineCategory, addPrefix, inferExchange, Exchange } from 'node-tdx-market';
import type { DailyBar } from '../store.ts';
import { qfqAdjust, type Bar, type XdxrEventLike } from '../adjust.ts';
import { getXdxrInfo, toXdxrEventLike } from './xdxr.ts';

export interface CollectedSnapshot {
  price: number; // 元
  high: number;
  low: number;
  open: number;
  volume: number; // 手
  amount: number; // 元
}

export interface CollectedData {
  ticker: string;
  name: string | null;
  bars: DailyBar[];
  snapshot: CollectedSnapshot | null;
  capital: { zongguben: number; liutongguben: number } | null; // 总/流通股本(股);失败 → null
}

const KLINE_PAGE = 800;

/** YYYY-MM-DD(本地历日)。F14:toISOString 是 UTC 历日——TDX 库按本地时区
 *  15:00 构 Date,在 TZ≤UTC-9(夏威夷等)会 +1 天;本地历日 == 解码出的原始日。 */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 分页拉全部日K（start 步进，count<800 停止），升序返回（对齐 live 探针）。 */
export async function fetchDailyBars(client: TdxClient, ticker: string): Promise<DailyBar[]> {
  const code = addPrefix(ticker);
  const all: Array<{ time: Date; open: number; close: number; high: number; low: number; volume: number; amount: number }> = [];
  for (let start = 0; ; start += KLINE_PAGE) {
    const r = await client.getKline({ code, category: KlineCategory.Day, start, count: KLINE_PAGE });
    all.push(...r.bars);
    if (r.count < KLINE_PAGE) break;
  }
  return all
    .map((b) => ({
      date: formatLocalDate(b.time), // YYYY-MM-DD（store 契约；F14 本地历日,不绕 UTC）
      open: b.open / 1000,
      close: b.close / 1000,
      high: b.high / 1000,
      low: b.low / 1000,
      volume: b.volume,
      amount: b.amount / 1000,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 快照（getQuote 单票）；失败/空 → null（对齐 Python 逐源降级）。 */
export async function fetchSnapshot(client: TdxClient, ticker: string): Promise<CollectedSnapshot | null> {
  let q: Array<{ price: number; high: number; low: number; open: number; volume: number; amount: number }>;
  try {
    q = (await client.getQuote(addPrefix(ticker))) as never;
  } catch {
    return null;
  }
  if (!q || !q.length) return null;
  const s = q[0];
  return {
    price: s.price / 1000,
    high: s.high / 1000,
    low: s.low / 1000,
    open: s.open / 1000,
    volume: s.volume,
    amount: s.amount / 1000,
  };
}

/** 证券名称（getStockList 全量 + 缓存到 meta）；失败 → null（回退 ticker）。 */
export async function fetchStockName(
  client: TdxClient,
  ticker: string,
  metaGet: (key: string) => string | null,
  metaSet: (key: string, value: string) => void,
): Promise<string | null> {
  const key = `name:${ticker}`;
  const cached = metaGet(key);
  if (cached) return cached;
  try {
    const exchange = inferExchange(ticker) as Exchange;
    const list = await client.getStockList(exchange);
    const hit = list.find((s) => s.code === ticker);
    if (!hit) return null;
    metaSet(key, hit.name);
    return hit.name;
  } catch {
    return null;
  }
}

/** xdxr 事件拉取 → qfqAdjust 输入（market/code 从 ticker 推断：inferExchange
 *  0=深 1=沪 对齐 pytdx 契约；code 为 6 位裸代码）。失败 → []（qfq 不阻断采集）。 */
export async function fetchXdxrEvents(client: TdxClient, ticker: string): Promise<XdxrEventLike[]> {
  try {
    const events = await getXdxrInfo(client, inferExchange(ticker) as number, ticker);
    return events.map(toXdxrEventLike);
  } catch {
    return [];
  }
}

/** 日K + xdxr 事件 → qfq 前复权 bars。接线层负责格式转换：store 契约
 *  YYYY-MM-DD ↔ qfqAdjust 输入契约 YYYYMMDD（adjust.ts 依赖日期字符串比较，
 *  两侧必须同格式）。无事件/转换失败 → 原样返回 raw bars。 */
export function applyQfq(bars: DailyBar[], events: XdxrEventLike[]): DailyBar[] {
  if (!bars.length || !events.length) return bars.map((b) => ({ ...b }));
  try {
    const input: Bar[] = bars.map((b) => ({
      date: b.date.replace(/-/g, ''),
      open: b.open,
      close: b.close,
      high: b.high,
      low: b.low,
      volume: b.volume,
      amount: b.amount ?? undefined,
    }));
    return qfqAdjust(input, events).map((b) => ({
      date: `${b.date.slice(0, 4)}-${b.date.slice(4, 6)}-${b.date.slice(6, 8)}`,
      open: b.open,
      close: b.close,
      high: b.high,
      low: b.low,
      volume: b.volume,
      amount: b.amount ?? null,
    }));
  } catch {
    return bars.map((b) => ({ ...b }));
  }
}

/** 完整采集（快照 + 日K + 名称 + xdxr 复权），单次连接内完成。
 *  opts.skipDaily（C8 freshness 接线）：同日已采集 → 跳过日K/xdxr 拉取，
 *  仍拉快照与名称（部分 fresh 不整体短路）；bars 返回 [] 由调用方保留既有数据。 */
export async function collectAll(
  client: TdxClient,
  ticker: string,
  meta: { get: (k: string) => string | null; set: (k: string, v: string) => void },
  opts?: { skipDaily?: boolean },
): Promise<CollectedData> {
  const skipDaily = opts?.skipDaily === true;
  const [snapshot, bars, name, xdxr] = await Promise.all([
    fetchSnapshot(client, ticker),
    skipDaily ? Promise.resolve([]) : fetchDailyBars(client, ticker),
    fetchStockName(client, ticker, meta.get, meta.set),
    skipDaily ? Promise.resolve([]) : fetchXdxrEvents(client, ticker),
  ]);
  return { ticker, name, bars: skipDaily ? [] : applyQfq(bars, xdxr), snapshot, capital: null };
}
