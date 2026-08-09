// TDX 数据采集 —— node-tdx-market 封装（与 live 探针同姿势）
// 单位对齐:价格分 → 元(/1000);volume 手;amount 厘 → 元(/1000)。
// name 经 getStockList 全量拉取(失败回退 null,调用方用 ticker 兜底)。
import { TdxClient, KlineCategory, addPrefix, inferExchange, Exchange } from 'node-tdx-market';
import type { DailyBar } from '../store.ts';

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
}

const KLINE_PAGE = 800;

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
      date: b.time.toISOString().slice(0, 10).replace(/-/g, ''),
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

/** 完整采集（快照 + 日K + 名称），单次连接内完成。 */
export async function collectAll(
  client: TdxClient,
  ticker: string,
  meta: { get: (k: string) => string | null; set: (k: string, v: string) => void },
): Promise<CollectedData> {
  const [snapshot, bars, name] = await Promise.all([
    fetchSnapshot(client, ticker),
    fetchDailyBars(client, ticker),
    fetchStockName(client, ticker, meta.get, meta.set),
  ]);
  return { ticker, name, bars, snapshot };
}
