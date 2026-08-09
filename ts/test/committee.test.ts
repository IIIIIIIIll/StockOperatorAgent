import { describe, expect, it, beforeEach } from 'vitest';
import { AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ROLES, buildEdges, buildNodeNames, enabledRoles, makeInvestmentCommittee } from '../src/committee';

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

async function runGraph(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const graph = makeInvestmentCommittee({ configurable: { thread_id: '1' } }, null, makeRoutingLlm(makeRouter()) as never);
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
    const roles = enabledRoles();
    expect(roles.some((r) => r.nodeName === 'information_analyst')).toBe(false);
    expect(buildNodeNames(roles)).toHaveLength(8);
    expect(buildEdges(roles)).toHaveLength(16);
    expect(ROLES.length).toBe(7); // 注册表恒 7 条，谓词过滤
  });

  it('full run: experts → drafts → revisions → final decision reads [-1]', async () => {
    const { final } = await runGraph({});
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
