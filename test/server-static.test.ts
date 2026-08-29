// server.mjs serveStatic 单测(C1:畸形 URL → 400 不崩)。serveStatic 已导出,
// import 侧跳过 listen 副作用(见 server.mjs 底部 isMain 守卫)。
import { describe, expect, it, vi } from 'vitest';
import { serveStatic, createAppServer } from '../app/server.mjs';

/** 无 keep-alive 的 fetch 包装:undici 全局池按 origin(host:port)复用连接,
 *  CI 慢机上 listen(0) 端口复用 → 池内死 socket 被下一次请求捡走
 *  (UND_ERR_SOCKET: other side closed,08-29 实证)。Connection: close 让每次
 *  请求新建连接,池不再持有本测试 server 的 socket;与 finally 里的
 *  closeAllConnections 双保险。 */
function nc(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), connection: 'close' },
  });
}

interface StaticRes {
  calls: Array<{ status: number; body: string; headers?: Record<string, string> }>;
  writeHead(status: number, headers?: Record<string, string>): void;
  destroy?(): void;
  end(body?: unknown): void;
}
function fakeRes(): StaticRes {
  const calls: Array<{ status: number; body: string; headers?: Record<string, string> }> = [];
  return {
    calls,
    writeHead(status: number, headers?: Record<string, string>) {
      // 无 headers 的 writeHead 保持 {status, body} 形状(既有 400 深比较契约)
      calls.push(headers ? { status, body: '', headers } : { status, body: '' });
    },
    destroy() {},
    end(body?: unknown) {
      if (calls.length === 0) calls.push({ status: 200, body: '' });
      calls[calls.length - 1].body = body === undefined ? '' : String(body);
    },
  };
}

describe('server.mjs serveStatic(C1 畸形 URL)', () => {
  it('/%ZZ → 400 Bad Request,不抛异常(进程存活)', () => {
    const res = fakeRes();
    expect(() => serveStatic({ url: '/%ZZ' }, res)).not.toThrow();
    expect(res.calls).toEqual([{ status: 400, body: 'Bad Request' }]);
  });

  it('/% → 400(截断百分号序列)', () => {
    const res = fakeRes();
    expect(() => serveStatic({ url: '/%' }, res)).not.toThrow();
    expect(res.calls[0].status).toBe(400);
  });

  it('/%E0%A4%A → 400(不完整 UTF-8 序列)', () => {
    const res = fakeRes();
    expect(() => serveStatic({ url: '/%E0%A4%A' }, res)).not.toThrow();
    expect(res.calls[0].status).toBe(400);
  });

  it('F28:双重编码点段逃逸到兄弟 distX 目录 → 403(裸 startsWith 前缀误放行)', () => {
    // '/..%2f..%2f…':URL 解析器不把含 %2f 的段当点段归一化,decodeURIComponent
    // 后得 '/../../distX-etc/passwd' → path.join 归一到 DIST 兄弟目录;旧
    // startsWith(DIST) 与 '/a/distX/…' 共享 '/a/dist' 字符串前缀 → 误放行,
    // 锚定 DIST+sep 后 403。(纯 '%2e' 点段会被 URL 归一化,不构成逃逸。)
    const res = fakeRes();
    serveStatic({ url: '/..%2f..%2fdistX-etc/passwd' }, res);
    expect(res.calls).toEqual([{ status: 403, body: 'Forbidden' }]);
  });

  it('S5:静态 200 响应带 CSP/nosniff/cache 头(index.html no-cache)', () => {
    const res = fakeRes();
    serveStatic({ url: '/index.html' }, res);
    expect(res.calls[0].status).toBe(200);
    const h = res.calls[0].headers ?? {};
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Cache-Control']).toBe('no-cache');
    expect(h['Content-Security-Policy']).toContain("default-src 'self'");
    expect(h['Content-Security-Policy']).toContain("connect-src 'self' https:");
    // 与 proxies.cjs SEC_HEADERS 同值防漂移:frame-ancestors 'self'(clickjacking)
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'self'");
  });
});

describe('server.mjs S2(代理端点 Origin 允许列表)', () => {
  async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
    // host 选项回环 → 无 token 门(S6 契约),不受 ambient HOST(如 dev shell
    // 导出 HOST=0.0.0.0)影响;本 describe 只测 Origin 门,不依赖模块级 HOST。
    const server = createAppServer({ host: '127.0.0.1' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      // 全局 undici fetch 池会 keep-alive 复用本 server 的 socket;仅 close()
      // 不销毁空闲连接——下一用例 listen(0) 拿到同端口时池内旧 socket 已死
      // (UND_ERR_SOCKET: other side closed,CI 慢机偶发,08-29 实证)。先
      // closeAllConnections 强制断开,池内条目作废,下用例必然新建连接。
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('跨站 Origin → 403 且零 CORS 头;同站 Origin → 放行到路由;null Origin → 放行', async () => {
    await withServer(async (base) => {
      // 跨站 fetch(带 Origin)→ 403,无 access-control-allow-origin(读不到响应)
      const cross = await nc(`${base}/llm-proxy/chat/completions`, {
        method: 'POST',
        headers: { Origin: 'http://evil.example' },
        body: '{}',
      });
      expect(cross.status).toBe(403);
      expect(cross.headers.get('access-control-allow-origin')).toBeNull();
      expect(await cross.text()).toBe('Forbidden');

      // 同站 Origin → 进入 llm-proxy 路由(body 非法 JSON → 502,而非 403)
      const same = await nc(`${base}/llm-proxy/chat/completions`, {
        method: 'POST',
        headers: { Origin: base },
        body: 'not-json',
      });
      expect(same.status).toBe(502);

      // Origin: null(file:// 等上下文)→ 放行到路由(同上 502 判定)
      const nul = await nc(`${base}/llm-proxy/chat/completions`, {
        method: 'POST',
        headers: { Origin: 'null' },
        body: 'not-json',
      });
      expect(nul.status).toBe(502);
    });
  });

  it('无 Origin 的 GET 简单请求不受 Origin 门控(落到静态/SPA 面,非 403)', async () => {
    await withServer(async (base) => {
      // GET /web-search 无 Origin(script/img 等简单请求形态)→ 非 403
      const get = await nc(`${base}/web-search?q=`, { method: 'GET' });
      expect(get.status).not.toBe(403);
      // 无 Origin 的 GET /llm-proxy/…(简单请求)不被门控(SPA fallback 面)
      const getProxy = await nc(`${base}/llm-proxy/whatever`, { method: 'GET' });
      expect(getProxy.status).not.toBe(403);
    });
  });
});

describe('server.mjs S6(非回环监听 X-SOA-Token 门)', () => {
  // HOST/SOA_ACCESS_TOKEN 在模块加载期读入(模块级 HOST 常量)——
  // 每次用例 resetModules + stubEnv 后动态 import,取全新模块实例。
  // createAppServer({host}) 选项按**有效监听地址**判定 requireToken(缺省回退
  // 模块级 HOST env),host 选项可经第三参注入。
  async function withFreshServer(
    env: Record<string, string>,
    fn: (base: string) => Promise<void>,
    createOpts: { host?: string } = {},
  ): Promise<void> {
    vi.resetModules();
    vi.stubEnv('HOST', '0.0.0.0');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const mod = await import('../app/server.mjs');
    const server = mod.createAppServer(createOpts);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      server.closeAllConnections(); // 同上:销毁 keep-alive 空闲连接,防池复用死 socket
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  }

  it('非回环监听 + 未设 token → 代理端点 401(安全默认:宁缺勿开)', async () => {
    await withFreshServer({}, async (base) => {
      const res = await nc(`${base}/tdx-collect?ticker=bad`, { method: 'GET' });
      expect(res.status).toBe(401);
      expect(await res.text()).toContain('X-SOA-Token');
      // 5 个代理端点统一设门:/logs 同样 401
      const logs = await nc(`${base}/logs`, { method: 'POST', body: '{}' });
      expect(logs.status).toBe(401);
    });
  });

  it('非回环监听 + X-SOA-Token 缺失/不匹配 → 401;匹配 → 放行到路由', async () => {
    await withFreshServer({ SOA_ACCESS_TOKEN: 'sekrit' }, async (base) => {
      // 头缺失 → 401(裸 Authorization 不算数,见下一条)
      const none = await nc(`${base}/tdx-collect?ticker=bad`, { method: 'GET' });
      expect(none.status).toBe(401);

      const bad = await nc(`${base}/tdx-collect?ticker=bad`, {
        method: 'GET',
        headers: { 'X-SOA-Token': 'wrong' },
      });
      expect(bad.status).toBe(401);

      // 过门后进路由:非法 ticker → 400(而非 401,证明门已放行)
      const good = await nc(`${base}/tdx-collect?ticker=bad`, {
        method: 'GET',
        headers: { 'X-SOA-Token': 'sekrit' },
      });
      expect(good.status).toBe(400);
    });
  });

  it('门不消费 Authorization(LLM 供应商 key 槽位):仅 Bearer 无 X-SOA-Token → 401', async () => {
    await withFreshServer({ SOA_ACCESS_TOKEN: 'sekrit' }, async (base) => {
      // Authorization 头是 /llm-proxy 上游透传的 LLM key,与门头互不干扰:
      // 只有 Authorization、没有 X-SOA-Token → 仍 401
      const authOnly = await nc(`${base}/llm-proxy/chat/completions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer sekrit' },
        body: 'not-json',
      });
      expect(authOnly.status).toBe(401);
      // 双头齐备 → 过门进 llm-proxy 路由(body 非法 JSON → 502,证明门放行且
      // Authorization 透传路径未被门改动)
      const both = await nc(`${base}/llm-proxy/chat/completions`, {
        method: 'POST',
        headers: { 'X-SOA-Token': 'sekrit', Authorization: 'Bearer llm-key' },
        body: 'not-json',
      });
      expect(both.status).toBe(502);
    });
  });

  it('有效监听地址决定门:createAppServer({host: 127.0.0.1}) 在 HOST=0.0.0.0 env 下不要求 token', async () => {
    await withFreshServer(
      { SOA_ACCESS_TOKEN: 'sekrit' },
      async (base) => {
        // host 选项回环 → 无门:无 token 直接进路由(非法 ticker → 400,而非 401)
        const res = await nc(`${base}/tdx-collect?ticker=bad`, { method: 'GET' });
        expect(res.status).toBe(400);
      },
      { host: '127.0.0.1' },
    );
  });

  it('非回环监听:静态面不要求 token(仅代理/日志端点设门)', async () => {
    await withFreshServer({}, async (base) => {
      const res = await nc(`${base}/index.html`, { method: 'GET' });
      expect(res.status).not.toBe(401); // 无 dist → SPA fallback 面,非 401
    });
  });

  it('回环监听(默认)不要求 token:代理端点无 token 直接进路由', async () => {
    // 显式 HOST=127.0.0.1 走 withFreshServer(resetModules + stubEnv 后动态
    // import):不依赖 dev shell 的 ambient HOST(如 HOST=0.0.0.0 导出会使旧
    // 顶层实例 requireToken=true → 误 401)。
    await withFreshServer({ HOST: '127.0.0.1' }, async (base) => {
      const res = await nc(`${base}/tdx-collect?ticker=bad`, { method: 'GET' });
      expect(res.status).toBe(400); // 非法 ticker 判定,而非 401
    });
  });

  it('bind host ::1(IPv6 回环)同样不要求 token', async () => {
    await withFreshServer({ HOST: '::1' }, async (base) => {
      const res = await nc(`${base}/tdx-collect?ticker=bad`, { method: 'GET' });
      expect(res.status).toBe(400); // 裸 IPv6 回环 bind 串不入门(2026-08-28)
    });
  });
});
