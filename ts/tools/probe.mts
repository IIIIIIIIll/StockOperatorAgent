// SOA_LIVE 端到端探针:真 TDX + 真 LLM 完成一次全分析 → probe-output/report.json
// 运行:SOA_LIVE=1 npm run probe -- 600036
// 依赖环境:LLM_API_KEY / LLM_MODEL / LLM_BASE_URL(三键);TDX 直连行情无需 key。
import fs from 'node:fs';
import { TdxClient } from 'node-tdx-market';
import { Store } from '../src/store.ts';
import { createPipelineRunner } from '../src/events.ts';
import { makeLlm } from '../src/llm.ts';
import { getCompanyInfoCategory, getCompanyInfoContent } from '../src/tdx/f10Client.ts';
import { collectAll } from '../src/tdx/quoteClient.ts';

async function fetchF10(client: TdxClient, ticker: string): Promise<string> {
  const cats = await getCompanyInfoCategory(client, 1, ticker);
  const section = cats.find((c) => c.name.includes('财务分析'));
  if (!section) return '';
  return getCompanyInfoContent(client, 1, ticker, section.filename, section.start, section.length);
}

async function main(): Promise<void> {
  const ticker = process.argv[2] ?? '600036';
  fs.mkdirSync('probe-output', { recursive: true });
  const store = new Store('probe-output/soa.sqlite');
  const client = new TdxClient({ connectTimeout: 8000, requestTimeout: 12000 });
  client.on('error', () => {});
  const runner = createPipelineRunner(store);
  runner.subscribe((e) => {
    if (e.type === 'progress') console.error(`  · ${e.message}`);
    else if (e.type === 'report') console.error(`  · 报告[${e.tabTitle}] ${e.content.length} 字符`);
  });
  try {
    console.error(`=== 探针 ${ticker} ===`);
    await client.connect();
    const f10Text = await fetchF10(client, ticker);
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

    // LLM:三键齐 → 真 LLM;缺 → 占位 stub(验证真数据链,LLM 段留待配 key)
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
    const report = await runner.run(ticker, { f10Text, llm });
    console.error(`  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s;final_decision ${report.final_decision.length} 字符`);
    const out = {
      ticker: report.ticker,
      final_decision: report.final_decision,
      opinions: report.opinions.map((o) => ({ key: o.key, tabTitle: o.tabTitle, length: o.content.length })),
      stock_information_head: report.stock_information.slice(0, 3000),
    };
    fs.writeFileSync('probe-output/report.json', JSON.stringify(out, null, 2));
    console.error(`  已落盘 probe-output/report.json`);
  } finally {
    client.disconnect();
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
