// 供 vitest(ts/test/server-static.test.ts)类型引用;运行时由 Node 直接加载
// .mjs(实现见 server.mjs)。import 侧无副作用(listen 仅主入口执行)。
declare function serveStatic(
  req: { url: string },
  res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void },
  /** S7-5:测试注入的 dist 根(缺省 = 真实 app/dist)。 */
  distRoot?: string,
): void;
declare function createAppServer(opts?: { host?: string }): import('node:http').Server;
export { serveStatic, createAppServer };
/** CR-51:静态面与代理面共用的安全头单源。 */
export const SEC_HEADERS: Record<string, string>;
