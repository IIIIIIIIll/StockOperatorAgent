import { describe, expect, it } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import {
  ddgSearcher,
  decodeDdgUrl,
  decodeEntities,
  defaultSearcher,
  makeProxySearcher,
  makeWebSearchTool,
  parseDdgHtml,
  stripTags,
} from '../src/webSearch.ts';

const WEB_SEARCH_DESCRIPTION =
  '联网搜索(DuckDuckGo 中文财经源,cn-zh),可验证行业与市场的最新论据(如新闻、公告、政策)。查询失败时返回占位文本。';
const WEB_SEARCH_PARAMETERS = {
  type: 'object',
  properties: { query: { type: 'string', description: '搜索查询词' } },
  required: ['query'],
};

const SAMPLE_HTML = `
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews%3Fid%3D1">招商银行 &amp; 业绩</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=...">净利润 <b>增长 10%</b>，营收创纪录</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://plain.example/2">第二条结果</a>
  </h2>
  <a class="result__snippet" href="...">摘要二</a>
</div>
`;

describe('DDG html 解析(免 key 联网搜索,对齐 Python ddgs)', () => {
  it('提取标题/链接/摘要;实体与标签清理', () => {
    const results = parseDdgHtml(SAMPLE_HTML);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('招商银行 & 业绩'); // &amp; 解码
    expect(results[0].link).toBe('https://example.com/news?id=1'); // uddg 解码
    expect(results[0].snippet).toBe('净利润 增长 10%，营收创纪录'); // <b> 剥离
    expect(results[1].link).toBe('https://plain.example/2');
  });

  it('空 HTML → 空数组', () => {
    expect(parseDdgHtml('<html><body></body></html>')).toHaveLength(0);
    expect(parseDdgHtml('')).toHaveLength(0);
  });

  it('无 snippet 的条目 → 空摘要', () => {
    const html = '<a class="result__a" href="https://x/1">标题</a>';
    expect(parseDdgHtml(html)[0].snippet).toBe('');
  });
});

describe('HTML 工具', () => {
  it('decodeEntities 覆盖常见实体', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;q&quot; &#39;x&#39;')).toBe('a & b <c> "q" \'x\'');
  });

  it('stripTags 剥标签 + 归一空白', () => {
    expect(stripTags('<b>净</b>利<i>润</i>  增长')).toBe('净利润 增长');
    expect(stripTags('<b>净</b> 利 <i>润</i>')).toBe('净 利 润'); // 原文空格保留
  });

  it('decodeDdgUrl 解析 uddg 重定向;普通 URL 原样', () => {
    expect(decodeDdgUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2Fp%3Fx%3D1%26y%3D2')).toBe('https://a.com/p?x=1&y=2');
    expect(decodeDdgUrl('https://plain.example/2')).toBe('https://plain.example/2');
  });
});

describe('makeProxySearcher（同源 /web-search 代理 searcher）', () => {
  it('URL 含 web-search?q= + 编码;{results} 归一化返回', async () => {
    let url = '';
    const fakeFetch = (async (u: string) => {
      url = u;
      return { ok: true, json: async () => ({ results: [{ title: 't', link: 'l', snippet: 's' }] }) };
    }) as unknown as typeof fetch;
    const search = makeProxySearcher('http://localhost:8090', fakeFetch);
    const results = await search('招商银行 最新新闻');
    expect(url).toBe(`http://localhost:8090/web-search?q=${encodeURIComponent('招商银行 最新新闻')}`);
    expect(results).toEqual([{ title: 't', link: 'l', snippet: 's' }]);
  });

  it('非 ok → throw 带 HTTP 状态', async () => {
    const fakeFetch = async () => ({ ok: false, status: 502 }) as Response;
    const search = makeProxySearcher('http://x', fakeFetch);
    await expect(search('q')).rejects.toThrow(/502/);
  });

  it('results 缺失 → throw', async () => {
    const fakeFetch = async () => ({ ok: true, json: async () => ({}) }) as Response;
    const search = makeProxySearcher('http://x', fakeFetch);
    await expect(search('q')).rejects.toThrow(/无返回结果/);
  });

  it('空 results → throw', async () => {
    const fakeFetch = async () => ({ ok: true, json: async () => ({ results: [] }) }) as Response;
    const search = makeProxySearcher('http://x', fakeFetch);
    await expect(search('q')).rejects.toThrow(/无返回结果/);
  });
});

describe('defaultSearcher 惰性(调用时重读 env,非模块级单例)', () => {
  it('env 在两次调用间变化 → 每次调用重读;无 key → ddgSearcher,有 key → 新 Tavily 闭包', () => {
    const saved = {
      EXPO_PUBLIC_TAVILY_API_KEY: process.env.EXPO_PUBLIC_TAVILY_API_KEY,
      TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    };
    try {
      delete process.env.EXPO_PUBLIC_TAVILY_API_KEY;
      delete process.env.TAVILY_API_KEY;
      const ddg = defaultSearcher();
      expect(ddg).toBe(ddgSearcher); // 无 key → 免 key 兜底(模块函数恒等)

      process.env.TAVILY_API_KEY = 'k1';
      const tavily1 = defaultSearcher();
      expect(tavily1).not.toBe(ddg); // 有 key → Tavily 路径

      process.env.TAVILY_API_KEY = 'k2';
      const tavily2 = defaultSearcher();
      expect(tavily2).not.toBe(tavily1); // 每次调用重新构造闭包(惰性,无模块级缓存)
    } finally {
      if (saved.EXPO_PUBLIC_TAVILY_API_KEY === undefined) delete process.env.EXPO_PUBLIC_TAVILY_API_KEY;
      else process.env.EXPO_PUBLIC_TAVILY_API_KEY = saved.EXPO_PUBLIC_TAVILY_API_KEY;
      if (saved.TAVILY_API_KEY === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = saved.TAVILY_API_KEY;
    }
  });
});

describe('web_search 工具 schema 序列化（AC1：bindTools 请求体 OpenAI function 形态）', () => {
  it('makeWebSearchTool 自带 description/schema（离线形状契约）', () => {
    const tool = makeWebSearchTool();
    expect(tool.name).toBe('web_search');
    expect(tool.description).toBe(WEB_SEARCH_DESCRIPTION);
    expect(tool.schema).toEqual(WEB_SEARCH_PARAMETERS);
  });

  it('ChatOpenAI.bindTools 请求体 tools[0] = {type:function,...}（不再缺 type 字段）', async () => {
    let body: unknown = null;
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: 'test-model',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const llm = new ChatOpenAI({
      model: 'test-model',
      apiKey: 'k',
      configuration: { baseURL: 'https://llm.test/v1', fetch: fakeFetch },
    });
    const bound = llm.bindTools([makeWebSearchTool()]);
    await bound.invoke([new HumanMessage('hi')]);

    expect(body).not.toBeNull();
    const tools =
      body && typeof body === 'object' && 'tools' in body && Array.isArray(body.tools) ? body.tools : undefined;
    if (!tools) throw new Error('请求体缺少 tools 字段');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'web_search',
        description: WEB_SEARCH_DESCRIPTION,
        parameters: WEB_SEARCH_PARAMETERS,
      },
    });
  });
});
