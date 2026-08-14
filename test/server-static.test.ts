// server.mjs serveStatic 单测(C1:畸形 URL → 400 不崩)。serveStatic 已导出,
// import 侧跳过 listen 副作用(见 server.mjs 底部 isMain 守卫)。
import { describe, expect, it } from 'vitest';
import { serveStatic } from '../app/server.mjs';

interface StaticRes {
  calls: Array<{ status: number; body: string }>;
  writeHead(status: number): void;
  end(body?: unknown): void;
}
function fakeRes(): StaticRes {
  const calls: Array<{ status: number; body: string }> = [];
  return {
    calls,
    writeHead(status: number) {
      calls.push({ status, body: '' });
    },
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
});
