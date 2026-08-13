// /llm-proxy + /tdx-collect 共享实现(proxies.cjs,metro dev + 生产 server.mjs
// 双入口)——C2 SSRF 防线 / W2 body 上限 / W4 采集互斥。fetch/collect 注入点
// 为可选参数(house style 无 mock 框架)。
import { describe, expect, it, vi } from 'vitest';
import proxies from '../app/lib/proxies.cjs';

const {
  handleLlmProxy,
  handleTdxCollect,
  MAX_BODY_BYTES,
  COLLECT_TIMEOUT_MS,
  normalizeBaseUrl,
  isPrivateAddress,
  isPublicHost,
} = proxies;

interface FakeRes {
  headersSent: boolean;
  calls: Array<{ status: number; body: string }>;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: unknown): void;
}
function fakeRes(): FakeRes {
  const calls: Array<{ status: number; body: string }> = [];
  const res = {
    headersSent: false,
    calls,
    writeHead(status: number) {
      res.headersSent = true;
      calls.push({ status, body: '' });
    },
    end(body?: unknown) {
      if (calls.length === 0) calls.push({ status: 200, body: '' });
      calls[calls.length - 1].body = body === undefined ? '' : String(body);
    },
  };
  return res;
}

/** 可迭代请求体 + headers + url(for-await 消费,对齐 Node IncomingMessage)。 */
function fakeReq(body: string, headers: Record<string, string> = {}, url = '/llm-proxy/chat/completions') {
  const chunks = body ? [Buffer.from(body)] : [];
  const it = (async function* () {
    for (const c of chunks) yield c;
  })();
  return { url, headers, [Symbol.asyncIterator]: () => it };
}

function fakeUpstream(status = 200) {
  return {
    status,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    body: null,
  };
}

describe('proxies.cjs /llm-proxy(W2 body 上限)', () => {
  it('body > 64KB → 413,不转发', async () => {
    const res = fakeRes();
    let called = false;
    await handleLlmProxy(fakeReq('x'.repeat(MAX_BODY_BYTES + 1)), res, async () => {
      called = true;
      return fakeUpstream();
    });
    expect(res.calls[0].status).toBe(413);
    expect(JSON.parse(res.calls[0].body)).toHaveProperty('error');
    expect(called).toBe(false);
  });

  it('body 恰好 64KB → 不 413(纯 x 非法 JSON → 502 解析失败路径)', async () => {
    const res = fakeRes();
    await handleLlmProxy(fakeReq('x'.repeat(MAX_BODY_BYTES)), res, async () => fakeUpstream());
    expect(res.calls[0].status).toBe(502);
  });
});

describe('proxies.cjs /llm-proxy(C2 SSRF)', () => {
  it('scheme 非 http(s) → 400,不转发', async () => {
    for (const base of ['ftp://api.deepseek.com/v1', 'javascript:alert(1)', 'file:///etc/passwd', 'ws://x.com']) {
      const res = fakeRes();
      let called = false;
      await handleLlmProxy(
        fakeReq(JSON.stringify({ base, model: 'm' })),
        res,
        async () => {
          called = true;
          return fakeUpstream();
        },
      );
      expect(res.calls[0].status, base).toBe(400);
      expect(called, base).toBe(false);
    }
  });

  it('含 userinfo → 400', async () => {
    const res = fakeRes();
    let called = false;
    await handleLlmProxy(
      fakeReq(JSON.stringify({ base: 'https://user:pass@api.deepseek.com/v1' })),
      res,
      async () => {
        called = true;
        return fakeUpstream();
      },
    );
    expect(res.calls[0].status).toBe(400);
    expect(called).toBe(false);
  });

  it('内网/环回/链路本地 host → 403,不转发(含 DNS 解析后内网)', async () => {
    const bases = [
      'http://127.0.0.1:11434/v1',
      'http://localhost:11434/v1',
      'http://10.0.0.5/v1',
      'http://172.16.0.1/v1',
      'http://172.31.255.255/v1',
      'http://192.168.1.10/v1',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0:8080/v1',
    ];
    for (const base of bases) {
      const res = fakeRes();
      let called = false;
      await handleLlmProxy(
        fakeReq(JSON.stringify({ base, model: 'm' })),
        res,
        async () => {
          called = true;
          return fakeUpstream();
        },
      );
      expect(res.calls[0].status, base).toBe(403);
      expect(called, base).toBe(false);
    }
  });

  it('公网目标放行:X-LLM-Base 头优先于 body.base,转发路径正确,base 不进 payload', async () => {
    const res = fakeRes();
    const targets: string[] = [];
    let sentBody = '';
    await handleLlmProxy(
      fakeReq(JSON.stringify({ base: 'https://1.2.3.4/v1', model: 'm', messages: [] }), {
        'x-llm-base': 'https://8.8.8.8/v1',
      }),
      res,
      async (url: string, init?: unknown) => {
        targets.push(url);
        sentBody = (init as { body?: string } | undefined)?.body ?? '';
        return fakeUpstream();
      },
    );
    expect(res.calls[0].status).toBe(200);
    expect(targets).toEqual(['https://8.8.8.8/v1/chat/completions']);
    expect(JSON.parse(sentBody)).not.toHaveProperty('base');
  });

  it('无头时用 body.base(公网);base 尾斜杠不产生双斜杠', async () => {
    const res = fakeRes();
    const targets: string[] = [];
    await handleLlmProxy(
      fakeReq(JSON.stringify({ base: 'https://8.8.8.8/v1/', model: 'm' })),
      res,
      async (url: string) => {
        targets.push(url);
        return fakeUpstream();
      },
    );
    expect(res.calls[0].status).toBe(200);
    expect(targets).toEqual(['https://8.8.8.8/v1/chat/completions']);
  });
});

describe('proxies.cjs /tdx-collect(W4 互斥)', () => {
  it('无效 ticker → 400(不触网)', async () => {
    const res = fakeRes();
    await handleTdxCollect({ url: '/tdx-collect?ticker=abc' }, res);
    expect(res.calls[0].status).toBe(400);
  });

  it('超时回包后锁保持,后台真正 settle 才释放(不泄漏并发采集)', async () => {
    vi.useFakeTimers();
    try {
      let resolveWork!: (v: unknown) => void;
      const work = new Promise<unknown>((r) => {
        resolveWork = r;
      });
      const okResult = { ticker: '600036', name: '招商银行', bars: [], snapshot: null, f10Text: '', capitalText: '' };

      // 第一发:doCollect 挂起(注入 fake)
      const res1 = fakeRes();
      const p1 = handleTdxCollect({ url: '/tdx-collect?ticker=600036' }, res1, () => work);
      await vi.advanceTimersByTimeAsync(COLLECT_TIMEOUT_MS);
      expect(res1.calls[0].status).toBe(504); // 45s 超时已回包

      // 锁未释放 → 第二发 429(修复前:超时后 finally 已放锁,此处会并发执行)
      const res2 = fakeRes();
      await handleTdxCollect({ url: '/tdx-collect?ticker=600036' }, res2, () => Promise.resolve(okResult));
      expect(res2.calls[0].status).toBe(429);

      // 后台真正 settle → 锁释放 → 第三发可进(200)
      resolveWork(okResult);
      await p1;
      const res3 = fakeRes();
      await handleTdxCollect({ url: '/tdx-collect?ticker=600036' }, res3, () => Promise.resolve(okResult));
      expect(res3.calls[0].status).toBe(200);
      expect(JSON.parse(res3.calls[0].body)).toMatchObject({ ticker: '600036' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('proxies.cjs C2 校验工具', () => {
  it('normalizeBaseUrl:http(s) 通过;其他 scheme/userinfo/空/非法 → null', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1')).toBeInstanceOf(URL);
    expect(normalizeBaseUrl('http://x.com:8080/v1')).toBeInstanceOf(URL);
    for (const bad of [
      'ftp://x.com',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://user:pass@x.com/v1',
      '',
      'not a url',
      undefined,
      null,
      42,
    ]) {
      expect(normalizeBaseUrl(bad as unknown as string), String(bad)).toBeNull();
    }
  });

  it('isPrivateAddress:私网/环回/链路本地/保留段 → true;公网 → false', () => {
    const priv = [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '198.18.0.1',
      '::1',
      'fe80::1',
      'fc00::1',
      'fd12::1',
      '::ffff:127.0.0.1',
    ];
    for (const ip of priv) expect(isPrivateAddress(ip), ip).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false); // 172.32 不在 172.16-31 段
    for (const ip of ['8.8.8.8', '1.1.1.1', '114.114.114.114', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('isPublicHost:localhost → false;公网 IP 字面 → true(不触网)', async () => {
    expect(await isPublicHost(new URL('http://localhost/v1'))).toBe(false);
    expect(await isPublicHost(new URL('https://8.8.8.8/v1'))).toBe(true);
  });
});
