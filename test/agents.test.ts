import { describe, expect, it } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import { BillionsInformationAnalyst, BullishTrader, FundamentalAnalysisExpert, type CompleteOptions } from '../src/agents.ts';
import { BillionsApiError, BillionsClient, type SearchOptions } from '../src/billionsClient.ts';
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
// WEB_SEARCH_DISABLED 未显式给出 → 删除（web 默认开），防开发者本机残留；
// BILLIONS_DISABLED 未显式给出 → '1'（亿信预抓关，web 回退语义基线不变），
// 显式 undefined 开启亿信路径；BILLIONS_API_KEY 默认删除（懒加载真 client
// 时主闸确定性关）。
async function runAnalyst(
  searcher: (q: string) => Promise<SearchResult[]>,
  env: Record<string, string | undefined>,
  client?: BillionsClient,
): Promise<{ query: string; calls: string[] }> {
  const saved: Record<string, string | undefined> = {};
  const keys = ['WEB_SEARCH_DISABLED', 'BILLIONS_DISABLED', 'BILLIONS_API_KEY', ...Object.keys(env)]; // 重复 key 幂等,restore 以对象去重
  for (const k of keys) {
    saved[k] = process.env[k];
    const v = k in env ? env[k] : k === 'BILLIONS_DISABLED' ? '1' : undefined;
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const calls: string[] = [];
    const fake = async (q: string) => {
      calls.push(q);
      return searcher(q);
    };
    const analyst = new CapturingAnalyst(stubLlm() as never, {}, null, fake, client);
    await analyst.information_analyst({ target_stock_ticker: '600036', stock_information: 'dummy info' });
    return { query: analyst.captured ?? '', calls };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** 亿信 fake client（house style 无 mock 框架）：记录调用 + hasApiKey 主闸
 *  通过；缺省 handler 返回空 result（无有效条目）。 */
function makeFakeBillionsClient(handlers: {
  search?: (query: string, opts?: SearchOptions) => Promise<Record<string, unknown>>;
  twitterSearch?: (query: string, opts?: SearchOptions) => Promise<Record<string, unknown>>;
}): {
  client: BillionsClient;
  calls: Array<{ method: 'search' | 'twitterSearch'; query: string; opts?: SearchOptions }>;
} {
  const calls: Array<{ method: 'search' | 'twitterSearch'; query: string; opts?: SearchOptions }> = [];
  const client = {
    hasApiKey: true,
    search: async (query: string, opts?: SearchOptions) => {
      calls.push({ method: 'search', query, opts });
      if (handlers.search) return handlers.search(query, opts);
      return { result: [] };
    },
    twitterSearch: async (query: string, opts?: SearchOptions) => {
      calls.push({ method: 'twitterSearch', query, opts });
      if (handlers.twitterSearch) return handlers.twitterSearch(query, opts);
      return { result: [] };
    },
  } as unknown as BillionsClient;
  return { client, calls };
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

describe('BillionsInformationAnalyst 亿信预抓（R1/R2,离线注入 fake client）', () => {
  it('SEARCH+TWITTER 开 → 三源 + twitter 顺序预抓;真实素材分节进 context;web 不触发', async () => {
    const { client, calls: clientCalls } = makeFakeBillionsClient({
      search: async (query, opts) => ({
        result: [{ content: [{ title: `结果-${opts?.source}`, link: `https://e.example/${opts?.source}`, snippet: '摘要', date: '2026-08-01' }] }],
      }),
      twitterSearch: async () => ({
        result: [{ content: [{ title: '@trader: 讨论', link: 'https://x.com/trader/1', snippet: '市场情绪转暖', date: '2026-08-02', extra: { username: 'trader', view_count: 128 } }] }],
      }),
    });
    const { query, calls: webCalls } = await runAnalyst(
      async () => [{ title: 'x', link: 'y', snippet: 'z' }],
      { BILLIONS_DISABLED: undefined, WEB_SEARCH_DISABLED: '1' },
      client,
    );
    // 固定查询词 + 顺序（三源 → twitter）
    expect(clientCalls.map((c) => [c.method, c.query])).toEqual([
      ['search', '600036 公告'],
      ['search', '600036 券商研报'],
      ['search', '600036 最新新闻'],
      ['twitterSearch', '600036 最新市场讨论'],
    ]);
    // 搜索参数：逐源 source + fast + count 10 + time_range；twitter 无 time_range
    expect(clientCalls[0].opts).toMatchObject({ source: 'announcement', searchMode: 'fast', count: 10, timeRange: 'past 3 months' });
    expect(clientCalls[2].opts).toMatchObject({ source: 'web' });
    expect(clientCalls[3].opts).toEqual({ searchMode: 'fast', count: 10 });
    // 亿信有真实素材 → 不触发 web 回退
    expect(webCalls).toEqual([]);
    // 分节标记 + 条目 Markdown 进 context
    expect(query).toContain('【公告检索结果】');
    expect(query).toContain('【研报检索结果】');
    expect(query).toContain('【新闻检索结果】');
    expect(query).toContain('【推特检索结果】');
    expect(query).toContain('[结果-announcement](https://e.example/announcement)');
    expect(query).toContain('@trader — 128 次浏览 — 2026-08-02 — 市场情绪转暖 [https://x.com/trader/1]');
    expect(query).toContain('检索到的信息面素材');
  });

  it('SEARCH 关 + TWITTER 开 → 仅 twitter 节', async () => {
    const { client, calls: clientCalls } = makeFakeBillionsClient({
      twitterSearch: async () => ({ result: [{ content: [{ title: '@u: 推文', snippet: '正文', extra: { username: 'u' } }] }] }),
    });
    const { query, calls: webCalls } = await runAnalyst(
      async () => [{ title: 'x', link: 'y', snippet: 'z' }],
      { BILLIONS_DISABLED: undefined, BILLIONS_SEARCH_DISABLED: '1', WEB_SEARCH_DISABLED: '1' },
      client,
    );
    expect(clientCalls.map((c) => c.method)).toEqual(['twitterSearch']);
    expect(webCalls).toEqual([]);
    expect(query).toContain('【推特检索结果】');
    expect(query).toContain('- @u — 正文');
  });

  it('亿信全失败 + web 关 → 失败注明分节进 context（不 raise）', async () => {
    const { client, calls: clientCalls } = makeFakeBillionsClient({
      search: async () => { throw new BillionsApiError('亿信 API 错误：HTTP 500（SERVER_ERROR）', 'SERVER_ERROR', 500); },
      twitterSearch: async () => { throw new BillionsApiError('亿信 API 业务失败：success=false', 'success=false', 200); },
    });
    const { query, calls: webCalls } = await runAnalyst(
      async () => { throw new Error('不应调用 web'); },
      { BILLIONS_DISABLED: undefined, WEB_SEARCH_DISABLED: '1' },
      client,
    );
    expect(clientCalls).toHaveLength(4);
    expect(webCalls).toEqual([]);
    expect(query).toContain('【公告检索失败】亿信 API 错误：HTTP 500（SERVER_ERROR）');
    expect(query).toContain('【推特检索失败】亿信 API 业务失败：success=false');
    expect(query).toContain('检索到的信息面素材');
  });

  it('亿信无素材 + web 回退成功 → 联网搜索结果节（亿信优先、web 兜底）', async () => {
    const { client } = makeFakeBillionsClient({
      search: async () => { throw new BillionsApiError('亿信 API 请求失败：fetch failed'); },
    });
    const { query, calls } = await runAnalyst(
      async () => [{ title: '招商银行最新动态', link: 'https://example.com/news', snippet: '净利润增长 10%' }],
      { BILLIONS_DISABLED: undefined },
      client,
    );
    expect(calls).toEqual(['600036 最新新闻']); // web 兜底固定 1 次
    expect(query).toContain('【联网搜索结果】');
    expect(query).toContain('标题：招商银行最新动态');
  });

  it('亿信失败 + web 回退也失败（双失败）→ 固定回退文本逐字保留', async () => {
    const { client } = makeFakeBillionsClient({
      search: async () => { throw new BillionsApiError('亿信 API 请求失败：fetch failed'); },
    });
    const { query, calls } = await runAnalyst(
      async () => { throw new Error('ddgs 反爬拦截'); },
      { BILLIONS_DISABLED: undefined },
      client,
    );
    expect(calls).toEqual(['600036 最新新闻']);
    expect(query).toContain('（本次运行未检索到任何信息面素材：所有来源均不可用或未启用）');
  });

  it('门控开但无 API key → 亿信路径静默关闭（零请求）,web 兜底（主闸对齐 Python）', async () => {
    const { query, calls } = await runAnalyst(
      async () => [{ title: 't', link: 'l', snippet: 's' }],
      { BILLIONS_DISABLED: undefined }, // 门控开;但懒加载真 client 无 key
    );
    expect(calls).toEqual(['600036 最新新闻']);
    expect(query).toContain('【联网搜索结果】');
    expect(query).not.toContain('检索失败');
  });

  it('亿信检索成功但无有效条目 → 无返回结果注明（不算真实素材）', async () => {
    const { client } = makeFakeBillionsClient({
      search: async () => ({ result: [{ content: [] }] }),
      twitterSearch: async () => ({ result: [] }),
    });
    const { query, calls } = await runAnalyst(
      async () => [{ title: 'web 兜底', link: 'https://w', snippet: 's' }],
      { BILLIONS_DISABLED: undefined },
      client,
    );
    expect(calls).toEqual(['600036 最新新闻']); // 注明不算真实素材 → web 兜底
    expect(query).toContain('【公告无返回结果】');
    expect(query).toContain('【推特无返回结果】');
    expect(query).toContain('【联网搜索结果】');
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
