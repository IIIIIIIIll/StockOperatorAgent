// C6:webSearch 直连链单请求超时(20s/请求,fetchWithTimeout label 归一文案)。
// fake timers + hanging fetch(yahoo-collect.test.ts 同款模式,house style 无
// mock 框架);makeProxySearcher 不加超时(server race 兜底)一并钉死。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ddgSearcher, defaultSearcher, makeProxySearcher } from '../src/webSearch.ts';

interface RecordedCall {
  url: string;
  signal: AbortSignal | null | undefined;
}

/** 永不 settle 的 fetch:signal 被 abort(超时)时拒绝 —— 模拟挂死的网络;
 *  记录每次调用的 url 与 init.signal。 */
function hangingFetch(respondFirst?: (url: string) => Response): {
  fn: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let n = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    n += 1;
    const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    calls.push({ url: u, signal: init?.signal });
    const canned = respondFirst?.(u);
    if (canned !== undefined && n <= 1) return canned;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('webSearch 直连单请求超时(C6:每请求 20s,非全链)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ddgSearcher html 端点挂起 → 20s abort → 「DuckDuckGo 请求超时(20s)」', async () => {
    vi.useFakeTimers();
    const { fn, calls } = hangingFetch();
    vi.stubGlobal('fetch', fn);
    const p = ddgSearcher('招行业绩');
    const assertion = expect(p).rejects.toMatchObject({
      name: 'YahooApiError',
      code: 'timeout',
      status_code: null,
      message: 'DuckDuckGo 请求超时(20s)',
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(calls[0].signal?.aborted).toBe(true); // 被 abort,非等回调竞速
  });

  it('Tavily(defaultSearcher env 主选)挂起 → 20s abort → 「Tavily 请求超时(20s)」', async () => {
    vi.useFakeTimers();
    const prevKey = process.env.TAVILY_API_KEY;
    const prevExpo = process.env.EXPO_PUBLIC_TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = 'test-key';
    delete process.env.EXPO_PUBLIC_TAVILY_API_KEY; // 直读成员优先级更高,显式清零
    try {
      const { fn } = hangingFetch();
      vi.stubGlobal('fetch', fn);
      const searcher = defaultSearcher(); // node 环境 + key → tavilySearcher
      const p = searcher('招行业绩');
      const assertion = expect(p).rejects.toMatchObject({
        code: 'timeout',
        message: 'Tavily 请求超时(20s)',
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally {
      if (prevKey === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = prevKey;
      if (prevExpo !== undefined) process.env.EXPO_PUBLIC_TAVILY_API_KEY = prevExpo;
    }
  });

  it('html 反爬异常页(无结果)→ news.js 回退:vqd 请求挂起同样 20s 上界', async () => {
    vi.useFakeTimers();
    // 首个请求(html 端点)回无 result__a 的反爬页 → parseDdgHtml 空 → 回退链
    const { fn, calls } = hangingFetch(
      () => new Response('<html><body>anomaly captcha</body></html>', { status: 200 }),
    );
    vi.stubGlobal('fetch', fn);
    const p = ddgSearcher('招行业绩');
    const assertion = expect(p).rejects.toMatchObject({ message: 'DuckDuckGo 请求超时(20s)' });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(calls[1]?.url).toContain('https://duckduckgo.com/?q='); // 第二跳 = fetchVqd
    expect(calls[1].signal?.aborted).toBe(true);
  });

  it('vqd 成功后 news.js JSON 请求挂起 → 同样 20s 上界', async () => {
    vi.useFakeTimers();
    let n = 0;
    const calls: RecordedCall[] = [];
    const fn = (async (url: string | URL | Request, init?: RequestInit) => {
      n += 1;
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      calls.push({ url: u, signal: init?.signal });
      if (n === 1) return new Response('<html><body>anomaly</body></html>', { status: 200 }); // 反爬页 → 回退
      if (n === 2) return new Response('<script>vqd="tok-1";</script>', { status: 200 }); // vqd 命中
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fn);
    const p = ddgSearcher('招行业绩');
    const assertion = expect(p).rejects.toMatchObject({ message: 'DuckDuckGo 请求超时(20s)' });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(calls[2]?.url).toContain('https://duckduckgo.com/news.js'); // 第三跳 = news.js JSON
    expect(calls[2].signal?.aborted).toBe(true);
  });

  it('makeProxySearcher 不加超时(server race 兜底):裸 fetch 无 signal', async () => {
    const inits: Array<RequestInit | undefined> = [];
    const fn = (async (_url: string, init?: RequestInit) => {
      inits.push(init);
      return new Response(JSON.stringify({ results: [{ title: 't', link: 'l', snippet: 's' }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const out = await makeProxySearcher('http://localhost:8090', fn)('招行业绩');
    expect(out).toHaveLength(1);
    expect(inits[0]?.signal).toBeUndefined(); // C6 有意豁免分支钉死:无超时包装
  });
});
