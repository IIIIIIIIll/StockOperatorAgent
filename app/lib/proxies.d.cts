// 供 vitest(test/proxies.test.ts)类型引用;运行时由 Node 直接加载 .cjs
// (实现见 proxies.cjs,metro dev 中间件与生产 server.mjs 共享单份)。
// 声明面与 logs-server.d.cts 同款伴随惯例。cjs 实现无类型,参数刻意宽松
// (any):本声明的职责是暴露导出面与注入点 arity(测试传假 req/fetch/collect/
// ddg 件,类型上兼容真件即可),不重新发明签名。
declare const proxies: {
  handleLlmProxy(
    req: unknown,
    res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void },
    _fetch?: (input: any, init?: any) => Promise<any>,
  ): Promise<void>;
  handleTdxCollect(
    req: unknown,
    res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void },
    _collect?: (ticker: any, opts?: any) => Promise<any>,
  ): Promise<void>;
  handleYahooCollect(
    req: unknown,
    res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void },
    _collect?: (ticker: any, opts?: any) => Promise<any>,
  ): Promise<void>;
  handleWebSearch(
    req: { url: string },
    res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void },
    _ddg?: (q: any) => Promise<any>,
  ): Promise<void>;
  MAX_BODY_BYTES: number;
  COLLECT_TIMEOUT_MS: number;
  YAHOO_COLLECT_TIMEOUT_MS: number;
  normalizeBaseUrl(raw: string): string;
  isPrivateAddress(ip: string): boolean;
  isPublicHost(u: URL): Promise<boolean>;
  isYahooMarket(ticker: unknown): boolean;
};
export = proxies;
