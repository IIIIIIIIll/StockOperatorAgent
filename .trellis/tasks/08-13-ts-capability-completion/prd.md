# TS 能力补齐：亿信移植 + mcp 接线 + qfq + 服务端安全修复

## Goal

Python 全量 phase out 前，把 TS 侧能力缺口补齐，使纯 TS 应用功能完整：

1. **亿信（billions）**：TS 侧从零移植 REST 客户端（4 端点）+ 信息面分析师亿信预抓（search/twitter）+ pipeline 亿信段接线——开关 UI 已存在（settings.ts BILLIONS_*），补数据源后开关真实生效。
2. **mcp 实时市场情报**：TS 侧移植 TdxMcpClient（JSON-RPC over HTTP + SSE 解析）+ pipeline mcp 段接线——替代当前恒占位。
3. **qfq 前复权**：生产链接线（collectAll → qfqAdjust）——除权日指标不再假信号。
4. **服务端安全修复**（review C1/C2 + 相关 WARNING）：decodeURIComponent 崩溃、SSRF 面、请求体上限、日志净化。

**不做**：北交所（用户决策 3：不用了）、akshare 备用路径、Python 侧任何修复。

## Requirements

### R1 亿信客户端移植
- `ts/src/billionsClient.ts`：`BillionsClient` 4 端点薄包装（fin_db / search / twitter_search / fetch），全部 POST + `X-API-KEY` 头，BASE `https://openapi.billionsintelligence.com/api`
- 错误归一化 `BillionsApiError`（message/code/status_code）：网络异常 / HTTP 非 2xx / 200+success:false → 抛错；**不重试**
- 超时参数化：fin_db 120s；search/twitter 按档位 fast 25 / advanced 70 / expert 120；fetch 90s；`AbortSignal.timeout` 实现
- 密钥：env `BILLIONS_API_KEY`（构造注入覆盖），不写日志
- 测试注入点：`_fetch` 可注入 fake（house style 对齐 Python `_http`）

### R2 信息面分析师亿信预抓
- `BillionsInformationAnalyst`（agents.ts:232）补齐 Python `_prefetch` 语义：
  - `_SEARCH_SOURCES = [announcement, report, web]` 顺序预抓 + twitter 节
  - 真实素材判定「检索结果】」分节标记；失败/空 → 注明不 raise
  - 亿信无素材且 web 开 → 追加 web 回退节（现有逻辑保留）
  - 全部源关且 web 关 → 固定回退文本（现状逐字节不变）
- 开关：`billionsEnabled('SEARCH'/'TWITTER')` 门控（committee.ts 已有）

### R3 mcp 移植 + 接线
- `ts/src/mcp.ts`：`TdxMcpClient` 移植（MCP_URL `https://mcp.tdx.com.cn:3001/mcp`，JSON-RPC 2.0，tdx-api-key 头，session id 透传，SSE 响应解析取首个 result）
- `getMarketIntel(ticker)`：query → 中文摘要文本；失败/无 key/禁用 → 占位（不 raise）
- 开关：`TDX_MCP_DISABLED` / `TDX_MCP_ENABLED` 门控；`TDX_API_KEY` 读取
- 缓存：移植 mcp_intel_cache（非交易时段读缓存）——**简化决策**：TS 无 is_trading_time 完整实现，缓存按 ticker 存 store meta（`mcp:${ticker}`），仅当 trading-hours 开关简化为「今日已查过不重查」或直接每次实时查询？→ **设计决策见 design.md**，默认移植 Python 语义（非交易时段读缓存）

### R4 qfq 生产链接线
- `collectAll` 或 `applyCollectedToStore` 前接入 `qfqAdjust`：xdxr 事件经 `getXdxrInfo` 拉取（live.integration.test.ts:57-63 已有转换先例）
- 修复 W9：`fetchDailyBars` 日期改 `YYYY-MM-DD`（去掉 `.replace(/-/g,'')`），消除 overview volume/amount 恒 NaN

### R5 服务端安全修复
- **C1**：server.mjs serveStatic decodeURIComponent 包 try/catch → 400
- **C2**：proxies.cjs handleLlmProxy——base 只读服务端受信配置（env `LLM_BASE_URL` 优先，忽略客户端 X-LLM-Base/body.base）或 scheme+host 白名单；server.mjs `server.listen(PORT, '127.0.0.1')`（或 HOST env）
- **W2**：/llm-proxy 请求体 64KB 上限（对齐 logs-server）
- **W3**：/logs message/platform 换行净化
- **W4**：/tdx-collect 超时后互斥修正（AbortController 或保持锁到 settle）

### R6 测试
- 亿信客户端：离线 fake fetch 测试（成功/HTTP 非 2xx/success:false/超时语义）
- mcp：SSE 解析单测
- qfq 接线：collectAll→qfq 链测试
- 服务端：畸形 URL 400、body 超限 413、日志净化
- 现有 vitest 全绿 + `tsc --noEmit` 通过

## Acceptance Criteria

- [ ] `ts/src/billionsClient.ts` + `ts/src/mcp.ts` 存在，4 端点 + JSON-RPC 全实现
- [ ] `BillionsInformationAnalyst` 亿信预抓生效（三源 + twitter + web 回退）
- [ ] App.tsx pipeline 注入 `billions` + `mcp`，设置面板开关真实生效
- [ ] collectAll 输出 qfq 前复权 bars，日期 `YYYY-MM-DD`
- [ ] C1/C2/W2/W3/W4 修复，server 畸形 URL 不再崩、无 SSRF、body 上限、日志净化
- [ ] vitest 全绿 + typecheck 通过；新增测试覆盖上述行为

## Notes

- Python 侧代码**只读参考**（billions/client.py、tools/billions_*.py、get_market_intel.py、mcp_intel_cache.py、information_analyst.py），不修改。
- 北交所/akshare 明确不做。
- 亿信 fetch 工具 url 参数校验（security F10）顺带：工具 schema 注明仅 http(s)。
