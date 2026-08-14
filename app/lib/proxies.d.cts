// 供 vitest(ts/test/proxies.test.ts)类型引用;运行时由 Node 直接加载 .cjs
// (实现见 proxies.cjs,metro dev 与生产 server.mjs 共用单份,C2/W2/W4 同源)。
interface ProxyReqBase {
  url: string;
}
interface ProxyLlmReq extends ProxyReqBase {
  headers?: Record<string, string | string[] | undefined>;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
}
interface ProxyRes {
  headersSent?: boolean;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: unknown): void;
}
interface FetchLike {
  (
    url: string,
    init?: unknown,
  ): Promise<{
    status: number;
    headers: { get(name: string): string | null };
    body: unknown;
  }>;
}
declare const proxies: {
  handleLlmProxy(
    req: ProxyLlmReq,
    res: ProxyRes,
    _fetch?: FetchLike,
  ): Promise<void>;
  handleTdxCollect(
    req: ProxyReqBase,
    res: ProxyRes,
    _collect?: (ticker: string) => Promise<unknown>,
  ): Promise<void>;
  handleWebSearch(req: ProxyReqBase, res: ProxyRes): Promise<void>;
  /** W2 请求体上限(64KB)。 */
  MAX_BODY_BYTES: number;
  /** W4 /tdx-collect 超时(45s)。 */
  COLLECT_TIMEOUT_MS: number;
  /** C2 base 校验:http(s) + 无 userinfo + host 非空 → URL,否则 null。 */
  normalizeBaseUrl(raw: unknown): URL | null;
  /** C2 SSRF 黑名单:私网/环回/链路本地/保留段 → true。 */
  isPrivateAddress(ip: string): boolean;
  /** C2 host DNS 解析后全公网 → true;含私网或解析失败 → false。 */
  isPublicHost(u: URL): Promise<boolean>;
};
export = proxies;
