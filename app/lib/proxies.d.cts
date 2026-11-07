// 供 vitest(test/proxies.test.ts)类型引用;运行时由 Node 直接加载 .cjs
// (实现见 proxies.cjs,metro dev 中间件与生产 server.mjs 共享单份)。
// 声明面与 logs-server.d.cts 同款伴随惯例。cjs 实现无类型,参数刻意宽松
// (any):本声明的职责是暴露导出面与注入点 arity(测试传假 req/fetch/collect/
// ddg 件,类型上兼容真件即可),不重新发明签名。
/** R-26:pinPublicHost/isPublicHost 的 DNS 查询器注入面(生产缺省 dns.promises.lookup)。 */
type DnsLookup = (
  hostname: string,
  opts: { all: true; verbatim: boolean },
) => Promise<Array<{ address: string; family: number }>>;

declare const proxies: {
  /** CR-51:与 server.mjs 共用的安全头单源。 */
  SEC_HEADERS: Record<string, string>;
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
  handleTdxMcp(
    req: unknown,
    res: {
      writeHead(status: number, headers?: Record<string, string>): void;
      end(body?: unknown): void;
      write?(chunk: unknown): void;
      destroy?(): void;
    },
    _fetch?: (input: any, init?: any) => Promise<any>,
  ): Promise<void>;
  handleBillionsProxy(
    req: unknown,
    res: {
      writeHead(status: number, headers?: Record<string, string>): void;
      end(body?: unknown): void;
      destroy?(): void;
    },
    _fetch?: (input: any, init?: any) => Promise<any>,
  ): Promise<void>;
  TDX_MCP_TARGET: string;
  TDX_MCP_TIMEOUT_MS: number;
  BILLIONS_TARGET_ORIGIN: string;
  MAX_BODY_BYTES: number;
  COLLECT_TIMEOUT_MS: number;
  YAHOO_COLLECT_TIMEOUT_MS: number;
  normalizeBaseUrl(raw: string): string;
  isPrivateAddress(ip: string): boolean;
  isFakeIpAddress(ip: string): boolean;
  isPublicHost(u: URL, lookup?: DnsLookup): Promise<boolean>;
  pinPublicHost(u: URL, lookup?: DnsLookup): Promise<Array<{ address: string; family: number }> | null>;
  isYahooMarket(ticker: unknown): boolean;
};
export = proxies;
