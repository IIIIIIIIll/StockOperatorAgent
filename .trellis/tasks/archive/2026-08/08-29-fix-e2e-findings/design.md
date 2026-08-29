# Design: 修复 F1/F2/tsconfig + finnhub 验证

## F1 — billionsClient fetch 绑定（一行级）

`src/billionsClient.ts` 构造器:

```ts
this._fetch = opts.fetch ?? ((...args: Parameters<FetchLike>) => globalThis.fetch(...args));
```

原理:箭头函数体内裸调用 `globalThis.fetch(...)`——this 为 globalThis/undefined,
满足 Chrome 对 fetch 的 this 约束;注入的 fake fetch（测试）不受影响（opts.fetch
优先）。消费点 `this._fetch(...)` 调用方式不变（方法调用箭头函数无 this 依赖）。

## F2 — /tdx-mcp 同源代理

### 数据流

```
web 浏览器                     server (Node)
TdxMcpClient._post
  └─ makeProxyMcpFetch(origin) ── POST /tdx-mcp ──▶ handleTdxMcp
       headers: tdx-api-key / content-type / accept / mcp-session-id
                                                     │ 固定目标
                                                     ▼
                                            mcp.tdx.com.cn:3001/mcp
                                            ◀── SSE/JSON + Mcp-Session-Id 头
```

Node/RN 平台不经代理,维持 `TdxMcpClient` 直连（无 CORS）。

### proxies.cjs handleTdxMcp 要点

- 目标写死 `https://mcp.tdx.com.cn:3001/mcp`——无用户输入 target,零 SSRF 面
  （无需 normalizeBaseUrl/pinPublicHost）。
- 请求体:for-await 收集 + 1MB 上限（W2 同款）,Buffer 原样转发（不 JSON.parse）。
- 请求头白名单:tdx-api-key / content-type / accept / mcp-session-id
  （小写比较,原键名转发;对齐 llm-proxy S6 白名单纪律,拒绝其余头）。
- 响应:writeHead(upstream.status, { 'Content-Type': 上游, 'Mcp-Session-Id': 上游,
  ...SEC_HEADERS }) + R4 同款流式透传（for-await chunk → res.write;SSE 逐块转发）。
- 超时:60s timer 仅提前回 504 通知客户端,不打断 in-flight（W4 语义）;
  upstream 断开 → headersSent 则 destroy,否则 502 JSON。
- `redirect: 'manual'`（固定目标不应跳转;防意外）。

### mcp.ts makeProxyMcpFetch(base)

```ts
export function makeProxyMcpFetch(base: string): typeof fetch {
  const FORWARD = new Set(['tdx-api-key', 'content-type', 'accept', 'mcp-session-id']);
  return (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      if (FORWARD.has(k.toLowerCase())) headers[k] = v;
    });
    return fetch(`${base}/tdx-mcp`, { ...init, headers });
  };
}
```

对齐 `makeProxySearcher`（src/webSearch.ts）:base 由调用方传,函数惰性;无超时
（客户端 AbortSignal.timeout(30s) 兜底）。DOM Headers 由 tsconfig lib=DOM 提供。

### runner.ts makeMcpIntel 接线

```ts
const proxyFetch = detectPlatform() === 'web' && location?.origin
  ? makeProxyMcpFetch(location.origin)
  : undefined;
const text = await getMarketIntel(ticker, { apiKey, fetch: proxyFetch });
```

location 声明与守卫对齐 collectForWeb（runner.ts 已有）。

### 挂载

- metro.config.js:require 解构加 handleTdxMcp;enhanceMiddleware 加
  `else if (pathname === '/tdx-mcp') void handleTdxMcp(req, res);`
- server.mjs:import 加 handleTdxMcp;路由分支同款。

## tsconfig 防复发

`tools/restore-app-tsconfig.mjs`（node 内建,零依赖）:
- EXPECTED = 当前 HEAD 的 app/tsconfig.json 内联版全量 JSON。
- 运行时解析 app/tsconfig.json:`extends === 'expo/tsconfig.base'` → 写回
  EXPECTED 并打印恢复日志;否则跳过。
- 挂载:app/package.json `"web"` 脚本（export 后、serve 前）;
  release.yml Build web bundle 步骤追加 `node ../tools/restore-app-tsconfig.mjs`。

## 测试

| 文件 | 用例 |
|------|------|
| test/billions-client.test.ts | F1:默认 fetch 为裸调用包装——fake globalThis.fetch 捕获 this,断言 undefined（浏览器 Illegal invocation 回归） |
| test/mcp.test.ts | makeProxyMcpFetch:URL 拼 /tdx-mcp、白名单头透传、非白名单头过滤 |
| test/proxies.test.ts | handleTdxMcp:固定目标转发、请求头白名单、SSE body 逐块透传、Mcp-Session-Id 响应头透传、413、502、504 |

## 验证序列

1. `npx vitest run` + `npx tsc --noEmit` + chart 双门。
2. `npx expo export --platform web` → 确认 tsconfig 被改写 → `node tools/restore-app-tsconfig.mjs` 恢复 → git 干净（防复发实证）。
3. web 生产托管 → 注入 settings（三键 + TDX + 亿信 + **finnhub key** + 全开关）→ AAPL us 全流程重跑:
   - 亿信:FINDB/SEARCH/TWITTER/FETCH 请求真实发出（无 Illegal invocation;上游 502 时记录为上游问题）
   - TDX MCP:情报段落内容或新失败形态如实记录（代理日志佐证）
   - finnhub:报告行业字段（companyProfile2 → overview.industry）实证
4. 报告追加 findings 修复状态 → 提交 → 归档。

## 回滚

F1 一行级（构造器包装）;F2 新增路由与函数（不触碰既有路径——Node/RN 直连
不变,web 失败时降级文案同旧）;tsconfig 防护为独立脚本。各改动可独立回退,
互不阻塞。
