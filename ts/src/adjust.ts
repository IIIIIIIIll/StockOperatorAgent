// qfq 前复权 —— 逐字节移植自 Python data_source/.../tdx/adjust.py
// 算法与单位约定见 research/m0-d3-xdxr-qfq.md
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
  const events = [...xdxr].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  let factorPrice = 1.0;
  let factorVol = 1.0;
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
    const ratioVol = 1 + songguPs + peiguPs - suoguPs;
    factorPrice *= ratioPrice;
    if (ratioVol > 0) factorVol *= ratioVol; // 缩股等非正因子跳过成交量调整
    for (const i of beforeIdx) {
      raw[i].open *= factorPrice;
      raw[i].close *= factorPrice;
      raw[i].high *= factorPrice;
      raw[i].low *= factorPrice;
      raw[i].volume *= factorVol;
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
