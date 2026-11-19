// Google News RSS 模块单测（fake fetch 注入，house style 无 mock 框架——
// 对齐 web-search.test.ts / yahoo.test.ts 的 handler 路由模式）。
import { describe, expect, it } from 'vitest';
import {
  NEWS_LIMIT,
  NEWS_MAX_AGE_MONTHS,
  filterRecentNews,
  fetchGoogleNews,
  googleNewsUrl,
  makeProxyNewsFetch,
  newsDate,
  newsIntelText,
  newsQueryFor,
  parseGoogleNewsRss,
} from '../src/news/googleNews.ts';

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>"0700.HK" - Google 新聞</title>
<item><title>騰訊第三季經調整純利665億元人幣 - 香港經濟日報</title><link>https://news.google.com/rss/articles/AAA</link><pubDate>Tue, 18 Nov 2026 09:00:00 GMT</pubDate><source url="https://www.hket.com">香港經濟日報</source></item>
<item><title><![CDATA[Nvidia &amp; Tencent tie-up]]></title><link>https://news.google.com/rss/articles/BBB</link><pubDate>Wed, 19 Nov 2026 01:02:03 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
<item><title>   </title><link>https://news.google.com/rss/articles/CCC</link></item>
<item><title>無來源條目</title><link>https://news.google.com/rss/articles/DDD</link><pubDate>not-a-date</pubDate></item>
</channel></rss>`;

function xmlResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe('parseGoogleNewsRss', () => {
  it('解析条目：标题去来源尾缀/CDATA+实体解码/空标题丢弃', () => {
    const items = parseGoogleNewsRss(RSS);
    expect(items).toHaveLength(3); // 空标题条目被丢弃
    expect(items[0]).toEqual({
      title: '騰訊第三季經調整純利665億元人幣', // " - 香港經濟日報" 尾缀剥掉
      link: 'https://news.google.com/rss/articles/AAA',
      published: 'Tue, 18 Nov 2026 09:00:00 GMT',
      source: '香港經濟日報',
    });
    expect(items[1]!.title).toBe('Nvidia & Tencent tie-up'); // CDATA + &amp;
    expect(items[1]!.source).toBe('Reuters');
    expect(items[2]!.title).toBe('無來源條目');
    expect(items[2]!.source).toBe('');
  });

  it('limit 生效；非 RSS/空文本 → []（不抛）', () => {
    expect(parseGoogleNewsRss(RSS, 1)).toHaveLength(1);
    expect(parseGoogleNewsRss('')).toEqual([]);
    expect(parseGoogleNewsRss('<html><body>nope</body></html>')).toEqual([]);
  });

  it('NEWS_LIMIT 为单次情报条数(8)', () => {
    expect(NEWS_LIMIT).toBe(8);
  });
});

describe('filterRecentNews（时效过滤:老文章不进「近期新闻」）', () => {
  const item = (published: string, title: string) => ({ title, link: 'L', published, source: 'S' });
  const NOW = new Date('2026-11-19T00:00:00Z');

  it('超过 18 个月 → 丢弃；近期 → 保留；无日期/不可解析 → 保留', () => {
    const items = [
      item('Mon, 17 Nov 2026 09:00:00 GMT', 'recent'),
      item('Fri, 28 Apr 2017 00:00:00 GMT', 'ancient'),
      item('Wed, 13 May 2020 00:00:00 GMT', 'covid-era'),
      item('', 'no-date'),
      item('garbage', 'bad-date'),
    ];
    const kept = filterRecentNews(items, NOW);
    expect(kept.map((i) => i.title)).toEqual(['recent', 'no-date', 'bad-date']);
  });

  it('阈值可注入（maxAgeMonths）;NEWS_MAX_AGE_MONTHS = 18', () => {
    expect(NEWS_MAX_AGE_MONTHS).toBe(18);
    const items = [item('Mon, 17 Nov 2026 09:00:00 GMT', 'recent'), item('Fri, 28 Apr 2017 00:00:00 GMT', 'old')];
    expect(filterRecentNews(items, NOW, 1).map((i) => i.title)).toEqual(['recent']);
    expect(filterRecentNews(items, NOW, 200).map((i) => i.title)).toEqual(['recent', 'old']);
  });
});

describe('查询串 / URL / 日期', () => {
  it('newsQueryFor：HK 保留 .HK 后缀 + 公司名 OR；US 不拼 .HK', () => {
    expect(newsQueryFor('0700.HK', 'Tencent Holdings Limited'))
      .toBe('"0700.HK" OR "Tencent Holdings Limited"');
    expect(newsQueryFor('0700.HK', null)).toBe('"0700.HK"');
    expect(newsQueryFor('0700.HK', '0700.HK')).toBe('"0700.HK"'); // 名字=代码 → 不重复
    expect(newsQueryFor('AAPL', 'Apple Inc.')).toBe('"AAPL" OR "Apple Inc."');
  });

  it('googleNewsUrl：hk 中文版 / us 英文版 + query 编码', () => {
    const hk = googleNewsUrl('"0700.HK"', 'hk');
    expect(hk).toContain('news.google.com/rss/search?q=');
    expect(hk).toContain('hl=zh-HK');
    expect(hk).toContain('ceid=HK:zh-Hant');
    expect(hk).toContain(encodeURIComponent('"0700.HK"'));
    expect(googleNewsUrl('AAPL', 'us')).toContain('hl=en-US');
  });

  it('newsDate：RFC822 → YYYY-MM-DD；不可解析 → ""（不猜）', () => {
    expect(newsDate('Tue, 18 Nov 2026 09:00:00 GMT')).toBe('2026-11-18');
    expect(newsDate('not-a-date')).toBe('');
    expect(newsDate('')).toBe('');
  });
});

const RSS_WITH_OLD = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>老报道 2017</title><link>L1</link><pubDate>Fri, 28 Apr 2017 00:00:00 GMT</pubDate><source>old</source></item>
<item><title>新报道 A</title><link>L2</link><pubDate>Mon, 17 Nov 2026 09:00:00 GMT</pubDate><source>new</source></item>
<item><title>新报道 B</title><link>L3</link><pubDate>Tue, 18 Nov 2026 09:00:00 GMT</pubDate><source>new</source></item>
</channel></rss>`;

describe('fetchGoogleNews', () => {
  it('默认过滤 18 个月前的条目（limit 在过滤之后应用）', async () => {
    const items = await fetchGoogleNews('"0700.HK"', 'hk', {
      fetchImpl: (async () => xmlResponse(RSS_WITH_OLD)) as unknown as typeof fetch,
      limit: 2,
    });
    expect(items.map((i) => i.title)).toEqual(['新报道 A', '新报道 B']); // 2017 那条被丢,limit 仍给满 2 条
  });

  it('200 → 条目列表；非 2xx → 抛（调用方降级占位）', async () => {
    const ok = await fetchGoogleNews('"0700.HK"', 'hk', {
      fetchImpl: (async () => xmlResponse(RSS)) as unknown as typeof fetch,
    });
    expect(ok).toHaveLength(3);
    await expect(
      fetchGoogleNews('"0700.HK"', 'hk', {
        fetchImpl: (async () => xmlResponse('', 503)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Google News HTTP 503');
  });
});

describe('newsIntelText', () => {
  it('头部带市场标签与条数；每行「日期 标题（来源）」', () => {
    const text = newsIntelText(parseGoogleNewsRss(RSS), '0700.HK', 'hk');
    expect(text).toContain('【近期新闻（港股 0700.HK · Google News，3 条）】');
    expect(text).toContain('- 2026-11-18 騰訊第三季經調整純利665億元人幣（香港經濟日報）');
    expect(text).toContain('- 2026-11-19 Nvidia & Tencent tie-up（Reuters）');
    // 无日期/无来源条目：只留标题（不留空括号/空日期前缀）
    expect(text).toContain('- 無來源條目');
  });

  it('无条目 → 空串（调用方回退占位文本）', () => {
    expect(newsIntelText([], '0700.HK', 'hk')).toBe('');
  });
});

describe('makeProxyNewsFetch（web 同源代理）', () => {
  it('拼 /news-feed?q&market 并解析 {items}；非 2xx → 抛', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ items: parseGoogleNewsRss(RSS, 1) }), { status: 200 });
    }) as unknown as typeof fetch;
    const items = await makeProxyNewsFetch('https://app.example', fetchImpl)('"0700.HK"', 'hk');
    expect(items).toHaveLength(1);
    expect(calls[0]).toContain('https://app.example/news-feed?q=');
    expect(calls[0]).toContain('market=hk');

    const bad = (async () => new Response('', { status: 502 })) as unknown as typeof fetch;
    await expect(makeProxyNewsFetch('https://app.example', bad)('q', 'us')).rejects.toThrow('HTTP 502');
  });
});
