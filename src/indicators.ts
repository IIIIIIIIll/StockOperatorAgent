// 技术指标 —— 移植自 vendored tdx_quant indicators/ + extra_indicators.py
// 依赖 pandas 算子语义（ewm(adjust=False) 递归、rolling 前 n-1 NaN、std ddof=0）
// 见 research/m0 与 vendor 源码；输入 bars 需 qfq 后（或未复权，与调用方约定）。

export interface IndicatorInput {
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
}

export type IndicatorRow = IndicatorInput & Record<string, number | null>;

const NAN = NaN;

/** ewm(alpha=a, adjust=False).mean() —— pandas 默认 ignore_na=False 语义(F15):
 *  跳过前导 NaN(pandas 从首个非 NaN 开始);中间 NaN 按位置计衰减:
 *  新值到达时 y[t] = (1-a)^gap · y_prev + a·x[t],gap = t - lastValid
 *  (旧实现恒 gap=1 的 NaN 直传,实为 ignore_na=True,与声明的 pandas 语义
 *  不符;触达点 calcKdj rsv 的 9 窗高低相等(连续一字板)会偏离 Python 参考)。 */
function ewmAlpha(arr: number[], alpha: number): number[] {
  const out = new Array<number>(arr.length).fill(NAN);
  let t0 = 0;
  while (t0 < arr.length && Number.isNaN(arr[t0])) t0++;
  if (t0 >= arr.length) return out;
  let y = arr[t0];
  out[t0] = y;
  let lastValid = t0;
  for (let t = t0 + 1; t < arr.length; t++) {
    if (!Number.isNaN(arr[t])) {
      y = Math.pow(1 - alpha, t - lastValid) * y + alpha * arr[t];
      lastValid = t;
    }
    out[t] = y;
  }
  return out;
}

/** pandas ewm(span=n, adjust=False).mean() → alpha = 2/(n+1) */
function ewmSpan(arr: number[], span: number): number[] {
  return ewmAlpha(arr, 2 / (span + 1));
}

function rollingMean(arr: number[], n: number): number[] {
  const out = new Array<number>(arr.length).fill(NAN);
  for (let t = 0; t < arr.length; t++) {
    if (t < n - 1) continue;
    let sum = 0;
    let hasNan = false;
    for (let i = t - n + 1; i <= t; i++) {
      if (Number.isNaN(arr[i])) { hasNan = true; break; }
      sum += arr[i];
    }
    out[t] = hasNan ? NAN : sum / n;
  }
  return out;
}

function rollingExtreme(arr: number[], n: number, isMax: boolean): number[] {
  const out = new Array<number>(arr.length).fill(NAN);
  for (let t = 0; t < arr.length; t++) {
    if (t < n - 1) continue;
    let v = arr[t - n + 1];
    for (let i = t - n + 2; i <= t; i++) {
      v = isMax ? Math.max(v, arr[i]) : Math.min(v, arr[i]);
    }
    out[t] = v;
  }
  return out;
}

/** pandas rolling(n).std(ddof=0) —— 总体标准差，前 n-1 NaN */
function rollingStd(arr: number[], n: number): number[] {
  const out = new Array<number>(arr.length).fill(NAN);
  for (let t = 0; t < arr.length; t++) {
    if (t < n - 1) continue;
    let mean = 0;
    for (let i = t - n + 1; i <= t; i++) mean += arr[i];
    mean /= n;
    let acc = 0;
    for (let i = t - n + 1; i <= t; i++) acc += (arr[i] - mean) ** 2;
    out[t] = Math.sqrt(acc / n);
  }
  return out;
}

function diff(arr: number[]): number[] {
  const out = new Array<number>(arr.length).fill(NAN);
  for (let t = 1; t < arr.length; t++) out[t] = arr[t] - arr[t - 1];
  return out;
}

function shift(arr: number[]): number[] {
  const out = new Array<number>(arr.length).fill(NAN);
  for (let t = 1; t < arr.length; t++) out[t] = arr[t - 1];
  return out;
}

function calcMa(close: number[], periods: number[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const n of periods) out[`MA${n}`] = rollingMean(close, n);
  return out;
}

function calcEma(close: number[], periods: number[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const n of periods) out[`EMA${n}`] = ewmSpan(close, n);
  return out;
}

function calcMacd(close: number[], fast = 12, slow = 26, signal = 9): Record<string, number[]> {
  const emaFast = ewmSpan(close, fast);
  const emaSlow = ewmSpan(close, slow);
  const dif = close.map((_, t) => emaFast[t] - emaSlow[t]);
  const dea = ewmSpan(dif, signal);
  const macd = dif.map((v, t) => (v - dea[t]) * 2);
  return { DIF: dif, DEA: dea, MACD: macd };
}

function calcRsi(close: number[], periods: number[]): Record<string, number[]> {
  const delta = diff(close);
  // pandas clip(lower=0) / clip(upper=0)：NaN 保持 NaN（比较为 False）
  const gain = delta.map((v) => (Number.isNaN(v) ? v : Math.max(v, 0)));
  const loss = delta.map((v) => (Number.isNaN(v) ? v : Math.max(-v, 0)));
  const out: Record<string, number[]> = {};
  for (const n of periods) {
    const avgGain = ewmAlpha(gain, 1 / n);
    const avgLoss = ewmAlpha(loss, 1 / n);
    const rsi = avgGain.map((g, t) => {
      const l = avgLoss[t];
      if (Number.isNaN(l)) return NAN; // warmup：avg_loss NaN → 保持 NaN
      if (l === 0) return 100; // 全涨：除零 → 100
      const rs = g / l;
      return 100 - 100 / (1 + rs);
    });
    out[`RSI${n}`] = rsi;
  }
  return out;
}

function calcKdj(high: number[], low: number[], close: number[], n = 9, m1 = 3, m2 = 3): Record<string, number[]> {
  const lowN = rollingExtreme(low, n, false);
  const highN = rollingExtreme(high, n, true);
  const rsv = close.map((c, t) => {
    const hn = highN[t];
    const ln = lowN[t];
    if (Number.isNaN(hn) || Number.isNaN(ln)) return NAN;
    if (hn === ln) return NAN; // 平窗：0/0 → NaN，保持原样
    return ((c - ln) / (hn - ln)) * 100;
  });
  const k = ewmAlpha(rsv, 1 / m1);
  const d = ewmAlpha(k, 1 / m2);
  const j = k.map((kv, t) => 3 * kv - 2 * d[t]);
  return { K: k, D: d, J: j };
}

function calcBoll(close: number[], n = 20, k = 2): Record<string, number[]> {
  const mb = rollingMean(close, n);
  const std = rollingStd(close, n);
  const up = mb.map((v, t) => (Number.isNaN(v) ? NAN : v + k * std[t]));
  const dn = mb.map((v, t) => (Number.isNaN(v) ? NAN : v - k * std[t]));
  return { BOLL_MB: mb, BOLL_UP: up, BOLL_DN: dn };
}

function calcAtr(high: number[], low: number[], close: number[], n = 14): number[] {
  const prevClose = shift(close);
  const tr = high.map((h, t) => {
    const pc = prevClose[t];
    if (Number.isNaN(pc)) return h - low[t]; // 首根无前收：TR = high-low
    return Math.max(h - low[t], Math.abs(h - pc), Math.abs(low[t] - pc));
  });
  return ewmAlpha(tr, 1 / n);
}

function calcVolMa(vol: number[], periods: number[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const n of periods) out[`VOL_MA${n}`] = rollingMean(vol, n);
  return out;
}

function calcVolumeRatio(vol: number[], n = 5): number[] {
  const denom = rollingMean(shift(vol), n);
  return vol.map((v, t) => {
    const d = denom[t];
    if (Number.isNaN(d) || d === 0) return NAN; // 零前窗（停牌）→ NaN 不毒化
    return v / d;
  });
}

function calcMacdVh(
  high: number[],
  low: number[],
  close: number[],
  fast = 12,
  slow = 26,
  atrLen = 26,
  signal = 9,
): Record<string, number[]> {
  // 注意：MACD-VH 的 ATR 窗口 = atrLen(26)，与展示列 ATR(14) 不同
  const emaFast = ewmSpan(close, fast);
  const emaSlow = ewmSpan(close, slow);
  const atr = calcAtr(high, low, close, atrLen);
  const macdV = close.map((_, t) => (atr[t] > 0 ? ((emaFast[t] - emaSlow[t]) / atr[t]) * 100 : NAN));
  const signalArr = ewmSpan(macdV, signal);
  const vh = macdV.map((v, t) => (Number.isNaN(v) ? NAN : v - signalArr[t]));
  return { MACD_V: macdV, SIGNAL: signalArr, MACD_VH: vh };
}

function calcLiuBias(close: number[], n = 20): number[] {
  const ema = ewmSpan(close, n);
  return close.map((c, t) => Math.log(c) - Math.log(ema[t]));
}

/**
 * compute_all 移植：输入 OHLCV bars，输出每根指标行。
 * 列与 Python compute_all + calc_macd_vh + calc_liu_bias 一致。
 */
export function computeAll(bars: IndicatorInput[], shares?: number | null): IndicatorRow[] {
  const open = bars.map((b) => b.open);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const close = bars.map((b) => b.close);
  const vol = bars.map((b) => b.vol);

  const cols: Record<string, number[]> = {
    ...calcMa(close, [5, 10, 20, 60]),
    ...calcEma(close, [5, 10, 20, 60]),
    ...calcMacd(close),
    ...calcRsi(close, [6, 12, 24]),
    ...calcKdj(high, low, close),
    ...calcBoll(close),
    ATR: calcAtr(high, low, close),
    ...calcVolMa(vol, [5, 10]),
    VOL_RATIO: calcVolumeRatio(vol),
  };
  const turnover = vol.map((v) => (shares === undefined || shares === null ? NAN : v / shares));
  cols.TURNOVER_RATE = turnover;
  Object.assign(cols, calcMacdVh(high, low, close));
  cols.LIU_BIAS = calcLiuBias(close);

  return bars.map((b, t) => {
    const row: IndicatorRow = { ...b };
    for (const [k, arr] of Object.entries(cols)) {
      row[k] = Number.isNaN(arr[t]) ? null : arr[t];
    }
    return row;
  });
}
