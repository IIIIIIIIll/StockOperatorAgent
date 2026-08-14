// 事件桥 runner 绑定 —— App 与业务层(ts/src)的唯一接线点
// 数据:web 走 server /tdx-collect 代理(collectForWeb);真机留注入点(走 RN TCP)。
// LLM:三键齐(设置面板)→ 真 LLM;缺 → 演示 stub(图全链跑通)。
import { InMemoryStore } from '../../src/store-memory.ts';
import { createPipelineRunner, type PipelineEvent, type FinalReport } from '../../src/events.ts';
import { createLlm, MissingLlmConfigError, type LlmConfig } from '../../src/llm.ts';
import { applyCollectedToStore, collectViaProxy, type WebCollectResult } from '../../src/webCollect.ts';
import { asiaToday, freshnessGates } from '../../src/gates.ts';
import { info } from '../../src/log.ts';
import { getMarketIntel } from '../../src/mcp.ts';
import { BillionsClient } from '../../src/billionsClient.ts';
import { billionsEnabled } from '../../src/committee.ts';
import { makeBillionsTools } from '../../src/billionsTools.ts';
import { makeWebSearchTool, webSearchEnabled } from '../../src/webSearch.ts';
import type { ToolLike } from '../../src/toolLoop.ts';
import { AIMessage } from '@langchain/core/messages';
import demo from '../data/demo.json';
import type { CapsState } from './settings.ts';

export const store = new InMemoryStore();

// 演示数据载入(600036:250 根日K + 指标 + F10;仅预览/未起 server 时的占位视图)
export function loadDemoData(): void {
  store.putStock({
    ticker: demo.ticker,
    name: demo.name,
    overview: null,
    overviewLastUpdate: null,
    lastDataUpdate: demo.bars[demo.bars.length - 1].date,
  });
  store.addDatas(demo.ticker, demo.bars as never);
  store.setMeta('demo:f10', demo.f10_text);
}

export const runner = createPipelineRunner(store);

// 浏览器全局（ts/ 为 node-only lib 无 DOM 类型；运行时守卫 typeof location，
// webSearch.ts 同款探针姿势）。
declare const location: { origin?: string } | undefined;

/** 采集跳过选项:缺省(undefined)按 store 现有数据自动判定(freshnessGates);
 *  显式布尔值覆盖自动判定(测试/调试用)。向后兼容——旧调用无第二参,恒全量判定。 */
export interface CollectForWebOpts {
  skipDaily?: boolean;
  skipF10?: boolean;
}

/** web 采集(server /tdx-collect 代理)→ 写 InMemoryStore;返回本次采集结果
 *  (f10Text/snapshot/name 供 runner.run opts)。失败抛错 → 调用方中止分析。
 *  C8 freshness 接线:依据 store 现有数据(stock.lastDataUpdate /
 *  performance_reports 最新 report_date)判定同日跳过日K、同季跳过 F10,
 *  跳过源不拉网络、沿用既有数据(不置空);部分 fresh 不整体短路。
 *  同季跳过 F10 时用上次入库的缓存文本(f10:ticker meta)顶替,盈利能力块不降级占位。 */
export async function collectForWeb(ticker: string, opts?: CollectForWebOpts): Promise<WebCollectResult> {
  const today = asiaToday();
  const stock = store.getStock(ticker);
  const reports = store.getPerformanceReports(ticker);
  const latestReportDate = reports.reduce((m, r) => (r.report_date > m ? r.report_date : m), '') || null;
  const gates = freshnessGates(stock?.lastDataUpdate ?? null, latestReportDate, today);
  const skipDaily = opts?.skipDaily ?? gates.dailyFresh;
  const skipF10 = opts?.skipF10 ?? gates.f10Fresh;
  const skipped: string[] = [];
  if (skipDaily) skipped.push('日K(同日已采集)');
  if (skipF10) skipped.push('F10财务分析(同季已入库)');
  if (skipped.length) info(`跳过采集:${skipped.join('、')},沿用既有数据`);
  // web 端 location 全局(ts/ 为 node-only lib 无 DOM 类型;运行时守卫 typeof,
  // webSearch.ts 同款探针姿势)。Node/RN 无 location → '' 相对 URL——本函数仅
  // web 路径调用(App 已按 Platform.OS 门控)。
  const origin = typeof location !== 'undefined' ? location.origin ?? '' : '';
  const payload = await collectViaProxy(ticker, origin, { skipDaily, skipF10 });
  // 同季跳过 F10:代理未拉文本 → 缓存文本顶替(applyCollectedToStore 幂等重写)
  if (skipF10 && !payload.f10Text) {
    payload.f10Text = store.getMeta(`f10:${ticker}`) ?? '';
  }
  return applyCollectedToStore(store, payload);
}

// ─── 设置持久化(web:localStorage;RN 真机后续接 AsyncStorage) ──────────────

const CFG_KEY = 'soa:llm-config';

export function readSavedConfig(): LlmConfig | null {
  try {
    const raw = globalThis.localStorage?.getItem(CFG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as LlmConfig;
    if (cfg.apiKey && cfg.model && cfg.baseUrl) return cfg;
    return null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: LlmConfig): void {
  try {
    globalThis.localStorage?.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* web 外无 localStorage */
  }
}

export function clearConfig(): void {
  try {
    globalThis.localStorage?.removeItem(CFG_KEY);
  } catch {
    /* noop */
  }
}

// ─── 演示 stub LLM(无三键时;按 system 消息路由角色) ─────────────────────

function demoLlm(): unknown {
  const fn = async (payload: unknown) => {
    const list = Array.isArray(payload)
      ? (payload as Array<{ _getType?: () => string; content?: unknown }>)
      : (((payload as { messages?: Array<{ _getType?: () => string; content?: unknown }> }).messages) ?? []);
    const sys = list.find((m) => m._getType?.() === 'system');
    const text = typeof sys?.content === 'string' ? sys.content : '';
    // 互斥独有短语(对齐 committee.test 路由约定)——经理消息开头含'投资经理',
    // 修订轮含'对抗修订轮',角色描述互不包含
    const PHRASES: Array<[string, string]> = [
      ['对抗修订轮的多方交易员', '看涨'],
      ['对抗修订轮的空方交易员', '看跌'],
      ['坚定看多的股票交易员', '看涨'],
      ['坚定看空的股票交易员', '看跌'],
      ['精于计算公司的基本面数据', '基本面'],
      ['给出高准确度的客观趋势分析', '趋势'],
      ['技术指标信号解读与择时判断', '指标'],
      ['整合公告、研报、新闻与推特', '信息面'],
      ['投资经理', '投资经理'],
    ];
    let tag = '占位';
    let tagIdx = text.length;
    for (const [phrase, label] of PHRASES) {
      const i = text.indexOf(phrase);
      if (i >= 0 && i < tagIdx) {
        tag = label;
        tagIdx = i;
      }
    }
    return new AIMessage({
      content: `[演示·${tag}] 演示模式报告:未配置 LLM 三键,本报告为占位文本。真实分析请在设置中填写 LLM_API_KEY/LLM_MODEL/LLM_BASE_URL 后重跑。`,
    });
  };
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn;
}

export type { PipelineEvent, FinalReport, LlmConfig };

/** 执行分析:三键齐 → 真 LLM;缺 → 演示 stub。proxyBase(web 同源代理)
 *  传入则 LLM 调用经代理(绕开 CORS);Node/真机传 undefined 直连。 */
export function buildLlm(cfg: LlmConfig | null, proxyBase?: string): unknown {
  if (cfg) return createLlm(cfg, proxyBase ? { proxyBase } : undefined);
  return demoLlm();
}

export function configError(cfg: LlmConfig | null): string | null {
  if (cfg) return null;
  return '未配置 LLM 三键——将使用演示占位报告。';
}

// ─── 亿信/mcp 情报段注入（phase out 能力补齐；预查询一次 → 缓存闭包注入，
//     buildStockInformation 与 runner.run 双算共享同一文本，不重复触发网络）───

/** 亿信 fin-db 段：查询一次 → 同步闭包。开关关/无 key → undefined（该段不出现，
 *  对齐 Python 空串语义）；查询失败 → 占位文本闭包（不 raise，不污染上下文）。 */
export async function makeBillionsIntel(
  ticker: string,
  apiKey: string | null,
): Promise<((t: string) => string) | undefined> {
  if (!billionsEnabled('FINDB') || !apiKey) return undefined;
  const client = new BillionsClient({ apiKey });
  let text: string;
  try {
    const data = await client.finDb(`查询${ticker}的最新财务数据和近期行情表现，包括营收、净利润、市盈率等关键指标。`);
    const results = (data?.result ?? []) as Array<{ content?: unknown }>;
    const parts = results
      .filter((item) => item && typeof item === 'object' && item.content)
      .map((item) => String(item.content));
    text = parts.length
      ? `【亿信金融数据库】\n${parts.join('\n\n')}`
      : `（亿信金融数据库无返回结果，跳过${ticker}的财务问数）`;
  } catch {
    text = `（亿信金融数据库查询失败，跳过${ticker}的财务问数）`;
  }
  return () => text;
}

/** mcp 实时情报段：查询一次 → 同步闭包。禁用/无 key → undefined（对齐 Python
 *  占位文本语义由 getMarketIntel 内部处理；undefined 时 pipeline 走 fallback）。 */
export async function makeMcpIntel(
  ticker: string,
  apiKey: string | null,
): Promise<((t: string) => string) | undefined> {
  if (!apiKey) return undefined;
  const text = await getMarketIntel(ticker, { apiKey });
  return () => text;
}

/** 委员会工具组装：web_search（开关）+ 亿信三件套（各开关 + 主闸 key）。
 *  返回 undefined 表示无任何工具启用（committee 内部按 webSearch 开关兜底——
 *  但 App 层已判定，此处空数组时传 [] 即可，等价）。web 端亿信 key 在
 *  localStorage（settings.keys.billionsApiKey），经 apiKey 注入。
 *  caps（settings.caps）可选：注入亿信三件套各自调用上限（优先于 env
 *  BILLIONS_{CAP}_MAX_CALLS 与默认）；未传/字段缺失/非法值 → 回退 env/默认。 */
export function assembleTools(
  keys: { billionsApiKey?: string; tdxApiKey?: string },
  caps?: Partial<CapsState>,
): ToolLike[] {
  const tools: ToolLike[] = [];
  if (webSearchEnabled()) tools.push(makeWebSearchTool());
  const billions = makeBillionsTools({
    apiKey: keys.billionsApiKey || undefined,
    ...(caps ? { maxCallsByCap: { SEARCH: caps.searchMax, TWITTER: caps.twitterMax, FETCH: caps.fetchMax } } : {}),
  });
  tools.push(...billions);
  return tools;
}
