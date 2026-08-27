// 查询内容契约测试:各角色 LLM 调用必须嵌入真实数据——
// 专家嵌 stock_information(修复前只传"请分析 XX"一句话,分析师拿不到数据);
// 交易员嵌三份专家报告;经理嵌报告 + 双方观点。对齐 Python
// agents/chinese_mainland/*.py 的 f-string 查询(逐字)。
// 捕获式假 LLM:按 system 路由 + 记录每次 human query,断言数据注入。
import { describe, expect, it, beforeEach } from 'vitest';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { makeInvestmentCommittee } from '../src/committee.ts';
import { fromEnv, setCapabilitySwitches } from '../src/switches.ts';

const STOCK_INFO = 'MARKET_DATA_BLOCK_600036【技术指标】MA5=10.5 MACD=0.3';
const TICKER = '600036';

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : ((c as { text?: string }).text ?? ''))).join('\n');
  }
  return String(content ?? '');
}

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

function routeFor(systemText: string): string {
  for (const [phrase, tag] of PHRASES) {
    if (systemText.includes(phrase)) return tag;
  }
  throw new Error(`UNROUTED system: ${systemText.slice(0, 60)}`);
}

/** 捕获式假 LLM:返回路由标记报告,并记录 {route, query} 供断言。 */
function makeCapturingLlm(): { llm: unknown; calls: Array<{ route: string; query: string }> } {
  const calls: Array<{ route: string; query: string }> = [];
  const fn = async (messages: unknown) => {
    const list = Array.isArray(messages)
      ? (messages as BaseMessage[])
      : (((messages as { messages?: BaseMessage[] }).messages) ?? []);
    const system = list.find((m) => m._getType?.() === 'system');
    const human = list.find((m) => m._getType?.() === 'human') as { content?: unknown } | undefined;
    const route = routeFor(contentText(system?.content));
    calls.push({ route, query: contentText(human?.content) });
    return new AIMessage({ content: `${route}_REPORT` });
  };
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return { llm: fn, calls };
}

async function runCapture() {
  const { llm, calls } = makeCapturingLlm();
  const graph = makeInvestmentCommittee({ configurable: { thread_id: 'q1' } }, null, llm as never);
  const stream = await graph.stream(
    { messages: [], target_stock_ticker: TICKER, stock_information: STOCK_INFO },
    { configurable: { thread_id: 'q1' } },
  );
  for await (const _chunk of stream) {
    /* 事件已由捕获 llm 记录 */
  }
  return calls;
}

describe('role query 数据注入契约（修复:分析师拿不到数据）', () => {
  beforeEach(() => {
    // 信息面分析师默认启用(与 committee.test 同基线)
    delete process.env.BILLIONS_DISABLED;
    delete process.env.BILLIONS_ANALYST_DISABLED;
    delete process.env.BILLIONS_SEARCH_DISABLED;
    delete process.env.BILLIONS_TWITTER_DISABLED;
    // F21 离线隔离:联网搜索强制关 + 亿信 key 删除(懒加载 client 主闸关闭),
    // 防本机 env 残留触真网(20s fetch vs 15s testTimeout 抖动窗;CI 亦无网)
    process.env.WEB_SEARCH_DISABLED = '1';
    delete process.env.BILLIONS_API_KEY;
    setCapabilitySwitches(fromEnv()); // env 修改后配置面反推同步(agents.test 同款)
  });

  it('专家 query 嵌入 stock_information(基本面/趋势/技术指标)', async () => {
    const calls = await runCapture();
    for (const tag of ['FUND', 'TREND', 'TECH']) {
      const call = calls.find((c) => c.route === tag);
      expect(call, `${tag} 调用缺失`).toBeDefined();
      expect(call!.query).toContain(`请基于以下真实数据给出你对股票代码${TICKER}`);
      expect(call!.query).toContain(STOCK_INFO); // 数据块必须进 LLM 上下文
    }
  });

  it('信息面分析师 query 嵌股票信息 + 素材上下文', async () => {
    const calls = await runCapture();
    const info = calls.find((c) => c.route === 'INFO');
    expect(info).toBeDefined();
    expect(info!.query).toContain('股票信息');
    expect(info!.query).toContain(STOCK_INFO);
    expect(info!.query).toContain('检索到的信息面素材');
  });

  it('交易员初稿 query 嵌三份专家报告', async () => {
    const calls = await runCapture();
    for (const tag of ['BULL', 'BEAR']) {
      const call = calls.find((c) => c.route === tag);
      expect(call, `${tag} 调用缺失`).toBeDefined();
      expect(call!.query).toContain('基本面报告');
      expect(call!.query).toContain('FUND_REPORT'); // 路由假 LLM 输出的专家报告
      expect(call!.query).toContain('TREND_REPORT');
      expect(call!.query).toContain('TECH_REPORT');
      expect(call!.query).not.toContain('undefined');
    }
  });

  it('对抗修订 query 嵌对方观点与己方初稿', async () => {
    const calls = await runCapture();
    for (const tag of ['BULL_REV', 'BEAR_REV']) {
      const call = calls.find((c) => c.route === tag);
      expect(call, `${tag} 调用缺失`).toBeDefined();
      expect(call!.query).toContain('你的初稿');
      expect(call!.query).toContain(`${tag === 'BULL_REV' ? '空方' : '多方'}交易员观点`);
      expect(call!.query).toContain(`${tag === 'BULL_REV' ? 'BULL' : 'BEAR'}_REPORT`);
      expect(call!.query).toContain(`${tag === 'BULL_REV' ? 'BEAR' : 'BULL'}_REPORT`);
    }
  });

  it('经理 query 嵌三份专家报告 + 双方修订版观点', async () => {
    const calls = await runCapture();
    const final = calls.find((c) => c.route === 'FINAL');
    expect(final, '经理调用缺失').toBeDefined();
    expect(final!.query).toContain('基本面报告');
    expect(final!.query).toContain('FUND_REPORT');
    expect(final!.query).toContain('TECH_REPORT');
    expect(final!.query).toContain('多头观点');
    expect(final!.query).toContain('BULL_REV_REPORT');
    expect(final!.query).toContain('空头观点');
    expect(final!.query).toContain('BEAR_REV_REPORT');
  });

  it('任何角色 query 不含 undefined/占位泄漏', async () => {
    const calls = await runCapture();
    for (const call of calls) {
      expect(call.query, `${call.route} query 泄漏 undefined`).not.toContain('undefined');
    }
  });
});
