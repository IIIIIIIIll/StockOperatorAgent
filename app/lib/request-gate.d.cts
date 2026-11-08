// 供 vitest(test/request-gate.test.ts)类型引用;运行时由 Node 直接加载 .cjs
// (实现见 request-gate.cjs,server.mjs 与 metro.config.js 共用)。
export interface ProxyGateResult {
  status: number;
  body: string;
  headers?: Record<string, string>;
}
export declare const PROXY_PATHS: string[];
export declare function isProxyPath(url: string): boolean;
export declare function isLoopbackHostHeader(host?: string): boolean;
export declare function isLoopbackBind(addr?: string): boolean;
export declare function isLoopbackBindHost(h?: string): boolean;
export declare function isOriginAllowed(req: { headers?: Record<string, string | undefined> }): boolean;
export declare function proxyGate(
  req: { url: string; headers?: Record<string, string | undefined> },
  opts?: { requireToken?: boolean; accessToken?: string },
): ProxyGateResult | null;
