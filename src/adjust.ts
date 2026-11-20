// qfq 前复权 —— 由 Python data_source/.../tdx/adjust.py 移植而来,2026-11-19 修正
// 累计因子重复相乘(P0,见 docs/code-review-2026-11-19.md):原实现把每轮累积到
// 的 `Π(r_1..r_k)` 乘进「已被 `Π(r_1..r_{k-1})` 缩过」的前缀集合,导致比事件日
// 更老的 bar 得到 `c0·Π r_m^(k-m+1)` 而非 `c0·Π r_m`(最近 250 根偏 2.67%,
// 第 N-1000 根偏 -41%,首根下溢为 0)。Python 侧同错,故冻结夹具 test/fixtures/
// 600036_daily.json#adjusted 是**错值**,只保留作历史物证,不再作 oracle。
// 算法与单位约定见 research/m0-d3-xdxr-qfq.md
import { warn } from './log.ts';

export interface Bar {
  date: string; // YYYYMMDD，升序
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number; // 手
  amount?: number;
  amplitude?: number;
  changePct?: number;
  change?: number;
}

export interface XdxrEventLike {
  tradeDate: string; // YYYYMMDD
  fenhong?: number | null; // 每10股
  peigujia?: number | null; // 元/股
  songzhuangu?: number | null; // 每10股
  peigu?: number | null; // 每10股
  suogu?: number | null; // 每10股
}

function numOrZero(v: unknown): number {
  if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return 0;
  return Number(v);
}

export function qfqAdjust(bars: Bar[], xdxr: XdxrEventLike[]): Bar[] {
  if (!bars.length || !xdxr.length) return bars.map((b) => ({ ...b }));
  const raw = bars.map((b) => ({ ...b }));
  const closeSeries = bars.map((b) => b.close); // 原始收盘快照（未复权）
  // 降序(新事件在前)逐个事件:每个事件只把自己的比率乘一次,作用对象是「该事件
  // 日之前的 bar」。注意这些前缀集合是**嵌套子集**(事件越老,集合越小),所以
  // 必须用本轮比率,不能用累计量——否则新事件的比率会被重复乘进更老的 bar。
  const events = [...xdxr].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  for (const ev of events) {
    const beforeIdx: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].date < ev.tradeDate) beforeIdx.push(i);
    }
    if (!beforeIdx.length) continue;
    const prevClose = closeSeries[beforeIdx[beforeIdx.length - 1]];
    const songguPs = numOrZero(ev.songzhuangu) / 10;
    const peiguPs = numOrZero(ev.peigu) / 10;
    const peigujia = numOrZero(ev.peigujia);
    const fenhongPs = numOrZero(ev.fenhong) / 10;
    const suoguPs = numOrZero(ev.suogu) / 10;
    const denominator = prevClose * (1 + songguPs + peiguPs);
    const ratioPrice = denominator > 0
      ? (prevClose - fenhongPs + peiguPs * peigujia) / denominator
      : 1.0;
    if (denominator <= 0) {
      // 除数非正 = xdxr 行坏了(prevClose 缺/为 0)。降级为不调整该事件,但必须留痕:
      // 静默置 1.0 会让一次除权整段价格悄悄错位(error-handling.md 反模式)。
      warn(`qfq ${ev.tradeDate} 除权分母非正(prevClose=${prevClose}),该事件价因子置 1.0`);
    }
    const ratioVol = 1 + songguPs + peiguPs - suoguPs;
    const adjustVol = ratioVol > 0; // 缩股等非正因子跳过成交量调整
    if (!adjustVol) {
      warn(`qfq ${ev.tradeDate} 量因子非正(${ratioVol}),该事件不调整成交量`);
    }
    for (const i of beforeIdx) {
      raw[i].open *= ratioPrice;
      raw[i].close *= ratioPrice;
      raw[i].high *= ratioPrice;
      raw[i].low *= ratioPrice;
      if (adjustVol) raw[i].volume *= ratioVol;
    }
  }
  // 复权后重算指标列 + 成交量舍回整手
  for (let i = 0; i < raw.length; i++) {
    raw[i].volume = Math.round(raw[i].volume);
    const prev = i > 0 ? raw[i - 1].close : NaN;
    raw[i].amplitude = ((raw[i].high - raw[i].low) / prev) * 100;
    raw[i].changePct = ((raw[i].close - prev) / prev) * 100;
    raw[i].change = raw[i].close - prev;
  }
  return raw;
}

// ─── Yahoo adjclose 前复权(hk/us 链) ────────────────────────────────────────

/** 带 adjclose 的日K(Yahoo chart 原生形态)。date 为 'YYYY-MM-DD'(与本文件
 *  CN 侧的 'YYYYMMDD' 不同)——本函数不做日期比较,只按 adjClose/close 逐根缩放。 */
export interface AdjCloseBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  amount?: number | null;
  adjClose: number | null;
}

/**
 * Yahoo chart 的 `indicators.adjclose` → 前复权日K。语义与 CN `qfqAdjust` 对齐:
 * 最新一根 = 原始价,历史按累计分红/拆股因子缩放。
 *
 * 为什么用 adjclose 而不是自算分红因子:`events.dividends` 只给每股金额、缺复权
 * 基期,自算会与 Yahoo 口径漂移;`adjclose` 是唯一免自建的完整因子源
 * (Yahoo 的 `close` 只含拆股,`adjclose` 额外含现金分红)。
 *
 * 因子 = adjClose/close,再整体除以**最后一个有效因子**做归一(Yahoo 实测已归一
 * 到 1;归一只是防御同一窗口内 adjclose 与 close 基期不一致)。
 * 单根因子缺失/非正 → 取最近的有效因子(先前向携带、再无前值则后向取首个),
 * 避免相邻两根复权基期跳变;全缺失 → 原样返回(等价不复权,不抛)。
 * volume 不缩放:Yahoo 的 volume 已是拆股调整后股数,再乘因子会二次调整。
 *
 * @param bars 按 date 升序的日K(顺序即时间序,内部不重排)
 * @return 同序、同长度;仅 OHLC 被缩放,volume/amount/adjClose 原样
 */
export function qfqAdjustByAdjClose(bars: readonly AdjCloseBar[]): AdjCloseBar[] {
  if (!bars.length) return [];
  const rawFactor = bars.map((b): number | null => {
    const adj = b.adjClose;
    return adj !== null && Number.isFinite(adj) && adj > 0 && b.close > 0 ? adj / b.close : null;
  });
  if (rawFactor.every((f) => f === null)) {
    // adjclose 全缺(如 5m 盘中K)→ 等价不复权。价格错位风险由调用方承担,须留痕。
    warn(`qfq(adjclose) 全序列缺 adjclose(${bars.length} 根),本次不做复权`);
    return bars.map((b) => ({ ...b }));
  }
  // 缺失因子填充:先前向携带(用左侧最近的有效因子);开头部段(无左邻)留
  // NaN 标记,再由后向补齐(用右侧第一个有效因子)—— 两向不能互相覆盖,否则
  // 「中间缺口」会被后向重写成右值。
  const filled: number[] = [];
  let last: number | null = null;
  for (const f of rawFactor) {
    if (f !== null) {
      last = f;
      filled.push(f);
    } else {
      filled.push(last ?? NaN);
    }
  }
  let next: number | null = null;
  for (let i = filled.length - 1; i >= 0; i--) {
    if (Number.isNaN(filled[i])) {
      if (next !== null) filled[i] = next;
    } else if (rawFactor[i] !== null) {
      next = rawFactor[i];
    }
  }
  const lastFactor = filled.at(-1) ?? NaN;
  if (!Number.isFinite(lastFactor) || lastFactor <= 0) {
    warn(`qfq(adjclose) 末根因子无效(${lastFactor}),本次不做复权`);
    return bars.map((b) => ({ ...b }));
  }
  const scale = 1 / lastFactor;
  return bars.map((b, i) => {
    const f = filled[i];
    const k = f * scale;
    if (!Number.isFinite(k) || k <= 0 || k === 1) return { ...b };
    return {
      ...b,
      open: b.open * k,
      high: b.high * k,
      low: b.low * k,
      close: b.close * k,
    };
  });
}
