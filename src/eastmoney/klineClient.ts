// 东方财富 K 线客户端（免 key）—— **只取成交额**，不取价格。
//
// 为什么存在：Yahoo chart/quoteSummary 没有成交额标准字段，港美链只能用
// `volume × 最新价` 近似（composeYahooOverview #97 决策）。对账实测
// （2026-11-19，00700.HK 与 AAPL 各 300 根逐日）：
//   - 日期逐根对齐（东财 kline f51 == Yahoo 本地时区日）
//   - volume 单位 = 股（与 Yahoo 相同，**不是** CN 的「手」）→ 比 p50 = 1.0000
//   - f57 = 真成交额（原币），amt/(vol×close) p50 = 1.006 → 近似误差 0.6%~3%
//   - 东财 fqt=1 的复权 close 与 Yahoo adjclose 差 p50 0.08%（不同供应商口径）
// 因此本模块**只**消费 f57，OHLC/volume 全部仍用 Yahoo：混用两套复权基期会让
// 指标口径漂移，而成交额是独立标量，补它零风险。
//
// 降级纪律（error-handling spec：degrade don't raise）：任何网络/结构/未知符号
// 失败 → 返回空 Map + warn，调用方保留「近似」值，绝不阻断采集。
//
// CORS：东财 push2his 实测 reflect Origin（`Access-Control-Allow-Origin: <origin>`
// + credentials），浏览器可直连，故本链**不需要**同源代理端点。
import { warn } from '../log.ts';
import { envValue } from '../env.ts';
import { marketInfo, type Market } from '../market.ts';

const EM_KLINE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
/** 拉多少根（1 根/交易日）。1200 ≈ 5 年：成交额只用于展示/概览末根，
 *  不需要 10 年全量；需要时用 EM_KLINE_LMT 覆盖。 */
const DEFAULT_LMT = 1200;
const EM_TIMEOUT_MS = 8000;

/** 美股市场号（东财 secid 前缀）：105=NASDAQ、106=NYSE、107=AMEX。
 *  实测 AAPL=105 命中；BRK.B 三种前缀全 miss（东财无该符号）→ 走降级。 */
const US_MARKET_PREFIXES = ['105', '106', '107'] as const;

/** 市场号 + 符号 → src 候选（港 = 116 + 5 位补零；美 = 三个市场号各试一次）。 */
export function secidCandidates(market: Market, ticker: string): string[] {
  if (market === 'hk') {
    const digits = ticker.replace(/\.HK$/i, '').replace(/\D/g, '');
    if (digits === '') return [];
    const five = digits.padStart(5, '0').slice(-5);
    return [`116.${five}`];
  }
  if (market === 'us') {
    const sym = ticker.trim().toUpperCase();
    if (sym === '') return [];
    return US_MARKET_PREFIXES.map((p) => `${p}.${sym}`);
  }
  return []; // cn 走 TDX，有真成交额
}

/** 东财 kline 响应 → date('YYYY-MM-DD') → 成交额（原币）。纯函数，零网络。
 *
 * fields2 顺序契约：f51 日期, f52 开, f53 收, f54 高, f55 低, f56 量, f57 成交额。
 * 解析宽松（行长度不足/非有限值 → 跳过该行），不抛。
 * @param json 原始响应体（任意形态；非对象/无 data → 空 Map）
 */
export function parseEmKlineAmounts(json: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (json === null || typeof json !== 'object') return out;
  const data = (json as Record<string, unknown>)['data'];
  if (data === null || typeof data !== 'object') return out;
  const klines = (data as Record<string, unknown>)['klines'];
  if (!Array.isArray(klines)) return out;
  for (const line of klines) {
    if (typeof line !== 'string') continue;
    const cells = line.split(',');
    if (cells.length < 7) continue;
    const date = cells[0];
    if (typeof date !== 'string' || date.length < 10) continue;
    const amount = Number(cells[6]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    out.set(date.slice(0, 10), amount);
  }
  return out;
}

/** 取成交额表（免 key；失败 → 空 Map + warn）。
 *
 * @param market hk/us（cn 直接空 Map —— TDX 有真成交额）
 * @param ticker store 形态代码（'0700.HK' / 'AAPL' / 'BRK-B'）
 * @param lmt 拉取根数（缺省 1200，EM_KLINE_LMT 覆盖）
 * @return date → 成交额（原币）。全候选 miss/网络失败 → 空 Map
 */
export async function fetchAmountByDate(
  market: Market,
  ticker: string,
  lmt: number = Number(envValue('EM_KLINE_LMT') ?? DEFAULT_LMT),
): Promise<Map<string, number>> {
  const candidates = secidCandidates(market, ticker);
  if (candidates.length === 0) return new Map();
  const fields2 = 'f51,f52,f53,f54,f55,f56,f57';
  for (const secid of candidates) {
    const url =
      `${EM_KLINE}?secid=${encodeURIComponent(secid)}` +
      `&fields1=f1,f2,f3&fields2=${encodeURIComponent(fields2)}` +
      `&klt=101&fqt=1&end=20500101&lmt=${Number.isFinite(lmt) && lmt > 0 ? Math.floor(lmt) : DEFAULT_LMT}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const resp = await Promise.race([
        fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`东财超时(${EM_TIMEOUT_MS / 1000}s)`)), EM_TIMEOUT_MS);
        }),
      ]);
      if (!resp.ok) {
        warn(`东财 kline ${secid} HTTP ${resp.status},尝试下一候选`);
        continue;
      }
      const amounts = parseEmKlineAmounts(await resp.json());
      if (amounts.size > 0) return amounts;
      // data:null（东财无此符号）→ 下一个候选
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      warn(`东财 kline ${secid} 失败(${detail}),成交额保留近似值`);
      return new Map();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  warn(`${marketInfo(market).label} ${ticker} 东财无成交额数据,保留近似值(volume×价格)`);
  return new Map();
}

/** 把成交额按日合并进 bars（只填空缺，不覆盖已有值）。纯函数，返回新数组。
 *
 * 已有 amount（CN 链/TDX）优先：本函数只服务港美，不改写任何非空值。
 * @param bars 按 date 升序
 * @param amountByDate date('YYYY-MM-DD') → 成交额
 */
export function mergeAmounts<T extends { date: string; amount?: number | null }>(
  bars: readonly T[],
  amountByDate: ReadonlyMap<string, number>,
): T[] {
  if (amountByDate.size === 0) return bars.map((b) => ({ ...b }));
  return bars.map((b) => {
    if (typeof b.amount === 'number' && Number.isFinite(b.amount)) return { ...b };
    const amount = amountByDate.get(b.date);
    return amount === undefined ? { ...b } : { ...b, amount };
  });
}
