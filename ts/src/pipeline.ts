// build_stock_information 移植 —— 图前 enrichment 唯一组装点
// 块序对齐 Python:个股信息(StockOutputFormatter)→ 技术指标 → 盈利能力
// → 实时市场情报(可注入,缺省占位)→ 亿信(开关/注入)。
// 全部纯函数 + store/注入点,不直接访问网络。
import type { StoreLike, DailyBar } from './store.ts';
import { composeOverview } from './overview.ts';
import { computeAll } from './indicators.ts';
import { parseIndicatorSection } from './f10.ts';
import { asiaToday } from './gates.ts';
import type { ProgressUpdater } from './progress.ts';

// ─── 数值格式化（对齐 Python utils/formatting.fmt_number） ───────────────

export function fmtNumber(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return value.toFixed(digits);
}

// ─── 块 1：个股信息（StockOutputFormatter.format_stock_output 移植） ───────

export interface ReportFields {
  eps?: number | null;
  net_profit?: number | null;
  net_profit_YoY_rate?: number | null;
  net_profit_QoQ_rate?: number | null;
  net_worth_per_share?: number | null;
  net_worth_return_rate?: number | null;
  cash_flow_per_share?: number | null;
  sales_gross_margin?: number | null;
}

/** 单根日K 的涨跌幅%（相邻 close 自算;首根 NaN —— TDX 无历史前值）。 */
export function changePercentSeries(bars: DailyBar[]): number[] {
  return bars.map((b, i) => (i === 0 ? NaN : ((b.close - bars[i - 1].close) / bars[i - 1].close) * 100));
}

/** 换手率%:成交量(手)×100 股 ×100% / 流通股本(股) = 量×10⁴/股本;缺股本 → NaN。 */
function turnoverPct(b: DailyBar, capital: { liutongguben: number } | null): number {
  if (!capital || !capital.liutongguben) return NaN;
  return (b.volume * 10_000) / capital.liutongguben;
}

export function formatStockOutput(
  ticker: string,
  name: string,
  overview: Record<string, number | string>,
  bars: DailyBar[],
  reports: Array<{ report_date: string; fields: ReportFields }>,
  capital: { zongguben: number; liutongguben: number } | null = null,
): string {
  const price = overview.latest_price as number;
  const changePct = changePercentSeries(bars);
  let out = '\n-----------\n';
  out += `Stock: ${name} (${ticker})\n`;
  out += `Latest price: ${fmtNumber(price, 2)}\n`;
  out += `Dynamic PE: ${fmtNumber(overview.pe_dynamic as number, 2)}\n`;
  out += `Pb: ${fmtNumber(overview.pb as number, 2)}\n`;
  out += `Momentum: ${fmtNumber(overview.momentum as number, 2)}%\n`;
  out += 'Last 60 days prices:\n';
  for (let i = Math.max(0, bars.length - 60); i < bars.length; i++) {
    const b = bars[i];
    out += `  Date: ${b.date}, Open:${fmtNumber(b.open, 2)}, Close: ${fmtNumber(b.close, 2)}, `
      + `High: ${fmtNumber(b.high, 2)}, Low: ${fmtNumber(b.low, 2)}, `
      + `Change Percent: ${fmtNumber(changePct[i], 2)}%, Volume: ${fmtNumber(b.volume, 2)}lots, `
      + `Turnover Rate: ${fmtNumber(turnoverPct(b, capital), 2)}%\n`;
  }
  out += 'Last 20 financial abstracts:\n';
  for (const r of reports.slice(-20)) {
    const f = r.fields;
    out += `  Report Date: ${r.report_date}, EPS: ${fmtNumber(f.eps ?? null, 2)}, `
      + `Net Profit: ${fmtNumber(f.net_profit ?? null, 2)}, `
      + `Net Profit YoY percent ${fmtNumber(f.net_profit_YoY_rate ?? null, 2)}, `
      + `Net Profit QoQ percent ${fmtNumber(f.net_profit_QoQ_rate ?? null, 2)}, `
      + `Net worth per share ${fmtNumber(f.net_worth_per_share ?? null, 2)}, `
      + `Return on Equity percent ${fmtNumber(f.net_worth_return_rate ?? null, 2)}, `
      + `Cash flow per share ${fmtNumber(f.cash_flow_per_share ?? null, 2)}, `
      + `Sales gross margin percent ${fmtNumber(f.sales_gross_margin ?? null, 2)}\n`;
  }
  out += '-----------\n';
  return out;
}

// ─── 块 2：技术指标（get_trend_indicators 移植） ───────────────────────────

/** MACD-VH 柱态四色（对齐 extra_indicators.macd_vh_state）。 */
export function macdVhState(vh: number | null, prevVh: number | null): string {
  if (vh === null || prevVh === null || Number.isNaN(vh) || Number.isNaN(prevVh)) return 'N/A';
  if (vh > 0) return vh > prevVh ? '正扩张' : '正衰减';
  return vh < prevVh ? '负扩张' : '负衰减';
}

/** 动量区 5 区（对齐 extra_indicators.momentum_zone:超买>150/强势>50/震荡>-50/弱势>-150）。 */
export function momentumZone(macdV: number | null): string {
  if (macdV === null || Number.isNaN(macdV)) return 'N/A';
  if (macdV > 150) return '超买';
  if (macdV > 50) return '强势';
  if (macdV > -50) return '震荡';
  if (macdV > -150) return '弱势';
  return '超卖';
}

const INDICATOR_ROWS: Array<[string, string[], number]> = [
  ['MA5/10/20/60', ['MA5', 'MA10', 'MA20', 'MA60'], 2],
  ['EMA5/10/20/60', ['EMA5', 'EMA10', 'EMA20', 'EMA60'], 2],
  ['MACD', ['DIF', 'DEA', 'MACD'], 3],
  ['RSI6/12/24', ['RSI6', 'RSI12', 'RSI24'], 2],
  ['KDJ', ['K', 'D', 'J'], 2],
  ['BOLL', ['BOLL_UP', 'BOLL_MB', 'BOLL_DN'], 2],
  ['ATR', ['ATR'], 2],
  ['量比/VOL_MA5', ['VOL_RATIO', 'VOL_MA5'], 2],
  ['换手率', ['TURNOVER_RATE'], 3],
];

/** 指标摘要文本（compute_all 末根 + MACD-VH 相邻柱态 + 乖离率）。
 *  liutongguben(股)→ 传 shares(万股,vendor 语义:vol手/万股 = 换手率%)。 */
export function trendIndicatorsText(bars: DailyBar[], ticker: string, liutongguben?: number | null): string {
  if (!bars.length) return `（无 ${ticker} 的行情数据，跳过技术指标）`;
  const rows = computeAll(
    bars.map((b) => ({ datetime: b.date, open: b.open, high: b.high, low: b.low, close: b.close, vol: b.volume })),
    liutongguben && liutongguben > 0 ? liutongguben / 10_000 : null,
  );
  const last = rows[rows.length - 1];
  const prevVh = rows.length >= 2 ? rows[rows.length - 2].MACD_VH : null;
  const lastDate = bars[bars.length - 1].date;
  const lines = [`【技术指标（${lastDate} 收盘）】`];
  for (const [label, cols, digits] of INDICATOR_ROWS) {
    if (cols.length === 1) {
      lines.push(`${label}: ${fmtNumber(last[cols[0]] ?? null, digits)}`);
    } else {
      lines.push(`${label}: ${cols.map((c) => `${c}=${fmtNumber(last[c] ?? null, digits)}`).join(', ')}`);
    }
  }
  lines.push(
    'MACD-VH: '
    + `MACD_V=${fmtNumber(last.MACD_V ?? null, 2)}  `
    + `Signal=${fmtNumber(last.SIGNAL ?? null, 2)}  `
    + `VH=${fmtNumber(last.MACD_VH ?? null, 2)}  `
    + `柱态=${macdVhState(last.MACD_VH ?? null, prevVh)}  `
    + `动量区=${momentumZone(last.MACD_V ?? null)}`,
  );
  lines.push(`刘晨明乖离率(20日EMA): ${fmtNumber((last.LIU_BIAS ?? NaN) * 100, 2)}%`);
  return lines.join('\n');
}

// ─── 块 3：盈利能力指标（get_financial_indicators 移植） ───────────────────

/** F10 raw 文本 → 最新报告期盈利能力摘要（无分节/空 → 占位）。 */
export function financialIndicatorsText(f10Text: string | null, ticker: string): string {
  if (!f10Text) return `（无 ${ticker} 的盈利能力指标，跳过）`;
  const records = parseIndicatorSection(f10Text, '【盈利能力指标】');
  if (!records.length) return `（无 ${ticker} 的盈利能力指标，跳过）`;
  const periods = [...new Set(records.map((r) => r.period))].sort();
  const latest = periods[periods.length - 1];
  const lines = [`【盈利能力指标（${latest}）】`];
  for (const r of records) {
    if (r.period !== latest) continue;
    if (Number.isNaN(r.value_num)) continue; // N/A 行是噪声,不给 LLM
    lines.push(`${r.metric}: ${fmtNumber(r.value_num, 2)}%`);
  }
  return lines.join('\n');
}

// ─── 组装 ─────────────────────────────────────────────────────────────────

export interface PipelineDeps {
  store: StoreLike;
  f10Text?: string | null; // F10「主要财务指标」全文(盈利能力块;null → 占位)
  snapshot?: { price: number; high: number; low: number; open: number } | null;
  capital?: { zongguben: number; liutongguben: number } | null;
  name?: string | null; // 缺省回退 ticker
  today?: string; // YYYY-MM-DD;缺省 asiaToday
  mcp?: (ticker: string) => string; // 实时市场情报注入;缺省 TDX_API_KEY 占位
  billions?: (ticker: string) => string; // 亿信注入;缺省开关关 → 空串
  progress?: ProgressUpdater | null;
}

/** build_stock_information 等价：五段拼接（对齐 Python 唯一组装点）。 */
export function buildStockInformation(ticker: string, deps: PipelineDeps): string {
  const { store, progress } = deps;
  const today = deps.today ?? asiaToday();
  const stock = store.getStock(ticker);
  const name = deps.name ?? stock?.name ?? ticker;
  const bars = store.getDatas(ticker);
  const reports = store
    .getPerformanceReports(ticker)
    .map((r) => ({ report_date: r.report_date, fields: r.fields as ReportFields }));

  safe(deps.progress, `正在获取 ${ticker} 的个股信息与财务数据...`);
  const overview = composeOverview({
    ticker,
    name,
    snapshot: deps.snapshot ?? null,
    capital: deps.capital ?? null,
    f10: deps.f10Text ? parseIndicatorSection(deps.f10Text, '【主要财务指标】') : [],
    bars,
    today,
  });
  let info = formatStockOutput(ticker, name, overview, bars, reports, deps.capital ?? null);

  safe(progress, `正在计算 ${ticker} 的技术指标...`);
  info += '\n' + trendIndicatorsText(bars, ticker, deps.capital?.liutongguben ?? null);

  safe(progress, `正在获取 ${ticker} 的财务指标...`);
  info += '\n' + financialIndicatorsText(deps.f10Text ?? null, ticker);

  safe(progress, `正在获取 ${ticker} 的实时市场情报...`);
  info += '\n' + (deps.mcp ? deps.mcp(ticker) : fallbackMarketIntel());

  // 亿信段:开关关或未注入 → 空串(该段自然不出现,对齐 Python 零行为变化)
  const bills = deps.billions ? deps.billions(ticker) : '';
  if (bills) info += '\n' + bills;
  return info;
}

function safe(updater: ProgressUpdater | null | undefined, msg: string): void {
  try {
    updater?.info(msg);
  } catch {
    /* 进度丢失不阻断 */
  }
}

/** 无 TDX_API_KEY → 占位（与 Python get_market_intel _FALLBACK_TEXT 逐字一致）。 */
export function fallbackMarketIntel(): string {
  return '（未配置 TDX_API_KEY，跳过实时市场情报）';
}

