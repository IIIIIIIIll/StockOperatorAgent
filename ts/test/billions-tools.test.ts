// 亿信工具三件套测试 —— bills_search / bills_twitter / bills_fetch
// 离线 fake client 注入（house style 无 mock 框架），钉死：
// 开关关/无 key → undefined、调用上限、格式化、失败降级、url 协议校验。
import { describe, expect, it } from 'vitest';
import {
  collectContentItems,
  formatFetch,
  formatSearchItem,
  formatTweetItem,
  makeBillionsFetchTool,
  makeBillionsSearchTool,
  makeBillionsTools,
  makeBillionsTwitterTool,
  summarizeSearchResults,
  summarizeTweets,
} from '../src/billionsTools.ts';
import type { BillionsClient } from '../src/billionsClient.ts';

const KEY = 'test-billions-key';

function fakeClient(overrides: Partial<BillionsClient> = {}): BillionsClient {
  return {
    finDb: async () => ({ result: [] }),
    search: async () => ({
      result: [{
        content: [
          { title: '紫金矿业公告', link: 'https://example.com/1', date: '2026-08-01', extra: { doc_id: 'doc1' } },
          { title: '无链接标题', snippet: '只有标题', date: '' },
          { link: 'https://example.com/2', snippet: '只有链接', extra: { institution: '国泰君安' } },
          { title: '', link: '', snippet: '脏条目' }, // 无标题无链接 → 跳过
        ],
      }],
    }),
    twitterSearch: async () => ({
      result: [{
        content: [
          { title: '@trader1: 看多！', snippet: '该股业绩超预期', date: '2026-08-02', extra: { username: 'trader1', view_count: 1234 } },
          { snippet: '无用户名推文', extra: {} },
          { snippet: '', title: '无正文' }, // 无正文 → 跳过
        ],
      }],
    }),
    fetchDoc: async () => ({ title: '公告全文', content: '这是全文内容。'.repeat(200) }),
    ...overrides,
  } as unknown as BillionsClient;
}

describe('collectContentItems', () => {
  it('收集 result[].content[] 的 dict 条目，跳过非 dict 脏条目', () => {
    const data = {
      result: [
        { content: [{ a: 1 }, 'skip', [1], null] },
        'skip-entry',
        { content: [{ b: 2 }] },
      ],
    };
    expect(collectContentItems(data)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('result 缺失 → 空数组', () => {
    expect(collectContentItems({})).toEqual([]);
  });
});

describe('formatSearchItem / summarizeSearchResults', () => {
  it('格式化：标题链接/机构/doc_id/snippet，脏条目跳过', () => {
    const items = [
      { title: '紫金矿业公告', link: 'https://example.com/1', date: '2026-08-01', extra: { doc_id: 'doc1' } },
      { title: '', link: '', snippet: 'x' },
    ];
    expect(formatSearchItem(items[0])).toContain('[紫金矿业公告](https://example.com/1)');
    expect(formatSearchItem(items[0])).toContain('doc_id: doc1');
    expect(formatSearchItem(items[1])).toBeNull();
  });

  it('summarizeSearchResults：无有效条目 → 占位文本', () => {
    expect(summarizeSearchResults({ result: [{ content: [{ title: '', link: '' }] }] }))
      .toBe('（亿信检索失败：无返回结果）');
  });

  it('summarizeSearchResults：有效条目 → 【亿信检索结果】', () => {
    const out = summarizeSearchResults({
      result: [{ content: [{ title: 't', link: 'https://x' }] }],
    });
    expect(out.startsWith('【亿信检索结果】')).toBe(true);
    expect(out).toContain('- [t](https://x)');
  });
});

describe('formatTweetItem / summarizeTweets', () => {
  it('格式化：@username 归一 + 浏览数 + 日期 + 链接', () => {
    const line = formatTweetItem({
      snippet: '正文', date: '2026-08-02', link: 'https://x.com/1', extra: { username: 'trader1', view_count: 99 },
    });
    expect(line).toBe('- @trader1 — 99 次浏览 — 2026-08-02 — 正文 [https://x.com/1]');
  });

  it('title 兜底取 @ 前缀；无正文 → null', () => {
    expect(formatTweetItem({ title: '@user2: 预览', snippet: '正文' })).toContain('@user2');
    expect(formatTweetItem({ snippet: '' })).toBeNull();
  });

  it('summarizeTweets：无有效条目 → 占位', () => {
    expect(summarizeTweets({ result: [{ content: [{ snippet: '' }] }] }))
      .toBe('（亿信推特检索失败：无返回结果）');
  });
});

describe('formatFetch', () => {
  it('标题 + 正文；无正文 → 占位；超长截断', () => {
    expect(formatFetch({ title: 'T', content: 'abc' })).toBe('【亿信网页全文】T\nabc');
    expect(formatFetch({ content: '' })).toBe('（亿信全文抓取失败：无返回内容）');
    const long = formatFetch({ title: 'T', content: 'x'.repeat(4000) });
    expect(long).toContain('（内容过长，已截断至前 3000 字符）');
    expect(long.length).toBeLessThan(4000);
  });
});

describe('makeBillionsSearchTool', () => {
  it('开关关（BILLIONS_DISABLED=1）→ undefined', () => {
    const prev = process.env.BILLIONS_DISABLED;
    process.env.BILLIONS_DISABLED = '1';
    try {
      expect(makeBillionsSearchTool({ apiKey: KEY })).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.BILLIONS_DISABLED;
      else process.env.BILLIONS_DISABLED = prev;
    }
  });

  it('无 key → undefined（主闸）', () => {
    const prev = process.env.BILLIONS_API_KEY;
    delete process.env.BILLIONS_API_KEY;
    try {
      expect(makeBillionsSearchTool()).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.BILLIONS_API_KEY = prev;
    }
  });

  it('成功检索 → 格式化结果；注入 client 直达', async () => {
    const tool = makeBillionsSearchTool({ apiKey: KEY, client: fakeClient() })!;
    expect(tool.name).toBe('billions_search');
    const out = await tool.invoke({ query: '紫金矿业' }) as string;
    expect(out.startsWith('【亿信检索结果】')).toBe(true);
    expect(out).toContain('doc_id: doc1');
    expect(out).not.toContain('脏条目');
  });

  it('调用硬上限：超限 → 占位，不再发请求', async () => {
    let calls = 0;
    const client = fakeClient({
      search: async () => { calls += 1; return { result: [{ content: [{ title: 't', link: 'https://x' }] }] }; },
    });
    const tool = makeBillionsSearchTool({ apiKey: KEY, client, maxCalls: 2 })!;
    await tool.invoke({ query: 'q1' });
    await tool.invoke({ query: 'q2' });
    const third = await tool.invoke({ query: 'q3' }) as string;
    expect(calls).toBe(2);
    expect(third).toContain('已达本次运行检索上限（2 次）');
  });

  it('查询失败 → 占位文本（不 raise）', async () => {
    const client = fakeClient({ search: async () => { throw new Error('上游 500'); } });
    const tool = makeBillionsSearchTool({ apiKey: KEY, client })!;
    const out = await tool.invoke({ query: 'q' }) as string;
    expect(out).toBe('（亿信检索失败：上游 500）');
  });
});

describe('makeBillionsTwitterTool', () => {
  it('成功 → 【亿信推特结果】；无正文条目跳过', async () => {
    const tool = makeBillionsTwitterTool({ apiKey: KEY, client: fakeClient() })!;
    expect(tool.name).toBe('billions_twitter');
    const out = await tool.invoke({ query: '紫金矿业' }) as string;
    expect(out.startsWith('【亿信推特结果】')).toBe(true);
    expect(out).toContain('@trader1');
    expect(out).toContain('1234 次浏览');
    expect(out).not.toContain('无正文');
  });
});

describe('makeBillionsFetchTool', () => {
  it('成功 → 标题 + 正文', async () => {
    const tool = makeBillionsFetchTool({ apiKey: KEY, client: fakeClient() })!;
    expect(tool.name).toBe('billions_fetch');
    const out = await tool.invoke({ doc_id: 'doc1' }) as string;
    expect(out.startsWith('【亿信网页全文】公告全文')).toBe(true);
  });

  it('url 非 http(s) → 协议校验占位，不触达 client', async () => {
    let hit = false;
    const client = fakeClient({ fetchDoc: async () => { hit = true; return {}; } });
    const tool = makeBillionsFetchTool({ apiKey: KEY, client })!;
    const out = await tool.invoke({ url: 'file:///etc/passwd' }) as string;
    expect(out).toContain('url 仅支持 http(s) 协议');
    expect(hit).toBe(false);
  });

  it('抓取失败 → 占位（不 raise）', async () => {
    const client = fakeClient({ fetchDoc: async () => { throw new Error('403 SOURCE_NOT_LICENSED'); } });
    const tool = makeBillionsFetchTool({ apiKey: KEY, client })!;
    const out = await tool.invoke({ doc_id: 'x' }) as string;
    expect(out).toBe('（亿信全文抓取失败：403 SOURCE_NOT_LICENSED）');
  });
});

describe('makeBillionsTools', () => {
  it('三件套按开关过滤；无 key → 空数组', () => {
    const prevKey = process.env.BILLIONS_API_KEY;
    delete process.env.BILLIONS_API_KEY;
    try {
      expect(makeBillionsTools()).toEqual([]);
    } finally {
      if (prevKey !== undefined) process.env.BILLIONS_API_KEY = prevKey;
    }
  });

  it('有 key 且开关开 → 3 个工具', () => {
    const tools = makeBillionsTools({ apiKey: KEY, client: fakeClient() });
    expect(tools.map((t) => t.name)).toEqual(['billions_search', 'billions_twitter', 'billions_fetch']);
  });
});
