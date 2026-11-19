// build_stock_information 移植 —— 图前 enrichment 唯一组装点
// 块序对齐 Python:个股信息(StockOutputFormatter)→ 技术指标 → 盈利能力
// → 实时市场情报(可注入,缺省占位)→ 亿信(开关/注入)。
// 全部纯函数 + store/注入点,不直接访问网络。
import type { StoreLike, DailyBar, PerformanceReport } from './store.ts';
import { composeOverview, type OverviewRow } from './overview.ts';
import { computeAll } from './indicators.ts';
import { parseIndicatorSection } from './f10.ts';
import { marketToday } from './gates.ts';
import { marketInfo, type Market } from './market.ts';
import { MCP_NO_KEY_TEXT } from './mcp.ts';
import { yahooAnnualKey, yahooProfileKey } from './metaKeys.ts';
import { parseYahooAnnualReports } from './yahoo/composeYahooReports.ts';
import { parseYahooProfile, yahooProfileText } from './yahoo/composeYahooProfile.ts';
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

/** 换手率%:cn 成交量(手)×100 股 ×100% / 流通股本(股) = 量×10⁴/股本;
 *  hk/us 成交量(股)/流通股本(股)×100(原币股数直除);缺股本或缺量 → NaN
 *  (volume null = 数据源未知，不伪造 0%，CR-25)。 */
export function turnoverPct(b: DailyBar, capital: { liutongguben: number } | null, market: Market = 'cn'): number {
  if (!capital || !capital.liutongguben) return NaN;
  if (b.volume === null) return NaN;
  if (market === 'cn') return (b.volume * 10_000) / capital.liutongguben;
  return (b.volume / capital.liutongguben) * 100;
}

export function formatStockOutput(
  ticker: string,
  name: string,
  overview: Record<string, number | string>,
  bars: DailyBar[],
  reports: Array<{ report_date: string; fields: ReportFields }>,
  capital: { zongguben: number; liutongguben: number } | null = null,
  market: Market = 'cn',
): string {
  const price = overview.latest_price as number;
  const changePct = changePercentSeries(bars);
  // cn 量为手、无市场行(改造前逐字节不变);hk/us 量为股 + 市场标签/币种行
  const volumeUnit = market === 'cn' ? 'lots' : 'shares';
  let out = '\n-----------\n';
  out += `Stock: ${name} (${ticker})\n`;
  if (market !== 'cn') out += `Market: ${marketInfo(market).label}, Currency: ${marketInfo(market).currency}\n`;
  out += `Latest price: ${fmtNumber(price, 2)}\n`;
  out += `Dynamic PE: ${fmtNumber(overview.pe_dynamic as number, 2)}\n`;
  out += `Pb: ${fmtNumber(overview.pb as number, 2)}\n`;
  out += `Momentum: ${fmtNumber(overview.momentum as number, 2)}%\n`;
  out += 'Last 60 days prices:\n';
  for (let i = Math.max(0, bars.length - 60); i < bars.length; i++) {
    const b = bars[i];
    out += `  Date: ${b.date}, Open:${fmtNumber(b.open, 2)}, Close: ${fmtNumber(b.close, 2)}, `
      + `High: ${fmtNumber(b.high, 2)}, Low: ${fmtNumber(b.low, 2)}, `
      + `Change Percent: ${fmtNumber(changePct[i], 2)}%, Volume: ${fmtNumber(b.volume, 2)}${volumeUnit}, `
      + `Turnover Rate: ${fmtNumber(turnoverPct(b, capital, market), 2)}%\n`;
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
 *  TURNOVER_RATE = vol/shares(vendor 语义,输出即换手率%):
 *  cn 量(手)÷流通股本(万股);hk/us 量(股)÷(流通股本/100) = 量×100/股本。 */
export function trendIndicatorsText(bars: DailyBar[], ticker: string, liutongguben?: number | null, market: Market = 'cn'): string {
  if (!bars.length) return `（无 ${ticker} 的行情数据，跳过技术指标）`;
  const shares = liutongguben && liutongguben > 0
    ? (market === 'cn' ? liutongguben / 10_000 : liutongguben / 100)
    : null;
  const rows = computeAll(
    bars.map((b) => ({ datetime: b.date, open: b.open, high: b.high, low: b.low, close: b.close, vol: b.volume ?? NaN })),
    shares,
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

/** Yahoo 业绩报告（hk/us,fields 复用 REPORT_COLUMNS 键、原币原始值）
 *  → 最新报告期盈利能力摘要（净利/营收/ROE/EPS,{currency} 单位）。
 *  风格对齐 financialIndicatorsText;无报告 → 占位不 raise。 */
export interface YahooFinancialFallback {
  /** 每股收益回退（overview.eps = defaultKeyStatistics.trailingEps，TTM）。 */
  eps?: number | null;
  /** ROE 回退（百分点：financialData.returnOnEquity 小数 ×100 后的值）。 */
  roePct?: number | null;
}

export function yahooFinancialIndicatorsText(
  reports: PerformanceReport[],
  ticker: string,
  market: Market,
  fallback?: YahooFinancialFallback,
  /** 年度(FY)行——来自 yahoo-annual: meta（与季度行同日在 performance_reports
   *  的 PK 上相撞，故分流存放）。缺省 [] → 不输出年度段（旧行为）。 */
  annual: PerformanceReport[] = [],
): string {
  const currency = marketInfo(market).currency;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (!reports.length) {
    // 报告缺失但快照指标可用 → 仍给一行（比整段占位有用）；都缺 → 旧占位
    const fbEps = num(fallback?.eps);
    const fbRoe = num(fallback?.roePct);
    if (fbEps === null && fbRoe === null) return `（无 ${ticker} 的盈利能力指标，跳过）`;
    const lines = [`【盈利能力指标（快照，Yahoo）】`];
    lines.push(`净资产收益率(ROE): ${fmtNumber(fbRoe, 2)}%`);
    lines.push(`每股收益(EPS): ${fmtNumber(fbEps, 2)} ${currency}`);
    return lines.join('\n');
  }
  const periods = [...new Set(reports.map((r) => r.report_date))].sort();
  const latest = periods[periods.length - 1];
  const f = reports.filter((r) => r.report_date === latest).at(-1)?.fields ?? {};
  // ROE/EPS 回退（2026-11-19 E2E 实测 0700.HK）:HK 的季度收入表行常缺
  // dilutedEPS,资产负债表期次也与收益表对不齐 → 报告行这两项恒 null;
  // 快照源（defaultKeyStatistics.trailingEps / financialData.returnOnEquity）
  // 有值,回退后不再输出无信息量的 N/A。报告值优先（分市场口径更贴报告期）。
  const eps = num(f.eps) ?? num(fallback?.eps);
  const roe = num(f.net_worth_return_rate) ?? num(fallback?.roePct);
  const lines = [`【盈利能力指标（${latest}）】`];
  lines.push(`净利润: ${fmtNumber(num(f.net_profit), 2)} ${currency}`);
  lines.push(`营业收入: ${fmtNumber(num(f.total_income), 2)} ${currency}`);
  lines.push(`净资产收益率(ROE): ${fmtNumber(roe, 2)}%`);
  lines.push(`每股收益(EPS): ${fmtNumber(eps, 2)} ${currency}`);
  // 年度(FY)行:汇总为一行(最新 FY 的营收/净利润/YoY),给 DCF/PEG 一个年度口径
  // 锚;季度序列里没有 FY 行(同日冲突被分流到 meta,见 metaKeys.yahooAnnualKey)。
  const fy = annual.at(-1);
  if (fy !== undefined) {
    const fyF = (fy.fields ?? {}) as Record<string, unknown>;
    const fyYoY = num(fyF.net_profit_YoY_rate);
    lines.push(
      `年度(FY ${fy.report_date}): 营业收入 ${fmtNumber(num(fyF.total_income), 2)} ${currency}`
        + `, 净利润 ${fmtNumber(num(fyF.net_profit), 2)} ${currency}`
        + (fyYoY === null ? '' : `, 净利同比 ${fmtNumber(fyYoY, 2)}%`),
    );
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
  today?: string; // YYYY-MM-DD；缺省 marketToday(market)（cn 即原 asiaToday，逐字节不变）
  /** 实时市场情报注入（cn: TDX MCP;hk/us: Google News RSS）;缺省占位文本。 */
  mcp?: (ticker: string) => string;
  news?: (ticker: string) => string;
  billions?: (ticker: string) => string; // 亿信注入;缺省开关关 → 空串
  progress?: ProgressUpdater | null;
  /** 市场（S4）：块 1/2 单位与换手率、块 3/4 分支;缺省 cn 逐字节不变。 */
  market?: Market;
  /** 业绩报告注入（S4,hk/us 块 3 用）;缺省从 store 读。 */
  reports?: PerformanceReport[];
}

/** build_stock_information 等价：五段拼接（对齐 Python 唯一组装点）。 */
export function buildStockInformation(ticker: string, deps: PipelineDeps): string {
  const { store, progress } = deps;
  const market = deps.market ?? 'cn';
  const today = deps.today ?? marketToday(market);
  const stock = store.getStock(ticker);
  const name = deps.name ?? stock?.name ?? ticker;
  const bars = store.getDatas(ticker);
  const reports = (deps.reports ?? store.getPerformanceReports(ticker))
    .map((r) => ({ report_date: r.report_date, fields: r.fields as ReportFields }));

  safe(deps.progress, `正在获取 ${ticker} 的个股信息与财务数据...`);
  // 块 1 概览:cn 由 composeOverview 现算(F10 eps → PE/PB);hk/us 以 Yahoo
  // 合成概览槽(applyYahooCollectedToStore putStock 写入,含 trailingPE/
  // priceToBook/52周高低/股息率)覆盖重算结果——重算无 F10 源 PE/PB 恒 NaN,
  // 槽缺失时回退重算(演示/未采集场景兜底)
  const overview = {
    ...composeOverview({
      ticker,
      name,
      snapshot: deps.snapshot ?? null,
      capital: deps.capital ?? null,
      f10: deps.f10Text ? parseIndicatorSection(deps.f10Text, '【主要财务指标】') : [],
      bars,
      today,
    }),
    ...(market !== 'cn' ? ((store.getStock(ticker)?.overview ?? {}) as OverviewRow) : {}),
  };
  let info = formatStockOutput(ticker, name, overview, bars, reports, deps.capital ?? null, market);

  // hk/us:Yahoo 画像解析一次，块 1.5（画像文本）与块 3（ROE 回退）共用。
  // CN 恒 null（F10 是 cn 源），不消费（逐字节不变）。
  const yahooProfile = market !== 'cn' ? parseYahooProfile(store.getMeta(yahooProfileKey(ticker))) : null;
  const yahooRoePct =
    yahooProfile && Number.isFinite(yahooProfile.returnOnEquity) ? yahooProfile.returnOnEquity * 100 : NaN;

  // 块 1.5（hk/us）：Yahoo 公司画像/分析师预期 —— hk/us 无 F10 公司资料源，
  // 画像在 yahoo-profile: 元数据（applyYahooCollectedToStore 写入）。
  // 画像缺失/损坏 → 不拼接（不伪造占位段）。
  if (yahooProfile) {
    const profileText = yahooProfileText(yahooProfile, market);
    if (profileText !== '') info += '\n' + profileText;
  }

  safe(progress, `正在计算 ${ticker} 的技术指标...`);
  info += '\n' + trendIndicatorsText(bars, ticker, deps.capital?.liutongguben ?? null, market);

  // 块 3:cn F10 盈利能力;hk/us Yahoo 业绩报告(净利/营收/ROE/EPS,原币单位)
  safe(progress, `正在获取 ${ticker} 的财务指标...`);
  info += '\n' + (market === 'cn'
    ? financialIndicatorsText(deps.f10Text ?? null, ticker)
    : yahooFinancialIndicatorsText(
        deps.reports ?? store.getPerformanceReports(ticker),
        ticker,
        market,
        { eps: overview.eps as number | undefined, roePct: yahooRoePct },
        parseYahooAnnualReports(store.getMeta(yahooAnnualKey(ticker))),
      ));

  // 块 4:cn 现逻辑(注入 mcp 或 TDX_API_KEY 占位);hk/us 走 Google News RSS
  // 情报段(deps.news 预取;未注入 → 旧占位文本逐字不变)
  safe(progress, `正在获取 ${ticker} 的实时市场情报...`);
  info += '\n' + (market === 'cn'
    ? (deps.mcp ? deps.mcp(ticker) : fallbackMarketIntel())
    : (deps.news ? deps.news(ticker) : '（港股/美股暂无实时市场情报源，跳过）'));

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

/** 无 TDX_API_KEY → 占位（与 Python get_market_intel _FALLBACK_TEXT 逐字一致）。
 *  S1-5：文本单源在 mcp.ts（MCP_NO_KEY_TEXT），两处字面量曾各自复制、漂移
 *  无法探知。 */
export function fallbackMarketIntel(): string {
  return MCP_NO_KEY_TEXT;
}

