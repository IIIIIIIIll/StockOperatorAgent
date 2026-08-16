import { describe, expect, it, beforeEach } from 'vitest';
import { AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ROLES, buildEdges, buildNodeNames, enabledRoles, informationAnalystEnabled, makeInvestmentCommittee, type CommitteeDeps } from '../src/committee.ts';
import type { BillionsClient, SearchOptions } from '../src/billionsClient.ts';
import { fromEnv, setCapabilitySwitches } from '../src/switches.ts';

// env DISABLED 键修改后同步配置面(getCapabilitySwitches 未注入时从 env 反推;
// 显式注入优先——本文件用例走 env 驱动语义,与旧行为等价)。
function syncSwitches(): void {
  setCapabilitySwitches(fromEnv());
}

// 路由式假 LLM（对齐 Python 集成测试约定：按 system 消息独有短语路由）
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : ((c as { text?: string }).text ?? ''))).join('\n');
  }
  return String(content ?? '');
}

// langchain JS 的 pipe 只接受 Runnable 或函数（普通对象被拒）——
// stub 用函数形式（附加 invoke 属性满足 LlmLike 类型）
function makeRoutingLlm(route: (systemText: string) => string): unknown {
  const fn = async (messages: unknown) => {
    const list = Array.isArray(messages)
      ? (messages as BaseMessage[])
      : (((messages as { messages?: BaseMessage[] }).messages) ?? []);
    const system = list.find((m) => m._getType?.() === 'system') as SystemMessage | undefined;
    return new AIMessage({ content: route(contentText(system?.content)) });
  };
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn;
}

// 路由短语必须**互斥**（角色消息可能含他角色名——如技术指标消息的
// 禁止段写"那是趋势分析师的职责"）。用各自独有的行为描述短语：
const PHRASES: Array<[string, string]> = [
  ['对抗修订轮的多方交易员', 'BULL_REV'],
  ['对抗修订轮的空方交易员', 'BEAR_REV'],
  ['精于计算公司的基本面数据', 'FUND'],
  ['给出高准确度的客观趋势分析', 'TREND'],
  ['技术指标信号解读与择时判断', 'TECH'],
  ['整合公告、研报、新闻与推特', 'INFO'],
  ['坚定看多的股票交易员', 'BULL'],
  ['坚定看空的股票交易员', 'BEAR'],
  ['精于价值与趋势结合的投资策略', 'FINAL'],
];

function makeRouter(): (text: string) => string {
  return (text: string) => {
    for (const [phrase, tag] of PHRASES) {
      if (text.includes(phrase)) return `${tag}_REPORT`;
    }
    throw new Error(`UNROUTED system: ${text.slice(0, 60)}`);
  };
}

async function runGraph(env: Record<string, string | undefined>, deps?: CommitteeDeps) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  syncSwitches(); // env 修改后配置面反推同步
  try {
    const graph = makeInvestmentCommittee({ configurable: { thread_id: '1' } }, null, makeRoutingLlm(makeRouter()) as never, undefined, deps);
    const chunks: Record<string, unknown>[] = [];
    const stream = await graph.stream({
      messages: [],
      target_stock_ticker: '600036',
      stock_information: 'dummy info',
    }, { configurable: { thread_id: '1' } });
    for await (const chunk of stream) chunks.push(chunk);
    // 最终 state
    const final = await graph.getState({ configurable: { thread_id: '1' } });
    return { chunks, final: final.values as Record<string, unknown> };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('committee graph (AC1/AC2)', () => {
  beforeEach(() => {
    delete process.env.BILLIONS_ANALYST_DISABLED;
    delete process.env.BILLIONS_SEARCH_DISABLED;
    delete process.env.BILLIONS_TWITTER_DISABLED;
    delete process.env.BILLIONS_DISABLED;
    delete process.env.WEB_SEARCH_DISABLED;
    syncSwitches(); // 全开默认态同步
  });

  it('buildNodeNames/buildEdges: 9 nodes 19 edges with information analyst', () => {
    const roles = enabledRoles(); // 信息面开
    expect(roles.length).toBe(7);
    const names = buildNodeNames(roles);
    expect(names.length).toBe(9);
    expect(names).toContain('information_analyst');
    expect(buildEdges(roles).length).toBe(19);
  });

  it('information analyst disabled → 8 nodes 16 edges (conditional wiring)', async () => {
    process.env.BILLIONS_ANALYST_DISABLED = '1';
    syncSwitches();
    const roles = enabledRoles();
    expect(roles.some((r) => r.nodeName === 'information_analyst')).toBe(false);
    expect(buildNodeNames(roles)).toHaveLength(8);
    expect(buildEdges(roles)).toHaveLength(16);
    expect(ROLES.length).toBe(7); // 注册表恒 7 条，谓词过滤
  });

  it('full run: experts → drafts → revisions → final decision reads [-1]', async () => {
    // WEB_SEARCH_DISABLED=1 保持离线（预抓不触发真实 DDG）；谓词不受影响：
    // SEARCH 未禁用 → 分析师仍注册（9 节点断言不变）
    const { final } = await runGraph({ WEB_SEARCH_DISABLED: '1' });
    // 专家产出
    expect(final.fundamental_analysis).toBe('FUND_REPORT');
    expect(final.trend_analysis).toBe('TREND_REPORT');
    expect(final.technical_indicator_analysis).toBe('TECH_REPORT');
    expect(final.information_analysis).toBe('INFO_REPORT');
    // opinions 各 2 条：初稿 + 修订版（追加写，[-1] = 修订版）
    const bullish = final.bullish_opinions as Array<{ content: string }>;
    const bearish = final.bearish_opinions as Array<{ content: string }>;
    expect(bullish.map((m) => m.content)).toEqual(['BULL_REPORT', 'BULL_REV_REPORT']);
    expect(bearish.map((m) => m.content)).toEqual(['BEAR_REPORT', 'BEAR_REV_REPORT']);
    // 经理读修订版（[-1]）——终审内容引用修订版
    expect(final.final_decision).toBe('FINAL_REPORT');
  });
});

describe('informationAnalystEnabled 谓词（契约公式:ANALYST 且(SEARCH|TWITTER|web)）', () => {
  // 本 describe 独立 beforeEach 清 5 个 env key（对齐 graph describe 风格）：
  // 每个用例从全开默认态出发,显式翻转组合,防跨用例残留
  beforeEach(() => {
    delete process.env.BILLIONS_ANALYST_DISABLED;
    delete process.env.BILLIONS_SEARCH_DISABLED;
    delete process.env.BILLIONS_TWITTER_DISABLED;
    delete process.env.BILLIONS_DISABLED;
    delete process.env.WEB_SEARCH_DISABLED;
    syncSwitches(); // 全开默认态同步
  });

  it('全开默认(ANALYST+SEARCH+web) → True', () => {
    expect(informationAnalystEnabled()).toBe(true);
  });

  it('ANALYST 关 + web 开 → False(能力开关优先,联网不补注册)', () => {
    process.env.BILLIONS_ANALYST_DISABLED = '1';
    syncSwitches();
    expect(informationAnalystEnabled()).toBe(false);
  });

  it('ANALYST 开 + SEARCH/TWITTER 关 + web 关 → False(亿信与联网路径全关)', () => {
    process.env.BILLIONS_SEARCH_DISABLED = '1';
    process.env.BILLIONS_TWITTER_DISABLED = '1';
    process.env.WEB_SEARCH_DISABLED = '1';
    syncSwitches();
    expect(informationAnalystEnabled()).toBe(false);
  });

  it('ANALYST 开 + SEARCH/TWITTER 关 + web 开 → True(联网路径)', () => {
    process.env.BILLIONS_SEARCH_DISABLED = '1';
    process.env.BILLIONS_TWITTER_DISABLED = '1';
    syncSwitches();
    expect(informationAnalystEnabled()).toBe(true);
  });

  it('ANALYST 开 + SEARCH 开 + web 关 → True(亿信路径不受 web 影响)', () => {
    process.env.WEB_SEARCH_DISABLED = '1';
    syncSwitches();
    expect(informationAnalystEnabled()).toBe(true);
  });

  it('ANALYST 开 + TWITTER 开 + SEARCH 关 + web 关 → True(TWITTER 路径)', () => {
    process.env.BILLIONS_SEARCH_DISABLED = '1';
    process.env.WEB_SEARCH_DISABLED = '1';
    syncSwitches();
    expect(informationAnalystEnabled()).toBe(true);
  });
});

// ─── C1 key 注入接线（phaseout D）：committee deps.billionsClient →
//     informationAnalyst 工厂 → 分析师预抓三源+twitter ─────────────────────

/** 亿信 fake client（house style 无 mock 框架，agents.test.ts 同款）：记录
 *  调用；hasApiKey 可配（false → 主闸关，模拟无 key 现状）。 */
function makeFakeBillionsClient(
  handlers: {
    search?: (query: string, opts?: SearchOptions) => Promise<Record<string, unknown>>;
    twitterSearch?: (query: string, opts?: SearchOptions) => Promise<Record<string, unknown>>;
  },
  hasApiKey = true,
): {
  client: BillionsClient;
  calls: Array<{ method: 'search' | 'twitterSearch'; query: string }>;
} {
  const calls: Array<{ method: 'search' | 'twitterSearch'; query: string }> = [];
  const client = {
    hasApiKey,
    search: async (query: string, opts?: SearchOptions) => {
      calls.push({ method: 'search', query });
      if (handlers.search) return handlers.search(query, opts);
      return { result: [] };
    },
    twitterSearch: async (query: string, opts?: SearchOptions) => {
      calls.push({ method: 'twitterSearch', query });
      if (handlers.twitterSearch) return handlers.twitterSearch(query, opts);
      return { result: [] };
    },
  } as unknown as BillionsClient;
  return { client, calls };
}

describe('亿信 client 注入接线（C1:committee deps → 分析师预抓）', () => {
  beforeEach(() => {
    delete process.env.BILLIONS_ANALYST_DISABLED;
    delete process.env.BILLIONS_SEARCH_DISABLED;
    delete process.env.BILLIONS_TWITTER_DISABLED;
    delete process.env.BILLIONS_DISABLED;
    delete process.env.WEB_SEARCH_DISABLED;
    syncSwitches(); // 全开默认态同步
  });

  it('deps.billionsClient 注入 → 分析师预抓三源+twitter 命中 fake client（web 端 key 生效）', async () => {
    const { client, calls } = makeFakeBillionsClient({
      search: async (query, opts) => ({
        result: [{ content: [{ title: `结果-${opts?.source}`, link: `https://e.example/${opts?.source}`, snippet: '摘要', date: '2026-08-01' }] }],
      }),
      twitterSearch: async () => ({
        result: [{ content: [{ title: '@trader: 讨论', link: 'https://x.com/trader/1', snippet: '市场情绪转暖', date: '2026-08-02', extra: { username: 'trader', view_count: 128 } }] }],
      }),
    });
    const { final } = await runGraph(
      { WEB_SEARCH_DISABLED: '1', BILLIONS_API_KEY: undefined },
      { billionsClient: client },
    );
    // 注入的 client 经工厂装配进分析师：预抓顺序三源 → twitter（agent 级素材
    // 断言见 agents.test.ts；此处证明委员会接线把 client 送达预抓调用点）
    expect(calls.map((c) => [c.method, c.query])).toEqual([
      ['search', '600036 公告'],
      ['search', '600036 券商研报'],
      ['search', '600036 最新新闻'],
      ['twitterSearch', '600036 最新市场讨论'],
    ]);
    expect(final.information_analysis).toBe('INFO_REPORT');
  });

  it('注入无 key client（主闸关）→ 亿信零请求,报告照常（无 key 行为与现状一致）', async () => {
    const { client, calls } = makeFakeBillionsClient({}, false);
    const { final } = await runGraph(
      { WEB_SEARCH_DISABLED: '1', BILLIONS_API_KEY: undefined },
      { billionsClient: client },
    );
    expect(calls).toEqual([]); // 亿信路径静默关闭（对齐 Python 主闸），不触网
    expect(final.information_analysis).toBe('INFO_REPORT'); // 固定回退文本路径照常
  });
});
