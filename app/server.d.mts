// 供 vitest(ts/test/server-static.test.ts)类型引用;运行时由 Node 直接加载
// .mjs(实现见 server.mjs)。import 侧无副作用(listen 仅主入口执行)。
declare function serveStatic(
  req: { url: string },
  res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void },
): void;
declare function createAppServer(): import('node:http').Server;
export { serveStatic, createAppServer };
