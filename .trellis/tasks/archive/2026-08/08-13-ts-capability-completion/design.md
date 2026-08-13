# Design：TS 能力补齐

## 1. 分片（3 个实现分片 + 1 验证）

| # | 分片 | 文件 | 内容 |
|---|------|------|------|
| A | ts-billions | 新增 `ts/src/billionsClient.ts`；改 `ts/src/agents.ts`、`ts/src/committee.ts`、`ts/app/App.tsx`、`ts/app/lib/runner.ts` | R1+R2+R6(亿信部分)：REST 客户端 + analyst 预抓 + 接线 |
| B | ts-mcp-qfq | 新增 `ts/src/mcp.ts`；改 `ts/src/tdx/quoteClient.ts`、`ts/src/pipeline.ts`、`ts/app/App.tsx` | R3+R4：mcp 客户端 + qfq 接线 + 日期修复 |
| C | ts-server-security | 改 `ts/app/server.mjs`、`ts/app/lib/proxies.cjs`、`ts/app/lib/logs-server.cjs` | R5：C1/C2/W2/W3/W4 |
| V | 验证 | 跑 vitest + tsc | R6 验收 |

## 2. 关键设计决策

### 亿信客户端（对齐 Python client.py 逐项）
- `class BillionsApiError extends Error { code; statusCode }`
- `class BillionsClient { constructor(opts?: { fetch?: FetchLike; apiKey?: string; baseUrl?: string }) }` — `fetch` 注入点对齐 Python `_http`（house style 无 mock 框架）
- `post(path, payload, timeoutMs)`：`AbortSignal.timeout(timeoutMs)` + 错误归一化三分支（网络异常 / 非 2xx / success===false）
- 端点方法：`finDb(query, dataSources?)` 120s / `search(query, {source, searchMode, count, timeRange})` 25/70/120 / `twitterSearch(query, {searchMode, count})` / `fetchDoc({url?, docId?, page?, maxChars?})` 90s

### analyst 预抓（对齐 Python `_prefetch` 语义）
- `BillionsInformationAnalyst` 构造加可选 `_billionsClient` 注入；`_prefetch` 三源 + twitter，分节标记「…检索结果】」判定真实素材
- 亿信开关：`billionsEnabled('SEARCH')` / `billionsEnabled('TWITTER')`（committee.ts 已有 `billionsEnabled(cap)`）
- web 回退节现有逻辑保留（R2 要求逐字节不变的回退文本）
- 预抓发生在 `information_analyst` 节点方法内（`state` 入参同 Python——嵌入 stock_information + 素材上下文）

### mcp（对齐 vendor tdx_client.py）
- `class TdxMcpClient { constructor(apiKey, opts?) }`：`tdx-api-key` 头 + `Mcp-Session-Id` 透传 + JSON/SSE 双响应解析（`_parseSse` 取首个含 result/error 的 data 行）
- `initialize()` + `callTool(name, args)`；`query(text, size)` 高封装（对齐 `TdxQueryResult`：ok()/toDicts()）
- `getMarketIntel(ticker)`：`TDX_MCP_DISABLED`/`TDX_MCP_ENABLED` 门控 → 无 key 占位 → 实时查询 → 中文摘要（`row_to_text` 对齐）
- **缓存简化**（R3 设计决策）：TS 无 `is_trading_time` 完整移植（Python 节假日语义本身未实现）——**不做缓存**，每次实时查询（与 Python 交易时段行为一致；非交易时段多一次网络往返可接受，phase out 后 TS 单实现、行为自洽）。`mcp_intel_cache.py` 不移植。
- 接线：`ts/app/lib/runner.ts` 导出 `makeMcpIntel(ticker)`（门控 + 查询 + 摘要），App.tsx 传入 `deps.mcp`

### qfq 接线（修复 W8/W9）
- `collectAll`（quoteClient.ts:91）内：`fetchDailyBars` → `fetchXdxr`（新增 xdxr 拉取）→ `qfqAdjust(bars, xdxrEvents)` → 返回 adjusted bars
- `fetchDailyBars` 日期改 `YYYY-MM-DD`（删 `.replace(/-/g, '')`）——store 契约对齐
- 注意：`qfqAdjust` 输入事件形状 `XdxrEventLike`（含 `tradeDate`）——xdxr 响应 → 事件转换（live.integration.test.ts:57-63 先例）
- 缺省 qfq 失败 → 原样返回 raw bars（不阻断采集，对齐 Python adjust 失败降级）

### 服务端安全（C1/C2/W2/W3/W4）
- C1：`serveStatic` 内 `try { urlPath = decodeURIComponent(...) } catch { res.writeHead(400); res.end(); return; }`
- C2：`handleLlmProxy` 转发 base 改为 `process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1'` 类服务端配置（忽略客户端头）；`server.listen(PORT, process.env.HOST || '127.0.0.1')`
- W2：body 累计 > 64KB → 413 并终止
- W3：`message`/`platform` 落盘前 `replace(/[\r\n]+/g, ' ')`
- W4：`/tdx-collect` 用 AbortController 取消 in-flight doCollect，finally 仅在真 settle 后释放锁

## 3. 契约

- 亿信段注入：`deps.billions(ticker) => string`（pipeline.ts 已声明，App.tsx 传入）
- mcp 段注入：`deps.mcp(ticker) => string`（同上）
- 新增模块零副作用导入（对齐 house style：懒加载/方法内 import）
- 发现格式不适用（实现任务）；验收走测试

## 4. 兼容性

- `BillionsInformationAnalyst` 构造签名向后兼容（新参数可选，默认 undefined）
- `collectAll` 返回类型不变（`{ ticker, name, bars, snapshot, capital }`），bars 内容变复权
- proxies.cjs/server.mjs 行为变化仅限安全面（base 来源、监听地址、上限、净化）
