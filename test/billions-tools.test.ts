// 亿信工具三件套测试 —— bills_search / bills_twitter / bills_fetch
// 离线 fake client 注入（house style 无 mock 框架），钉死：
// 开关关/无 key → undefined、调用上限、格式化、失败降级、url 协议校验。
import { beforeEach, describe, expect, it } from 'vitest';
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
import { fromEnv, setCapabilitySwitches } from '../src/switches.ts';

// 能力开关面读 config(getCapabilitySwitches,未注入时 fromEnv 反推 DISABLED
// 键)。用例修改 env 后须同步;beforeEach 从干净 env 反推全开默认态。
function syncSwitches(): void {
  setCapabilitySwitches(fromEnv());
}
beforeEach(() => {
  syncSwitches(); // 全开默认态基线(避免显式注入跨用例残留)
});

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
    syncSwitches();
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

// caps 接线（settings.caps → assembleTools → maxCallsByCap）：注入优先于 env、
// env 优先于默认；非法值（NaN/<=0/非数字）回退；三 cap 独立计数。
describe('调用上限注入（caps 接线）', () => {
  const ENV = {
    SEARCH: 'BILLIONS_SEARCH_MAX_CALLS',
    TWITTER: 'BILLIONS_TWITTER_MAX_CALLS',
    FETCH: 'BILLIONS_FETCH_MAX_CALLS',
  };

  /** 临时覆盖 env（undefined = 删除），返回恢复函数。 */
  function withEnv(patch: Record<string, string | undefined>): () => void {
    const prev: Record<string, string | undefined> = {};
    for (const key of Object.keys(patch)) {
      prev[key] = process.env[key];
      if (patch[key] === undefined) delete process.env[key];
      else process.env[key] = patch[key]!;
    }
    return () => {
      for (const key of Object.keys(prev)) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
    };
  }

  it('caps 注入优先于 env：注入 1 次、env 7 次 → 按 1 次封顶', async () => {
    const restore = withEnv({ [ENV.SEARCH]: '7' });
    try {
      let calls = 0;
      const client = fakeClient({
        search: async () => {
          calls += 1;
          return { result: [{ content: [{ title: 't', link: 'https://x' }] }] };
        },
      });
      const tool = makeBillionsSearchTool({ apiKey: KEY, client, maxCallsByCap: { SEARCH: 1 } })!;
      await tool.invoke({ query: 'q1' });
      const second = await tool.invoke({ query: 'q2' }) as string;
      expect(calls).toBe(1);
      expect(second).toContain('已达本次运行检索上限（1 次）');
    } finally {
      restore();
    }
  });

  it('未注入时 env 覆盖仍生效：env 4 次 → 按 4 次封顶', async () => {
    const restore = withEnv({ [ENV.SEARCH]: '4' });
    try {
      let calls = 0;
      const client = fakeClient({
        search: async () => {
          calls += 1;
          return { result: [{ content: [{ title: 't', link: 'https://x' }] }] };
        },
      });
      const tool = makeBillionsSearchTool({ apiKey: KEY, client })!;
      for (let i = 0; i < 4; i += 1) await tool.invoke({ query: `q${i}` });
      const fifth = await tool.invoke({ query: 'q4' }) as string;
      expect(calls).toBe(4);
      expect(fifth).toContain('已达本次运行检索上限（4 次）');
    } finally {
      restore();
    }
  });

  it('非法值回退：无 env 回默认（0 → 3），有 env 回 env（NaN → 4），负数回默认（-5 → 3）', async () => {
    // 0 且无 env → 默认 SEARCH=3
    const restore1 = withEnv({ [ENV.SEARCH]: undefined });
    try {
      let calls = 0;
      const client = fakeClient({
        search: async () => {
          calls += 1;
          return { result: [{ content: [{ title: 't', link: 'https://x' }] }] };
        },
      });
      const tool = makeBillionsSearchTool({ apiKey: KEY, client, maxCallsByCap: { SEARCH: 0 } })!;
      for (let i = 0; i < 3; i += 1) await tool.invoke({ query: `q${i}` });
      const fourth = await tool.invoke({ query: 'q3' }) as string;
      expect(calls).toBe(3);
      expect(fourth).toContain('已达本次运行检索上限（3 次）');
    } finally {
      restore1();
    }

    // NaN 且有 env=4（默认 TWITTER=2，区分 env 与默认）→ 回退 env 4
    const restore2 = withEnv({ [ENV.TWITTER]: '4' });
    try {
      let calls = 0;
      const client = fakeClient({
        twitterSearch: async () => {
          calls += 1;
          return { result: [{ content: [{ snippet: 't' }] }] };
        },
      });
      const tool = makeBillionsTwitterTool({ apiKey: KEY, client, maxCallsByCap: { TWITTER: NaN } })!;
      for (let i = 0; i < 4; i += 1) await tool.invoke({ query: `q${i}` });
      const fifth = await tool.invoke({ query: 'q4' }) as string;
      expect(calls).toBe(4);
      expect(fifth).toContain('已达本次运行推特检索上限（4 次）');
    } finally {
      restore2();
    }

    // -5 且无 env → 默认 FETCH=3
    const restore3 = withEnv({ [ENV.FETCH]: undefined });
    try {
      let calls = 0;
      const client = fakeClient({
        fetchDoc: async () => {
          calls += 1;
          return { title: 'T', content: 'x' };
        },
      });
      const tool = makeBillionsFetchTool({ apiKey: KEY, client, maxCallsByCap: { FETCH: -5 } })!;
      for (let i = 0; i < 3; i += 1) await tool.invoke({ doc_id: `d${i}` });
      const fourth = await tool.invoke({ doc_id: 'd3' }) as string;
      expect(calls).toBe(3);
      expect(fourth).toContain('已达本次运行全文抓取上限（3 次）');
    } finally {
      restore3();
    }
  });

  it('三 cap 各自生效：makeBillionsTools 注入 1/2/3，独立计数互不干扰', async () => {
    const restore = withEnv({ [ENV.SEARCH]: undefined, [ENV.TWITTER]: undefined, [ENV.FETCH]: undefined });
    try {
      let searchCalls = 0;
      let twitterCalls = 0;
      let fetchCalls = 0;
      const client = fakeClient({
        search: async () => {
          searchCalls += 1;
          return { result: [{ content: [{ title: 't', link: 'https://x' }] }] };
        },
        twitterSearch: async () => {
          twitterCalls += 1;
          return { result: [{ content: [{ snippet: 't' }] }] };
        },
        fetchDoc: async () => {
          fetchCalls += 1;
          return { title: 'T', content: 'x' };
        },
      });
      const tools = makeBillionsTools({
        apiKey: KEY,
        client,
        maxCallsByCap: { SEARCH: 1, TWITTER: 2, FETCH: 3 },
      });
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      // search：第 2 次即封顶（上限 1）
      await byName.billions_search.invoke({ query: 'q' });
      const search2 = await byName.billions_search.invoke({ query: 'q' }) as string;
      expect(searchCalls).toBe(1);
      expect(search2).toContain('已达本次运行检索上限（1 次）');
      // twitter：search 封顶后仍独立计数，第 3 次封顶（上限 2）
      await byName.billions_twitter.invoke({ query: 'q' });
      await byName.billions_twitter.invoke({ query: 'q' });
      const twitter3 = await byName.billions_twitter.invoke({ query: 'q' }) as string;
      expect(twitterCalls).toBe(2);
      expect(twitter3).toContain('已达本次运行推特检索上限（2 次）');
      // fetch：3 次内正常，第 4 次封顶（上限 3）
      for (let i = 0; i < 3; i += 1) await byName.billions_fetch.invoke({ doc_id: `d${i}` });
      const fetch4 = await byName.billions_fetch.invoke({ doc_id: 'd3' }) as string;
      expect(fetchCalls).toBe(3);
      expect(fetch4).toContain('已达本次运行全文抓取上限（3 次）');
    } finally {
      restore();
    }
  });
});
