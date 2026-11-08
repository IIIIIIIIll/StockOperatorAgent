// S8-1 / S9-3（评审 2026-11-08）：代理端点入站门单源化后钉住行为。
// 旧状态：server.mjs 有 Origin + Sec-Fetch-Site + token 三道，metro.config.js 只有
// Origin —— 跨站 <img>/<script> GET 不带 Origin，dev 入口等于零防护。
import { describe, expect, it } from 'vitest';
import gate from '../app/lib/request-gate.cjs';

const { proxyGate, isProxyPath, isLoopbackBind, isLoopbackBindHost, isLoopbackHostHeader } = gate as {
  proxyGate: (
    req: { url: string; headers?: Record<string, string | undefined> },
    opts?: { requireToken?: boolean; accessToken?: string },
  ) => null | { status: number; body: string; headers?: Record<string, string> };
  isProxyPath: (url: string) => boolean;
  isLoopbackBind: (addr?: string) => boolean;
  isLoopbackBindHost: (h?: string) => boolean;
  isLoopbackHostHeader: (h?: string) => boolean;
};

describe('request-gate 路径表(S8-1)', () => {
  it('7 个端点都算代理路径,/logs 精确匹配', () => {
    for (const u of ['/llm-proxy/chat', '/tdx-collect?t=1', '/yahoo-collect', '/web-search?q=a', '/tdx-mcp', '/billions-proxy/x', '/logs']) {
      expect(isProxyPath(u), u).toBe(true);
    }
    for (const u of ['/', '/index.html', '/logs/x']) {
      expect(isProxyPath(u), u).toBe(false);
    }
    // 前缀匹配语义与两个入口的路由判定一致(/web-searchx 也会进门,随后 404)
    expect(isProxyPath('/web-searchx')).toBe(true);
  });
});

describe('request-gate 门禁顺序(S8-1/S9-3)', () => {
  it('非代理路径直接放行', () => {
    expect(proxyGate({ url: '/', headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } })).toBeNull();
  });

  it('跨站 Origin → 403', () => {
    const r = proxyGate({ url: '/web-search', headers: { origin: 'https://evil.test', host: 'localhost:8090' } });
    expect(r?.status).toBe(403);
  });

  it('同站 Origin 放行', () => {
    expect(proxyGate({ url: '/web-search', headers: { origin: 'http://localhost:8090', host: 'localhost:8090' } })).toBeNull();
  });

  it('无 Origin 但 Sec-Fetch-Site 跨站(img/script 简单请求)→ 403', () => {
    for (const site of ['cross-site', 'same-site']) {
      const r = proxyGate({ url: '/tdx-collect', headers: { 'sec-fetch-site': site } });
      expect(r?.status, site).toBe(403);
    }
  });

  it('curl/探针(无 Origin 且无 Sec-Fetch-Site)放行', () => {
    expect(proxyGate({ url: '/tdx-collect' })).toBeNull();
  });

  it('requireToken 且未配置 token → 恒 401(安全默认宁缺勿开)', () => {
    const r = proxyGate({ url: '/web-search' }, { requireToken: true, accessToken: '' });
    expect(r?.status).toBe(401);
  });

  it('requireToken 且 token 不匹配 → 401;匹配 → 放行', () => {
    expect(proxyGate({ url: '/web-search', headers: { 'x-soa-token': 'nope' } }, { requireToken: true, accessToken: 's3cret' })?.status).toBe(401);
    expect(proxyGate({ url: '/web-search', headers: { 'x-soa-token': 's3cret' } }, { requireToken: true, accessToken: 's3cret' })).toBeNull();
  });

  it('回环判定:127.x / ::1 / localhost 真,其余假', () => {
    for (const a of ['127.0.0.1', '127.5.5.5', '::1', '::ffff:127.0.0.1']) expect(isLoopbackBind(a), a).toBe(true);
    for (const a of ['192.168.1.9', '0.0.0.0', undefined]) expect(isLoopbackBind(a), String(a)).toBe(false);
    for (const h of ['localhost', 'localhost:8090', '127.0.0.1:1', '[::1]:8090']) expect(isLoopbackHostHeader(h), h).toBe(true);
    for (const h of ['evil.test', '192.168.1.9', '']) expect(isLoopbackHostHeader(h), h).toBe(false);
    expect(isLoopbackBindHost('0.0.0.0')).toBe(false);
    expect(isLoopbackBindHost('localhost')).toBe(true);
  });
});
