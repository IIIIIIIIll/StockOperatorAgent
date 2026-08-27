// server.mjs serveStatic 单测(C1:畸形 URL → 400 不崩)。serveStatic 已导出,
// import 侧跳过 listen 副作用(见 server.mjs 底部 isMain 守卫)。
import { describe, expect, it } from 'vitest';
import { serveStatic, createAppServer } from '../app/server.mjs';

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
  });
});

describe('server.mjs S2(代理端点 Origin 允许列表)', () => {
  async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
    const server = createAppServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('跨站 Origin → 403 且零 CORS 头;同站 Origin → 放行到路由;null Origin → 放行', async () => {
    await withServer(async (base) => {
      // 跨站 fetch(带 Origin)→ 403,无 access-control-allow-origin(读不到响应)
      const cross = await fetch(`${base}/llm-proxy/chat/completions`, {
        method: 'POST',
        headers: { Origin: 'http://evil.example' },
        body: '{}',
      });
      expect(cross.status).toBe(403);
      expect(cross.headers.get('access-control-allow-origin')).toBeNull();
      expect(await cross.text()).toBe('Forbidden');

      // 同站 Origin → 进入 llm-proxy 路由(body 非法 JSON → 502,而非 403)
      const same = await fetch(`${base}/llm-proxy/chat/completions`, {
        method: 'POST',
        headers: { Origin: base },
        body: 'not-json',
      });
      expect(same.status).toBe(502);

      // Origin: null(file:// 等上下文)→ 放行到路由(同上 502 判定)
      const nul = await fetch(`${base}/llm-proxy/chat/completions`, {
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
      const get = await fetch(`${base}/web-search?q=`, { method: 'GET' });
      expect(get.status).not.toBe(403);
      // 无 Origin 的 GET /llm-proxy/…(简单请求)不被门控(SPA fallback 面)
      const getProxy = await fetch(`${base}/llm-proxy/whatever`, { method: 'GET' });
      expect(getProxy.status).not.toBe(403);
    });
  });
});
