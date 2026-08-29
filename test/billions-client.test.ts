// 亿信客户端离线测试（08-13-ts-capability-completion R1/R6——对齐 Python
// client.py 语义：错误归一化三分支 + 超时档位 + 密钥纪律）。house style 无
// mock 框架：fake fetch 注入（对齐 Python `_http` 注入点）；零网络契约。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  BillionsApiError,
  BillionsClient,
  BILLIONS_BASE,
  makeProxyBillionsFetch,
  type FetchLike,
} from '../src/billionsClient.ts';

interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

interface FakeResponseSpec {
  status: number;
  body?: unknown;
  jsonThrows?: boolean;
}

/** fake fetch：记录请求；按 handler 返回真实 Response（离线零网络契约）。 */
function makeFakeFetch(
  handler: (url: string, init?: RequestInit) => FakeResponseSpec,
): { fake: FetchLike; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const spec = handler(url, init);
    if (spec.jsonThrows) return new Response('<invalid json>', { status: spec.status });
    return new Response(spec.body === undefined ? '' : JSON.stringify(spec.body), {
      status: spec.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as FetchLike;
  return { fake, calls };
}

/** 捕获 AbortSignal.timeout 毫秒值（断言超时档位）；finally 恢复。 */
function captureTimeoutMs(): { captured: number[]; restore(): void } {
  const captured: number[] = [];
  const original = AbortSignal.timeout;
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    captured.push(ms);
    return original.call(AbortSignal, ms);
  };
  return {
    captured,
    restore: () => {
      (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = original;
    },
  };
}

describe('BillionsClient 成功路径（2xx + success:true → 返回 body 原样）', () => {
  it('请求形状：POST + JSON 头 + X-API-KEY + payload（search 全参）', async () => {
    const { fake, calls } = makeFakeFetch(() => ({ status: 200, body: { success: true, result: [{ content: [] }] } }));
    const client = new BillionsClient({ fetch: fake, apiKey: 'secret-key' });
    const data = await client.search('紫金矿业 2024 年报', {
      source: 'report', searchMode: 'expert', count: 5, timeRange: 'past 3 months',
    });
    expect(data).toEqual({ success: true, result: [{ content: [] }] }); // 响应 JSON dict 原样
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLIONS_BASE}/v2/search`);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-API-KEY': 'secret-key' });
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      query: '紫金矿业 2024 年报', source: 'report', search_mode: 'expert', count: 5, time_range: 'past 3 months',
    });
  });

  it('fin_db payload：data_sources 缺省 auto；显式覆盖', async () => {
    const { fake, calls } = makeFakeFetch(() => ({ status: 200, body: { success: true } }));
    const client = new BillionsClient({ fetch: fake });
    await client.finDb('紫金矿业2024年12月20日当日的最高价(元)是多少？');
    await client.finDb('q', 'A股财务行情数据库');
    expect(calls[0].url).toBe(`${BILLIONS_BASE}/v1/fin_db`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ query: '紫金矿业2024年12月20日当日的最高价(元)是多少？', data_sources: 'auto' });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ query: 'q', data_sources: 'A股财务行情数据库' });
  });

  it('search 缺省参数：source web / search_mode fast / count 10；timeRange 缺省不传', async () => {
    const { fake, calls } = makeFakeFetch(() => ({ status: 200, body: { success: true } }));
    const client = new BillionsClient({ fetch: fake });
    await client.search('q');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ query: 'q', source: 'web', search_mode: 'fast', count: 10 });
  });

  it('twitter payload：{query, search_mode, count}（无 time_range）', async () => {
    const { fake, calls } = makeFakeFetch(() => ({ status: 200, body: { success: true } }));
    const client = new BillionsClient({ fetch: fake });
    await client.twitterSearch('600036 最新市场讨论', { searchMode: 'advanced', count: 10 });
    expect(calls[0].url).toBe(`${BILLIONS_BASE}/v2/twitter/search`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ query: '600036 最新市场讨论', search_mode: 'advanced', count: 10 });
  });

  it('fetchDoc：只传非空字段；全空 → 空 payload', async () => {
    const { fake, calls } = makeFakeFetch(() => ({ status: 200, body: { success: true, content: '正文' } }));
    const client = new BillionsClient({ fetch: fake });
    await client.fetchDoc({ url: 'https://example.com/a', page: 2, maxChars: 6000 });
    await client.fetchDoc({ docId: 'd-1' });
    await client.fetchDoc({});
    expect(calls[0].url).toBe(`${BILLIONS_BASE}/v2/fetch`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ url: 'https://example.com/a', page: 2, max_chars: 6000 });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ doc_id: 'd-1' });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({});
  });
});

describe('BillionsClient 错误归一化（BillionsApiError）', () => {
  it('HTTP 非 2xx → statusCode + body error 作 code', async () => {
    const { fake } = makeFakeFetch(() => ({ status: 500, body: { error: 'SERVER_ERROR', code: 'SERVER_ERROR' } }));
    const client = new BillionsClient({ fetch: fake });
    await expect(client.search('q')).rejects.toBeInstanceOf(BillionsApiError);
    await expect(client.search('q')).rejects.toMatchObject({ statusCode: 500, code: 'SERVER_ERROR' });
    await expect(client.search('q')).rejects.toThrow('亿信 API 错误：HTTP 500（SERVER_ERROR）');
  });

  it('HTTP 非 2xx + body 仅 code → code 兜底；非 JSON body → code=null', async () => {
    const { fake } = makeFakeFetch(() => ({ status: 404, body: { code: 'NOT_FOUND' } }));
    const client = new BillionsClient({ fetch: fake });
    await expect(client.finDb('q')).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });

    const { fake: fakeBad } = makeFakeFetch(() => ({ status: 500, jsonThrows: true }));
    const clientBad = new BillionsClient({ fetch: fakeBad });
    await expect(clientBad.finDb('q')).rejects.toMatchObject({ statusCode: 500, code: null });
    await expect(clientBad.finDb('q')).rejects.toThrow('亿信 API 错误：HTTP 500');
  });

  it('200 + success:false → 业务失败归一化（code=body.error）', async () => {
    const { fake } = makeFakeFetch(() => ({ status: 200, body: { success: false, error: '上游超时' } }));
    const client = new BillionsClient({ fetch: fake });
    await expect(client.twitterSearch('q')).rejects.toMatchObject({ statusCode: 200, code: '上游超时' });
    await expect(client.twitterSearch('q')).rejects.toThrow('亿信 API 业务失败：上游超时');
  });

  it('200 + 非 dict body（数组/字符串/null）→ 业务失败 success=false', async () => {
    for (const body of [[1, 2], 'plain', null]) {
      const { fake } = makeFakeFetch(() => ({ status: 200, body }));
      const client = new BillionsClient({ fetch: fake });
      await expect(client.finDb('q')).rejects.toMatchObject({ statusCode: 200, code: null });
      await expect(client.finDb('q')).rejects.toThrow('亿信 API 业务失败：success=false');
    }
  });

  it('fetch reject（网络/超时异常）→ BillionsApiError statusCode=null、code=null', async () => {
    const fake = (async () => { throw new TypeError('fetch failed'); }) as unknown as FetchLike;
    const client = new BillionsClient({ fetch: fake });
    await expect(client.search('q')).rejects.toBeInstanceOf(BillionsApiError);
    await expect(client.search('q')).rejects.toMatchObject({ statusCode: null, code: null });
    await expect(client.search('q')).rejects.toThrow('亿信 API 请求失败：fetch failed');
  });

  it('不重试：网络异常只发 1 次请求', async () => {
    let attempts = 0;
    const fake = (async () => { attempts += 1; throw new TypeError('boom'); }) as unknown as FetchLike;
    const client = new BillionsClient({ fetch: fake });
    await expect(client.search('q')).rejects.toBeInstanceOf(BillionsApiError);
    expect(attempts).toBe(1);
  });
});

describe('超时档位（AbortSignal.timeout 捕获断言）', () => {
  it('search fast/advanced/expert → 25s/70s/120s；未知档位回退 fast', async () => {
    const { captured, restore } = captureTimeoutMs();
    try {
      const { fake } = makeFakeFetch(() => ({ status: 200, body: { success: true } }));
      const client = new BillionsClient({ fetch: fake, apiKey: 'k' });
      await client.search('q', { searchMode: 'fast' });
      await client.search('q', { searchMode: 'advanced' });
      await client.search('q', { searchMode: 'expert' });
      await client.search('q', { searchMode: 'unknown-mode' });
      expect(captured).toEqual([25_000, 70_000, 120_000, 25_000]);
    } finally {
      restore();
    }
  });

  it('twitter 同档位；fin_db 120s；fetchDoc 90s', async () => {
    const { captured, restore } = captureTimeoutMs();
    try {
      const { fake } = makeFakeFetch(() => ({ status: 200, body: { success: true } }));
      const client = new BillionsClient({ fetch: fake });
      await client.twitterSearch('q', { searchMode: 'advanced' });
      await client.finDb('q');
      await client.fetchDoc({ docId: 'x' });
      expect(captured).toEqual([70_000, 120_000, 90_000]);
    } finally {
      restore();
    }
  });
});

describe('密钥纪律（R6：X-API-KEY 头 + 不 log）', () => {
  it('apiKey 注入 → X-API-KEY 头；缺省读 env BILLIONS_API_KEY；注入覆盖 env；皆无 → 无头', async () => {
    const saved = process.env.BILLIONS_API_KEY;
    try {
      process.env.BILLIONS_API_KEY = 'env-key';
      const { fake, calls } = makeFakeFetch(() => ({ status: 200, body: { success: true } }));
      const fromEnv = new BillionsClient({ fetch: fake });
      await fromEnv.search('q1');
      expect(calls[0].init?.headers).toMatchObject({ 'X-API-KEY': 'env-key' });

      const injected = new BillionsClient({ fetch: fake, apiKey: 'injected-key' });
      await injected.search('q2');
      expect(calls[1].init?.headers).toMatchObject({ 'X-API-KEY': 'injected-key' });

      delete process.env.BILLIONS_API_KEY;
      const none = new BillionsClient({ fetch: fake });
      await none.search('q3');
      const headers = calls[2].init?.headers as Record<string, string>;
      expect(headers['X-API-KEY']).toBeUndefined();
      expect(headers['Content-Type']).toBe('application/json');
    } finally {
      if (saved === undefined) delete process.env.BILLIONS_API_KEY;
      else process.env.BILLIONS_API_KEY = saved;
    }
  });

  it('成功与失败路径均不输出密钥（console spy）+ 源文件零 console/log 调用（静态 grep）', async () => {
    const KEY = 'top-secret-billions-key-42';
    const { fake, calls } = makeFakeFetch((_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      return body.query === 'boom'
        ? { status: 500, body: { error: 'SERVER_ERROR' } }
        : { status: 200, body: { success: true } };
    });
    const client = new BillionsClient({ fetch: fake, apiKey: KEY });
    const outputs: string[] = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...a: unknown[]) => { outputs.push(a.map(String).join(' ')); };
    console.warn = (...a: unknown[]) => { outputs.push(a.map(String).join(' ')); };
    console.error = (...a: unknown[]) => { outputs.push(a.map(String).join(' ')); };
    try {
      await client.search('q');
      await client.twitterSearch('q2');
      await client.fetchDoc({ docId: 'x' });
      await expect(client.search('boom')).rejects.toBeInstanceOf(BillionsApiError); // 失败路径
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
    }
    expect(calls.every((c) => (c.init?.headers as Record<string, string>)['X-API-KEY'] === KEY)).toBe(true);
    expect(outputs.join('\n')).not.toContain(KEY);
    // 静态 grep：客户端模块零 console/log 出口（统一日志纪律——密钥不落日志）
    const src = fs.readFileSync(new URL('../src/billionsClient.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/\blog\(/);
  });
});

describe('F1 fetch 绑定（Chrome Illegal invocation 回归）', () => {
  it('缺省 fetch 经裸调用包装：globalThis.fetch 的 this === undefined（浏览器不抛 Illegal invocation）', async () => {
    const original = globalThis.fetch;
    let capturedThis: unknown = 'unset';
    // 常规函数捕获调用方 this(裸调用 → ESM 严格模式 undefined)
    const fake = function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      capturedThis = this;
      return Promise.resolve(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    globalThis.fetch = fake as unknown as typeof fetch;
    try {
      // 不注入 opts.fetch → 走构造器裸调用包装(this._fetch(...) 方法调用,
      // 箭头函数无 this 依赖,内部以 globalThis.fetch(...) 裸调用)
      const client = new BillionsClient({ apiKey: 'k', baseUrl: 'https://example.com' });
      await client.search('q');
      expect(capturedThis).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('makeProxyBillionsFetch(F5 web 亿信 CORS 同源代理)', () => {
  it('URL 改写为同源 /billions-proxy + path/search 保留;白名单头透传,其余过滤', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const proxied = makeProxyBillionsFetch('https://app.example.com');
      await proxied('https://openapi.billionsintelligence.com/api/v2/search?src=web', {
        method: 'POST',
        headers: {
          'x-api-key': 'k123',
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
        body: '{"q":"x"}',
      });
      const [c] = calls;
      expect(c.url).toBe('https://app.example.com/billions-proxy/api/v2/search?src=web');
      const h = c.init?.headers as Record<string, string>;
      expect(h['x-api-key']).toBe('k123');
      expect(h['content-type']).toBe('application/json');
      expect(h['authorization']).toBeUndefined();
      expect(c.init?.body).toBe('{"q":"x"}');
      expect(c.init?.method).toBe('POST');
    } finally {
      globalThis.fetch = orig;
    }
  });
});
