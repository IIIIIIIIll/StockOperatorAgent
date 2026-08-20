// SOA_LIVE 端到端探针:真 TDX/真 Yahoo + 真 LLM 完成一次全分析 → probe-output/report.json
// 运行:SOA_LIVE=1 npm run probe -- 600036(A 股)/ 00700(港股)/ AAPL(美股)
// 依赖环境:LLM_API_KEY / LLM_MODEL / LLM_BASE_URL(三键,全链模式必需);TDX
// 直连行情无需 key(A 股);Yahoo 直连免 key(港股/美股)。
// SOA_COLLECT_ONLY=1:仅采集入库 → 打印 行情已入库/业绩报告/概览键摘要 →
// 写 probe-output/report.json {ticker, bars, reports, overview} → 退出
// (不要求 LLM 三键、不跑委员会);未设 → 现有全链逻辑(LLM 三键必需,错误照旧)。
import fs from 'node:fs';
import { TdxClient } from 'node-tdx-market';
import { Store } from '../src/store.ts';
import { createPipelineRunner, type PipelineRunner } from '../src/events.ts';
import { makeLlm } from '../src/llm.ts';
import { f10MarketFor, getCompanyInfoCategory, getCompanyInfoContent } from '../src/tdx/f10Client.ts';
import { collectAll } from '../src/tdx/quoteClient.ts';
import { parseCapitalStructure, parseFinanceIndicatorsAllTables, parseIndicatorSection } from '../src/f10.ts';
import { composeReports } from '../src/reports.ts';
import { composeOverview } from '../src/overview.ts';
import { asiaToday } from '../src/gates.ts';
import { detectMarket, type Market } from '../src/market.ts';
import { YahooClient } from '../src/yahoo/yahooClient.ts';
import { collectYahooPayload, obtainA3 } from '../src/yahoo/deviceYahooCollect.ts';
import { applyYahooCollectedToStore } from '../src/yahoo/applyYahooCollectedToStore.ts';

async function fetchSection(client: TdxClient, ticker: string, namePart: string): Promise<string> {
  // market 按交易所推断(0=深 1=沪)——旧硬编码 1 只对 6xxxxx 正确
  const market = f10MarketFor(ticker);
  const cats = await getCompanyInfoCategory(client, market, ticker);
  const section = cats.find((c) => c.name.includes(namePart));
  if (!section) return '';
  return getCompanyInfoContent(client, market, ticker, section.filename, section.start, section.length);
}

/** 概览键摘要(前 8 键,SOA_COLLECT_ONLY 打印契约)。 */
function overviewKeys(overview: Record<string, number | string>): string {
  return Object.keys(overview)
    .slice(0, 8)
    .map((k) => `${k}=${String(overview[k])}`)
    .join(', ');
}

/** 全链 LLM 段(CN/hk/us 共用):三键齐 → 真 LLM;缺 → 占位 stub;runner.run 后
 *  写完整 report.json。LLM 三键必需,错误照旧。 */
async function runFullAnalysis(
  store: Store,
  runner: PipelineRunner,
  ticker: string,
  opts: {
    f10Text?: string | null;
    capital?: { zongguben: number; liutongguben: number } | null;
    name?: string | null;
    snapshot?: { price: number; high: number; low: number; open: number } | null;
    market?: Market;
  },
): Promise<void> {
  let llm: unknown;
  const keysOk = ['LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL'].every(
    (k) => (process.env[k] ?? '').trim() !== '',
  );
  if (keysOk) {
    llm = makeLlm();
    console.error('  · 使用真实 LLM(三键齐)');
  } else {
    llm = stubLlm();
    console.error('  ! 未配置 LLM 三键,使用占位 LLM(仅验证数据链)');
  }

  const t0 = Date.now();
  const report = await runner.run(ticker, { ...opts, llm });
  console.error(`  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s;final_decision ${report.final_decision.length} 字符`);
  const out = {
    ticker: report.ticker,
    final_decision: report.final_decision,
    opinions: report.opinions.map((o) => ({ key: o.key, tabTitle: o.tabTitle, length: o.content.length })),
    stock_information_head: report.stock_information.slice(0, 3000),
  };
  fs.writeFileSync('probe-output/report.json', JSON.stringify(out, null, 2));
  console.error('  已落盘 probe-output/report.json');
}

/** CN 链路(原样保留):TdxClient 直连 + F10 两节 + collectAll → 入库。
 *  SOA_COLLECT_ONLY → 概览合成 + 摘要打印 + report.json 后退出(不跑委员会)。 */
async function collectCn(store: Store, runner: PipelineRunner, ticker: string, collectOnly: boolean): Promise<void> {
  const client = new TdxClient({ connectTimeout: 8000, requestTimeout: 12000 });
  client.on('error', () => {});
  try {
    await client.connect();
    const f10Text = await fetchSection(client, ticker, '财务分析');
    const capitalText = await fetchSection(client, ticker, '股本结构');
    if (!f10Text) console.error('  ! F10 财务分析为空(跳过盈利能力段)');

    // 采集:快照/日K/名称 → store(探针侧,App bundle 不引入 node-tdx-market)
    const collected = await collectAll(client, ticker, {
      get: (k) => store.getMeta(k),
      set: (k, v) => store.setMeta(k, v),
    });
    const existing = store.getStock(ticker);
    store.putStock({
      ticker,
      name: collected.name ?? existing?.name ?? ticker,
      overview: existing?.overview ?? null,
      overviewLastUpdate: existing?.overviewLastUpdate ?? null,
      lastDataUpdate: existing?.lastDataUpdate ?? null,
    });
    store.addDatas(ticker, collected.bars);
    console.error(`  · 行情已入库(${collected.bars.length} 根日K)`);

    // 业绩报告:F10 财务分析节 → 每报告期一行入库(对齐 Python build_reports)
    const reports = composeReports(
      ticker,
      collected.name ?? existing?.name ?? ticker,
      parseFinanceIndicatorsAllTables(f10Text),
    );
    if (reports.length) {
      store.addPerformanceReports(ticker, reports);
      console.error(`  · 业绩报告已入库(${reports.length} 期,最新 ${reports[reports.length - 1].report_date})`);
    } else {
      console.error('  ! 无业绩报告(F10 无可映射指标)');
    }

    if (collectOnly) {
      const overview = composeOverview({
        ticker,
        name: collected.name ?? existing?.name ?? ticker,
        snapshot: collected.snapshot,
        capital: parseCapitalStructure(capitalText),
        f10: parseIndicatorSection(f10Text, '【主要财务指标】'),
        bars: collected.bars,
        today: asiaToday(),
      });
      console.error(`  · 概览键摘要(前 8 键):${overviewKeys(overview)}`);
      fs.writeFileSync(
        'probe-output/report.json',
        JSON.stringify({ ticker, bars: collected.bars, reports, overview }, null, 2),
      );
      console.error('  已落盘 probe-output/report.json(SOA_COLLECT_ONLY,跳过 LLM 全链)');
      return;
    }
    await runFullAnalysis(store, runner, ticker, { f10Text, capital: parseCapitalStructure(capitalText) });
  } finally {
    client.disconnect();
  }
}

/** 港美股链路:Yahoo 直连(chart 候选试探 + quoteSummary + 合成 + 入库;
 *  跳过 F10/TdxClient 分支;putStock 等由 applyYahooCollectedToStore 处理)。
 *  SOA_COLLECT_ONLY → 摘要打印 + report.json 后退出;未设 → 全链(LLM 三键必需)。 */
async function collectYahoo(store: Store, runner: PipelineRunner, ticker: string, market: Market, collectOnly: boolean): Promise<void> {
  // fc.yahoo.com 实测 404 但仍回 Set-Cookie A3(2026-08-20):预取 A3 经
  // cookieProvider 注入(YahooClient 自身 fc 请求遇非 2xx 会抛,crumb 链断)
  const a3 = await obtainA3();
  const client = new YahooClient(undefined, () => a3);
  const payload = await collectYahooPayload(client, ticker);
  applyYahooCollectedToStore(store, payload, market);
  console.error(`  · 行情已入库(${payload.bars.length} 根日K)`);
  console.error(
    `  · 业绩报告(${payload.reports.length} 行${payload.reports.length ? `,最新 ${payload.reports[payload.reports.length - 1].report_date}` : ''})`,
  );
  console.error(`  · 概览键摘要(前 8 键):${overviewKeys(payload.overview)}`);
  if (typeof payload.overview.currency === 'string') {
    console.error(`  · 概览 currency=${payload.overview.currency}`); // 验收锚点(stdout 可见)
  }
  if (collectOnly) {
    fs.writeFileSync(
      'probe-output/report.json',
      JSON.stringify(
        { ticker: payload.ticker, bars: payload.bars, reports: payload.reports, overview: payload.overview },
        null,
        2,
      ),
    );
    console.error('  已落盘 probe-output/report.json(SOA_COLLECT_ONLY,跳过 LLM 全链)');
    return;
  }
  // 全链:数据链已入库,runner.run 与 CN 共用(pipeline market 分支已就绪,S4)
  const capital =
    Number.isFinite(payload.capital.zongguben) || Number.isFinite(payload.capital.liutongguben)
      ? payload.capital
      : null;
  await runFullAnalysis(store, runner, payload.ticker, {
    f10Text: null,
    capital,
    name: payload.name,
    snapshot: payload.snapshot,
    market,
  });
}

async function main(): Promise<void> {
  const ticker = (process.argv[2] ?? '600036').trim();
  fs.mkdirSync('probe-output', { recursive: true });
  const store = new Store('probe-output/soa.sqlite');
  const market = detectMarket(ticker);
  const collectOnly = (process.env.SOA_COLLECT_ONLY ?? '') === '1';
  const runner = createPipelineRunner(store);
  runner.subscribe((e) => {
    if (e.type === 'progress') console.error(`  · ${e.message}`);
    else if (e.type === 'report') console.error(`  · 报告[${e.tabTitle}] ${e.content.length} 字符`);
  });
  console.error(`=== 探针 ${ticker} ===`);
  // ticker 经 detectMarket 市场分派:cn → 现有 TDX 链路原样;hk/us → Yahoo 直连
  // (跳过 F10/TdxClient);detectMarket null(非法输入)→ 沿用旧行为走 CN 链路
  if (market === 'hk' || market === 'us') {
    await collectYahoo(store, runner, ticker, market, collectOnly);
  } else {
    await collectCn(store, runner, ticker, collectOnly);
  }
}

// 占位 LLM(无三键时):按 system 消息返回角色标记报告,让图跑通
import { AIMessage } from '@langchain/core/messages';

function stubLlm(): unknown {
  const fn = async (payload: unknown) => {
    const list = Array.isArray(payload)
      ? (payload as Array<{ _getType?: () => string; content?: unknown }>)
      : (((payload as { messages?: Array<{ _getType?: () => string; content?: unknown }> }).messages) ?? []);
    const sys = list.find((m) => m._getType?.() === 'system');
    const text = typeof sys?.content === 'string' ? sys.content : '';
    const tag = ['基本面', '趋势', '指标', '信息', '看涨', '看空', '投资经理'].find((p) => text.includes(p)) ?? '占位';
    return new AIMessage({ content: `[${tag}占位报告] 本环境未配置 LLM_API_KEY/LLM_MODEL/LLM_BASE_URL,数据链验证模式。` });
  };
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn;
}

main().catch((err) => {
  console.error('探针失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
