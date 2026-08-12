import { describe, expect, it } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import { BillionsInformationAnalyst, BullishTrader, FundamentalAnalysisExpert, type CompleteOptions } from '../src/agents.ts';
import type { SearchResult } from '../src/webSearch.ts';

function stubLlm() {
  const fn = async () => new AIMessage({ content: 'ok' });
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn as unknown as { invoke(): Promise<AIMessage>; bindTools?: (t: unknown[]) => unknown };
}

// 捕获式 spy 分析师：覆写 completeExpert 记录查询文本（house style 无 mock
// 框架——覆写点即注入点；LLM 链/模板格式化由 committee 全量运行用例覆盖）
class CapturingAnalyst extends BillionsInformationAnalyst {
  captured: string | null = null;
  async completeExpert(
    queryText: string,
    stateKey: string,
    _opts: CompleteOptions,
  ): Promise<Record<string, unknown>> {
    this.captured = queryText;
    return { messages: [], [stateKey]: 'INFO_REPORT' };
  }
}

// 运行分析师节点（注入 fake searcher + env save/restore——离线零网络契约）：
// WEB_SEARCH_DISABLED 未显式给出 → 删除（web 默认开），防开发者本机残留
async function runAnalyst(
  searcher: (q: string) => Promise<SearchResult[]>,
  env: Record<string, string | undefined>,
): Promise<{ query: string; calls: string[] }> {
  const saved: Record<string, string | undefined> = {};
  const keys = ['WEB_SEARCH_DISABLED', ...Object.keys(env)]; // 重复 key 幂等,restore 以对象去重
  for (const k of keys) {
    saved[k] = process.env[k];
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const calls: string[] = [];
    const fake = async (q: string) => {
      calls.push(q);
      return searcher(q);
    };
    const analyst = new CapturingAnalyst(stubLlm() as never, {}, null, fake);
    await analyst.information_analyst({ target_stock_ticker: '600036', stock_information: 'dummy info' });
    return { query: analyst.captured ?? '', calls };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('BillionsInformationAnalyst 联网预抓回退（R4,离线注入）', () => {
  it('注入 fake searcher → 查询含【联网搜索结果】素材节;固定 1 次 {ticker} 最新新闻', async () => {
    const { query, calls } = await runAnalyst(
      async () => [{ title: '招商银行最新动态', link: 'https://example.com/news', snippet: '净利润增长 10%' }],
      {},
    );
    expect(calls).toEqual(['600036 最新新闻']); // 固定 1 次,web 模板
    expect(query).toContain('【联网搜索结果】');
    expect(query).toContain('标题：招商银行最新动态');
    expect(query).toContain('链接：https://example.com/news');
  });

  it('searcher throw → 固定回退文本逐字保留(不 raise)', async () => {
    const { query, calls } = await runAnalyst(
      async () => { throw new Error('ddgs 反爬拦截'); },
      {},
    );
    expect(calls).toEqual(['600036 最新新闻']); // 尝试过但失败 → 降级
    expect(query).toContain('（本次运行未检索到任何信息面素材：所有来源均不可用或未启用）');
  });

  it('WEB_SEARCH_DISABLED=1 → 不调用 searcher,直接用固定回退文本', async () => {
    const { query, calls } = await runAnalyst(
      async () => [{ title: 'x', link: 'y', snippet: 'z' }],
      { WEB_SEARCH_DISABLED: '1' },
    );
    expect(calls).toEqual([]); // web 关不触网
    expect(query).toContain('（本次运行未检索到任何信息面素材：所有来源均不可用或未启用）');
  });
});

describe('bind_tools fallback (AC5)', () => {
  it('llm without bindTools → no binding, construction does not throw', () => {
    const llm = stubLlm() as unknown as { invoke(): Promise<AIMessage> }; // 无 bindTools
    const agent = new BullishTrader(llm as never, {});
    expect(agent).toBeTruthy();
  });

  it('bindTools throws (NotImplementedError-style) → fallback to direct call', async () => {
    const llm = stubLlm();
    llm.bindTools = () => { throw new Error('bindTools not supported'); };
    const agent = new BullishTrader(llm as never, {}, null, [{ name: 'web_search', invoke: () => 'r' }]);
    expect(agent).toBeTruthy();
  });

  it('bindTools works → tools bound for tool roles', () => {
    let bound: unknown = null;
    const llm = stubLlm();
    llm.bindTools = (tools) => { bound = tools; return llm; };
    const tools = [{ name: 'web_search', invoke: () => 'r' }];
    const agent = new BullishTrader(llm as never, {}, null, tools);
    expect(agent).toBeTruthy();
    expect(bound).toBe(tools);
  });

  it('expert ignores tools (no bindTools path)', () => {
    const llm = stubLlm();
    const agent = new BullishTrader(llm as never, {}, null, []);
    expect(agent).toBeTruthy();
  });
});

describe('completeExpert 流式状态发射 (D6)', () => {
  it('running 于调用前、delta 单次全量、done 于 pushReport 后(事件按序)', async () => {
    const events: Array<{ kind: string; node?: string; status?: string; delta?: string; key?: string }> = [];
    const updater = {
      info: () => {},
      pushReport: (key: string, content: string) => events.push({ kind: 'report', key, delta: content }),
      pushDelta: (node: string, delta: string) => events.push({ kind: 'delta', node, delta }),
      pushStatus: (node: string, status: string) => events.push({ kind: 'status', node, status }),
    };
    const agent = new FundamentalAnalysisExpert(stubLlm() as never, {}, updater);
    await agent.completeExpert('q', 'fundamental_analysis', {
      startMsg: 's', doneMsg: 'd', logLabel: 'l', nodeName: 'fundamental_analysis_expert',
    });
    const seq = events.map((e) => [e.kind, e.node ?? e.key ?? '', e.status ?? '', e.delta ?? ''].filter(Boolean).join(':'));
    expect(seq).toEqual([
      'status:fundamental_analysis_expert:running',
      'delta:fundamental_analysis_expert:ok', // stub 单 chunk → 单次全量 delta
      'report:fundamental_analysis:ok',
      'status:fundamental_analysis_expert:done',
    ]);
  });

  it('spy updater 抛错 → 流式状态降级 no-op(图不中断)', async () => {
    const throwing = {
      info: () => { throw new Error('boom'); },
      pushReport: () => { throw new Error('boom'); },
      pushDelta: () => { throw new Error('boom'); },
      pushStatus: () => { throw new Error('boom'); },
    };
    // 构造即传入抛错 updater:safePush*/pushReport 全部降级,报告仍产出
    const agent = new FundamentalAnalysisExpert(stubLlm() as never, {}, throwing);
    const out = await agent.completeExpert('q', 'fundamental_analysis', {
      startMsg: 's', doneMsg: 'd', logLabel: 'l', nodeName: 'fundamental_analysis_expert',
    });
    expect(out.fundamental_analysis).toBe('ok'); // 报告仍产出
  });
});
