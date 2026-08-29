// /llm-proxy + /tdx-collect 共享实现(proxies.cjs,metro dev + 生产 server.mjs
// 双入口)——C2 SSRF 防线 / W2 body 上限 / W4 采集互斥。fetch/collect 注入点
// 为可选参数(house style 无 mock 框架)。
import { describe, expect, it, vi } from 'vitest';
import proxies from '../app/lib/proxies.cjs';
import { yahooMarketOfTicker } from '../src/yahoo/webYahooCollect.ts';

const {
  handleLlmProxy,
  handleTdxCollect,
  handleYahooCollect,
  MAX_BODY_BYTES,
  COLLECT_TIMEOUT_MS,
  normalizeBaseUrl,
  isPrivateAddress,
  isPublicHost,
  isYahooMarket,
} = proxies;

interface FakeRes {
  headersSent: boolean;
  calls: Array<{ status: number; body: string; headers?: Record<string, string> }>;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: unknown): void;
}
function fakeRes(): FakeRes {
  const calls: Array<{ status: number; body: string; headers?: Record<string, string> }> = [];
  const res = {
    headersSent: false,
    calls,
    writeHead(status: number, headers?: Record<string, string>) {
      res.headersSent = true;
      calls.push(headers ? { status, body: '', headers } : { status, body: '' });
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

/** F02:两段式请求体——cutAt 为字节偏移,可从多字节字符中间切开(模拟 TCP 分包)。 */
function fakeReqSplit(body: string, cutAt: number, headers: Record<string, string> = {}, url = '/llm-proxy/chat/completions') {
  const buf = Buffer.from(body, 'utf8');
  const chunks = [buf.subarray(0, cutAt), buf.subarray(cutAt)];
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
  it('body > 1MB → 413,不转发', async () => {
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

  it('body 恰好 1MB → 不 413(纯 x 非法 JSON → 502 解析失败路径)', async () => {
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

  it('F02 两段式请求体:CJK 多字节字符跨块边界 → 转发内容完整(逐块拼接会乱码)', async () => {
    const res = fakeRes();
    const content = '分析 你好世界 股票走势';
    const body = JSON.stringify({ base: 'https://8.8.8.8/v1', messages: [{ role: 'user', content }] });
    // 从「好」的第二字节切开:UTF-8 单字 3 字节,indexOf 是字符下标,前缀字节数
    // 即「好」首字节偏移,+1 落到其中间
    const cutAt = Buffer.byteLength(body.slice(0, body.indexOf('好'))) + 1;
    let sentBody = '';
    await handleLlmProxy(
      fakeReqSplit(body, cutAt),
      res,
      async (_url: string, init?: unknown) => {
        sentBody = (init as { body?: string } | undefined)?.body ?? '';
        return fakeUpstream();
      },
    );
    expect(res.calls[0].status).toBe(200);
    const forwarded = JSON.parse(sentBody) as { messages: Array<{ content: string }> };
    expect(forwarded.messages[0].content).toBe(content); // CJK 完整往返
  });

  it('S3:重定向目标内网(302 → 127.0.0.1)→ 502 拒发,不跟随', async () => {
    const res = fakeRes();
    const targets: string[] = [];
    await handleLlmProxy(
      fakeReq(JSON.stringify({ base: 'https://8.8.8.8/v1', model: 'm' })),
      res,
      async (url: string) => {
        targets.push(url);
        return {
          status: 302,
          headers: { get: (name: string) => (name === 'location' ? 'http://127.0.0.1:11434/v1/chat' : null) },
          body: null,
        } as Response;
      },
    );
    expect(res.calls[0].status).toBe(502);
    expect(res.calls[0].body).toContain('重定向目标被拒');
    expect(targets).toHaveLength(1); // 未跟随到内网
  });

  it('M2:3xx → redirect:manual + 公网目标手动跟随(单跳,302 → 200)', async () => {
    const res = fakeRes();
    const redirects: Array<string | undefined> = [];
    let calls = 0;
    await handleLlmProxy(
      fakeReq(JSON.stringify({ base: 'https://8.8.8.8/v1', model: 'm' })),
      res,
      async (url: string, init?: unknown) => {
        calls += 1;
        const initObj = init as { redirect?: string } | undefined;
        redirects.push(initObj?.redirect);
        if (calls === 1) {
          return {
            status: 302,
            headers: { get: (name: string) => (name === 'location' ? 'https://9.9.9.9/v1/chat' : null) },
            body: null,
          } as Response;
        }
        return fakeUpstream();
      },
    );
    expect(res.calls[0].status).toBe(200);
    expect(calls).toBe(2);
    expect(redirects).toEqual(['manual', 'manual']); // 每跳都禁自动跟随
  });

  it('M2 补漏:重定向断链(缺 Location/Location 非法/非 http(s))→ 502 JSON,不透传 3xx', async () => {
    const cases: Array<[string, string | null]> = [
      ['缺 Location', null],
      ['Location 非法', 'http://[::1'],
      ['非 http(s) 协议', 'ftp://8.8.8.8/v1/chat'],
    ];
    for (const [name, location] of cases) {
      const res = fakeRes();
      let calls = 0;
      await handleLlmProxy(
        fakeReq(JSON.stringify({ base: 'https://8.8.8.8/v1', model: 'm' })),
        res,
        async () => {
          calls += 1;
          return {
            status: 302,
            headers: { get: (h: string) => (h === 'location' ? location : null) },
            body: null,
          } as Response;
        },
      );
      expect(res.calls[0].status, name).toBe(502);
      expect(JSON.parse(res.calls[0].body), name).toHaveProperty('error.message');
      expect(calls, name).toBe(1); // 未跟随
    }
  });

  it('M2 补漏:超 5 跳 → 502 JSON(不再透传无 Location 的 3xx 后 destroy 半截响应)', async () => {
    const res = fakeRes();
    let calls = 0;
    await handleLlmProxy(
      fakeReq(JSON.stringify({ base: 'https://8.8.8.8/v1', model: 'm' })),
      res,
      async () => {
        calls += 1;
        return {
          status: 302,
          headers: { get: (h: string) => (h === 'location' ? 'https://8.8.8.8/v1/chat' : null) },
          body: null,
        } as Response;
      },
    );
    expect(res.calls[0].status).toBe(502);
    expect(res.calls[0].body).toContain('超 5 跳');
    expect(calls).toBe(6); // 初始 + 5 跳后仍 302,第 6 次进循环判 hops>=5 拒发
  });

  it('S6:X-SOA-Token 不随转发携带(forwardOpts 白名单仅 Content-Type/Authorization,不泄漏给 LLM 上游)', async () => {
    const res = fakeRes();
    let sentInit: { headers?: Record<string, string> } | undefined;
    await handleLlmProxy(
      fakeReq(JSON.stringify({ base: 'https://8.8.8.8/v1', model: 'm' }), {
        'x-soa-token': 'soa-gate-secret',
      }),
      res,
      async (_url: string, init?: unknown) => {
        sentInit = init as { headers?: Record<string, string> } | undefined;
        return fakeUpstream();
      },
    );
    expect(res.calls[0].status).toBe(200);
    const forwarded = Object.fromEntries(
      Object.entries(sentInit?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect(forwarded['x-soa-token']).toBeUndefined();
    expect(forwarded['authorization']).toBe(''); // 白名单本身仅 Content-Type/Authorization 两键
  });

  it('S5:代理响应带 CSP/nosniff/no-store 头(400 与 200 路径)', async () => {
    const res400 = fakeRes();
    await handleLlmProxy(fakeReq(JSON.stringify({ base: 'ftp://x.com/v1' })), res400, async () => fakeUpstream());
    const h400 = res400.calls[0].headers ?? {};
    expect(h400['X-Content-Type-Options']).toBe('nosniff');
    expect(h400['Cache-Control']).toBe('no-store');
    expect(h400['Content-Security-Policy']).toContain("default-src 'self'");
    expect(h400['Content-Security-Policy']).toContain("connect-src 'self' https:");
    expect(h400['Content-Security-Policy']).toContain("frame-ancestors 'self'");

    const res200 = fakeRes();
    await handleLlmProxy(
      fakeReq(JSON.stringify({ base: 'https://8.8.8.8/v1', model: 'm' })),
      res200,
      async () => fakeUpstream(),
    );
    const h200 = res200.calls[0].headers ?? {};
    expect(h200['X-Content-Type-Options']).toBe('nosniff');
    expect(h200['Cache-Control']).toBe('no-store');
  });
});

describe('proxies.cjs F30(畸形 req.url → 400 不崩)', () => {
  it('handleTdxCollect:new URL 抛错 → 400,不触采集', async () => {
    const res = fakeRes();
    let called = false;
    await handleTdxCollect({ url: 'http://[::1' }, res, async () => {
      called = true;
      return {};
    });
    expect(res.calls[0].status).toBe(400);
    expect(called).toBe(false);
  });

  it('handleWebSearch:new URL 抛错 → 400,不触 searcher', async () => {
    const res = fakeRes();
    let called = false;
    await proxies.handleWebSearch({ url: 'http://[::1' }, res, async () => {
      called = true;
      return { results: [] };
    });
    expect(res.calls[0].status).toBe(400);
    expect(called).toBe(false);
  });
});

describe('proxies.cjs /tdx-collect(W4 互斥)', () => {
  it('无效 ticker → 400(不触网)', async () => {
    const res = fakeRes();
    await handleTdxCollect({ url: '/tdx-collect?ticker=abc' }, res);
    expect(res.calls[0].status).toBe(400);
  });

  it('C8 freshness:skipDaily/skipF10 查询参数透传 _collect(缺省全量)', async () => {
    const okResult = { ticker: '600036', name: '招商银行', bars: [], snapshot: null, f10Text: '', capitalText: '' };
    // 全量(无跳过参数)
    const res1 = fakeRes();
    let args1: unknown;
    await handleTdxCollect({ url: '/tdx-collect?ticker=600036' }, res1, async (...a: unknown[]) => {
      args1 = a;
      return okResult;
    });
    expect(res1.calls[0].status).toBe(200);
    expect(args1).toEqual(['600036', { skipDaily: false, skipF10: false }]);
    // 同日/同季跳过 → 标记透传;非 '1' 值不生效
    const res2 = fakeRes();
    let args2: unknown;
    await handleTdxCollect(
      { url: '/tdx-collect?ticker=600036&skipDaily=1&skipF10=1' },
      res2,
      async (...a: unknown[]) => {
        args2 = a;
        return okResult;
      },
    );
    expect(res2.calls[0].status).toBe(200);
    expect(args2).toEqual(['600036', { skipDaily: true, skipF10: true }]);
    const res3 = fakeRes();
    let args3: unknown;
    await handleTdxCollect({ url: '/tdx-collect?ticker=600036&skipDaily=yes&skipF10=0' }, res3, async (...a: unknown[]) => {
      args3 = a;
      return okResult;
    });
    expect(args3).toEqual(['600036', { skipDaily: false, skipF10: false }]);
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
      // S3:隧道/保留段扩展 —— 6to4 2002::/16、Teredo 2001::/32(含压缩形)、
      // 文档 2001:db8::/32、NAT64 64:ff9b::/96
      '2002::1',
      '2002:c000:201::1',
      '2001::1',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      '2001::4136:e378:8000:63bf:3fff:fdd2', // 压缩形(第二组 0 被压缩)
      '2001:db8::1',
      '64:ff9b::1',
      '64:ff9b:1::8080',
    ];
    for (const ip of priv) expect(isPrivateAddress(ip), ip).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false); // 172.32 不在 172.16-31 段
    for (const ip of ['8.8.8.8', '1.1.1.1', '114.114.114.114', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('S3 补漏:hex 形 IPv4-mapped IPv6(::ffff:0:0/96)按内嵌 IPv4 判定,不再只认 dotted-quad', () => {
    const priv = [
      '::ffff:7f00:1', // 127.0.0.1
      '::ffff:0:7f00:1', // 宽容变体(内嵌位仍在末 32 位)
      '::ffff:a00:1', // 10.0.0.1
      '::ffff:c0a8:101', // 192.168.1.1
      '::ffff:a9fe:a9fe', // 169.254.169.254(云 metadata)
      '::ffff:0:0', // 0.0.0.0
      '0:0:0:0:0:ffff:7f00:1', // 未压缩全写形同样在内
      '0:0:0:0:0:ffff:127.0.0.1', // 全写形 + 内嵌 dotted-quad 私网(2026-08-28)
    ];
    for (const ip of priv) expect(isPrivateAddress(ip), ip).toBe(true);
    // 内嵌公网 IPv4 不得误封:8.8.8.8 的 hex/dotted-quad/全写形
    for (const ip of ['::ffff:808:808', '::ffff:8.8.8.8', '0:0:0:0:0:ffff:808:808', '0:0:0:0:0:ffff:8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
    expect(isPrivateAddress('2002::1')).toBe(true); // 原生 IPv6 前缀回归不受影响
  });

  it('N-12:IPv4-compatible ::/96 按内嵌 IPv4 判定,不再是公网放行缺口', () => {
    const priv = [
      '::7f00:1', // 127.0.0.1
      '::a00:1', // 10.0.0.1
      '::c0a8:101', // 192.168.1.1
      '::a9fe:a9fe', // 169.254.169.254(云 metadata)
      '0:0:0:0:0:0:7f00:1', // 未压缩全写形同样在内
      '::192.168.1.1', // dotted-quad 尾形(N-12 同款,防 NaN→0.0.0.0 兜底误判)
    ];
    for (const ip of priv) expect(isPrivateAddress(ip), ip).toBe(true);
    // 公网内嵌地址不得误封 —— 不整段封 ::/96(hex + dotted-quad 尾形)
    for (const ip of ['::808:808', '::101:101', '::8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
    // 回归:mappedStd/mappedLoose 仍按内嵌 IPv4 判定,不被 ::/96 分支遮蔽
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('::ffff:0:7f00:1')).toBe(true);
    expect(isPrivateAddress('::ffff:808:808')).toBe(false);
  });

  it('isPublicHost:localhost → false;公网 IP 字面 → true(不触网)', async () => {
    expect(await isPublicHost(new URL('http://localhost/v1'))).toBe(false);
    expect(await isPublicHost(new URL('https://8.8.8.8/v1'))).toBe(true);
  });
});

describe('handleWebSearch q 校验(08-16-desktop-app:多词查询须放行)', () => {
  function req(url: string): { url: string } {
    return { url };
  }
  async function statusFor(url: string): Promise<number> {
    const res = fakeRes();
    await proxies.handleWebSearch(req(url), res, async () => ({ results: [] }));
    return res.calls[0]?.status ?? 200;
  }

  it('多词查询(含空格,分析师模板 "600036 最新新闻") → 放行到 searcher', async () => {
    expect(await statusFor('/web-search?q=' + encodeURIComponent('600036 最新新闻'))).toBe(200);
  });

  it('空 q → 400,不触 searcher', async () => {
    expect(await statusFor('/web-search?q=')).toBe(400);
    expect(await statusFor('/web-search')).toBe(400);
  });

  it('>200 字符 → 400', async () => {
    expect(await statusFor('/web-search?q=' + 'a'.repeat(201))).toBe(400);
  });

  it('控制字符 → 400', async () => {
    expect(await statusFor('/web-search?q=' + encodeURIComponent('abc\ndef'))).toBe(400);
  });
});
describe('proxies.cjs /yahoo-collect gate(E9:isYahooMarket 与 yahooMarketOfTicker 单源)', () => {
  it('布尔谓词:仅 hk/us → true;cn/非法/未判定 → false', () => {
    const table: Array<[string, boolean]> = [
      // hk/us 合法形
      ['AAPL', true],
      ['BRK.B', true],
      ['BF-B', true],
      ['700.HK', true],
      ['0700.HK', true],
      ['09988.HK', true],
      ['00988', true], // 5 位数字 → hk
      // 非法/非港美股 → false
      ['600036', false], // 6 位 CN
      ['430001', false], // 6 位 4 开头 → null
      ['666666.HK', false], // 6 位数字不匹配 strip 正则(不剥)→ detectMarket null
      ['123456.HK', false],
      ['', false],
      ['非港美股', false],
      ['APL?', false],
    ];
    for (const [ticker, expected] of table) {
      expect(isYahooMarket(ticker), ticker).toBe(expected);
    }
  });

  it('与 yahooMarketOfTicker 一致性:抛错 ⇔ false(去重后行为全等)', () => {
    const probes = ['AAPL', 'BRK.B', '0700.HK', '600036', '430001', '123456.HK', '00988', '', '非港美股'];
    for (const ticker of probes) {
      let classifierThrows = false;
      try {
        yahooMarketOfTicker(ticker);
      } catch {
        classifierThrows = true;
      }
      expect(isYahooMarket(ticker), ticker).toBe(!classifierThrows);
    }
  });

  it('gate 集成:非法 ticker → 400 不触 _collect;合法 → 200 且参数透传', async () => {
    // 400 路径(正则/谓词双校验任一不过 → 拒;不触收集)
    const resBad = fakeRes();
    let calledBad = false;
    // '1A' 过正则不过谓词(双校验第二分支可达)——同样 400 不触收集
    await handleYahooCollect(
      fakeReq(JSON.stringify({ ticker: '1A' }), {}, '/yahoo-collect'),
      resBad,
      async () => {
        calledBad = true;
        return {};
      },
    );
    expect(resBad.calls[0].status).toBe(400);
    expect(calledBad).toBe(false);
    // 200 路径(注入 _collect,不触网):ticker 与 skipDaily 标记透传
    const resOk = fakeRes();
    let argsOk: unknown;
    await handleYahooCollect(
      fakeReq(JSON.stringify({ ticker: 'AAPL' }), {}, '/yahoo-collect'),
      resOk,
      async (...a: unknown[]) => {
        argsOk = a;
        return { ticker: 'AAPL', name: 'Apple' };
      },
    );
    expect(resOk.calls[0].status).toBe(200);
    expect(argsOk).toEqual(['AAPL', { skipDaily: false }]);
  });
});
