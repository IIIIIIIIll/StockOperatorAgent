# Implement：执行计划

## 阶段 0 — 规划（已完成）
- [x] prd.md / design.md
- [x] 蓝本阅读：billions/client.py（4 端点全读）、get_market_intel.py（mcp 语义）、vendor tdx_mcp/tdx_client.py（JSON-RPC + SSE）、information_analyst.py（_prefetch 三源）、TS agents.ts/committee.ts/pipeline.ts/App.tsx/runner.ts 现状
- [x] 决策：mcp 不做缓存（TS 无 is_trading_time 移植）；北交所/akshare 不做

## 阶段 1 — 并行实现（3 分片）

### 1.1 ts-billions（R1+R2）
- 新增 `ts/src/billionsClient.ts`：BillionsApiError + BillionsClient 4 端点 + 错误归一化 + AbortSignal.timeout 超时档位 + fetch 注入点
- 改 `ts/src/agents.ts`：BillionsInformationAnalyst 构造加 `_billionsClient` 可选注入 + `_prefetch` 三源/twitter 预抓 + 真实素材判定 + web 回退保留
- 改 `ts/src/committee.ts`：billionsEnabled 门控已在；确认 analyst 工厂透传 client
- 改 `ts/app/lib/runner.ts` + `ts/app/App.tsx`：`makeBillionsIntel(ticker)` 注入 `deps.billions`
- 新增 `ts/test/billions-client.test.ts` + `ts/test/billions-analyst.test.ts`

### 1.2 ts-mcp-qfq（R3+R4）
- 新增 `ts/src/mcp.ts`：TdxMcpClient（JSON-RPC 2.0 + tdx-api-key + session 透传 + SSE 解析）+ getMarketIntel（门控/key 占位/查询/中文摘要）
- 改 `ts/src/tdx/quoteClient.ts`：fetchDailyBars 日期改 YYYY-MM-DD；collectAll 接 xdxr + qfqAdjust
- 改 `ts/app/lib/runner.ts` + `ts/app/App.tsx`：`deps.mcp` 注入
- 新增 `ts/test/mcp.test.ts`（SSE 解析/门控）+ qfq 接线测试

### 1.3 ts-server-security（R5）
- 改 `ts/app/server.mjs`：decodeURIComponent try/catch → 400；listen 默认 127.0.0.1（HOST env 可覆盖）
- 改 `ts/app/lib/proxies.cjs`：LLM base 服务端配置（忽略客户端头）；body 64KB 上限 413；tdx-collect AbortController
- 改 `ts/app/lib/logs-server.cjs`：message/platform 换行净化
- 新增/改 `ts/test/log-server.test.ts` + 代理测试

## 阶段 2 — 验证
- 2.1 `cd ts && npm test`（vitest 全绿）
- 2.2 `cd ts && npx tsc --noEmit`（typecheck）
- 2.3 交叉核对：新代码与 Python 蓝本语义逐项对照（超时档位、错误码、分节标记）
- 2.4 主 session 抽查关键行为（如 qfq 接线链、SSE 解析）

## 阶段 3 — 交付
- 3.1 trellis-check 验证
- 3.2 spec 更新：ts/index.md 补「亿信/mcp 能力接线」+「代理安全契约」（trellis-update-spec）
- 3.3 报告用户 + 提交（用户确认后）

## 验证命令
- `cd ts && npm test`
- `cd ts && npx tsc --noEmit`

## 回滚点
- 分片间依赖：B 的 collectAll 改动影响现有 qfq.test/overview.test → 若破坏现有断言，先修测试再继续
- 安全改动独立可回滚（server/proxies 单文件 revert）
