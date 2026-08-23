---
description: LLM agent 编排与工具循环(agents/committee/toolLoop/llm/prompt/overview/mcp/webSearch/billions)+ 能力接线
paths:
  - src/agents.ts
  - src/committee.ts
  - src/toolLoop.ts
  - src/llm.ts
  - src/prompt.ts
  - src/overview.ts
  - src/mcp.ts
  - src/webSearch.ts
  - src/billionsClient.ts
  - src/billionsTools.ts
  - src/reports.ts
---

# LLM Agent、工具循环与能力接线

## 工具调用循环(src/toolLoop.ts,08-11-ts-streaming-output)

`invokeWithTools` 移植自 Python core/llms/tool_loop.py:

- **MAX_TOOL_ROUNDS = 15**;轮数耗尽且模型仍在要工具 → 追加"收尾轮"
  (FINAL_ROUND_INSTRUCTION 强约束"不要再调用任何工具",直接给最终回答)。
- **收尾轮非合规兜底(AL2,2026-08-23)**:收尾轮不执行任何工具(执行突破
  「有界 +1 次」上界);仍返回 tool_calls 或 content 经 String().trim() 归一
  后为空 → logError 后以两态占位文案替代 response.content(「搜索轮数已用尽，
  未能生成最终回答」/「（本轮未产出结论）」,常量导出于 toolLoop 单源),
  messages 保持真实轨迹;`closingFallback` 标记随结果返回,completeWithTools
  据此把 roleStatus 终态置 'retry'(不再无条件 'done'),轮内早退的空串报告
  同样占位。
- 每轮(含收尾轮)改 `streamWithRetry` 流式;轮末 `tool_calls` 非空 →
  `onReset()` 回滚该轮已流出文本(UI 经 roleStatus 'retry' 清 partial);
  工具异常 → 占位不 raise(图不中断);未知工具占位;空 tools → 单轮直调。
- messages 以 `('human', query)` tuple 起始,后续追加 AIMessage/ToolMessage
  对象;`onDelta` 逐 chunk 透传、`onRetry(attempt, err)` 退避前回调、轮末
  `warn('工具轮 N:模型请求工具 X,回滚该轮中间文本')`。
- ToolLike 可选 `schema`/`description`(bindTools 序列化用,现有 fake/调用方
  零改动)。

## 能力接线(08-13-ts-capability-completion;Python phase out 后唯一实现)

TS 是最终唯一实现,各能力必须有**生产接线点**(防"开关存在但无效果"):

- **亿信(billions)**:`src/billionsClient.ts`(REST 4 端点,对齐 Python
  client.py:POST + X-API-KEY、BillionsApiError 归一化、不重试、超时档位
  fin_db 120s / search+twitter 25/70/120 / fetch 90s)+
  `src/billionsTools.ts`(search/twitter/fetch 三件套 LLM 工具,开关关/
  无 key → undefined 不绑定,调用硬上限 search 3 / twitter 2 / fetch 3,
  env `BILLIONS_{CAP}_MAX_CALLS` 可覆盖;settings.caps 三值经
  `assembleTools` → `maxCallsByCap` 注入**优先于 env**,非法值(NaN/<=0/
  非数字)回退 env/默认)+ agents.ts 信息面分析师预抓(三源
  announcement/report/web + twitter)。**key 在 web 端 localStorage**:
  客户端/工具经 `apiKey` 构造注入(不读 process.env——Metro 不内联非
  EXPO_PUBLIC 变量)。接线(U13 抽取后编排进 app/lib/analysisController,
  App.tsx 为纯渲染层不再接线):app/lib/runner.ts `makeBillionsIntel`(intel
  预查询)+ `assembleTools`(委员会工具)由 useAnalysis.ts 经控制器 deps
  注入;预抓 client 注入(useAnalysis deps `makeBillionsClient` 构造:key
  存在 → 带 key 的 `BillionsClient`,否则 undefined 零网络 →
  analysisController.start 组装 → runner.run 的 `billionsClient` →
  events.ts RunOptions → committee `deps.billionsClient`(informationAnalyst
  工厂透传)→ 分析师构造第 5 参;缺省 → 分析师内部无 key client 回退,
  亿信路径静默关闭、DDG 兜底)。**安全**:key 仅存 client
  私有字段——不落日志、不经服务端代理(浏览器端直连现状,不新增代理路由)。
- **mcp 实时情报**:`src/mcp.ts`(`TdxMcpClient`:JSON-RPC 2.0 + tdx-api-key
  + Mcp-Session-Id 透传 + SSE 响应解析取首个 result;`getMarketIntel`:
  TDX_MCP_DISABLED/ENABLED 门控 + 无 key 占位 + 中文摘要 ≤10 行)。**不做
  缓存**(TS 无 is_trading_time 移植,每次实时查询)。接线:app/lib/runner.ts
  `makeMcpIntel` → useAnalysis.ts fetchIntel deps 注入(仅 cn 消费,S4)。
- **qfq 前复权 / 采集 freshness 门 / 北交所**:见
  [tdx-data.md](./tdx-data.md);北交所/akshare 明确不支持(用户决策
  08-13,App.tsx 入口拦截报错)。

## 个股概览(src/overview.ts)

`composeOverview` 移植自 data_source/chinese_mainland/tdx/overview.py:
22 列由 snapshot/capital/F10/日K 合成,**纯函数**(不访问网络);NaN 语义逐项
对齐(pytdx 无字段:量比/涨速/5分钟涨跌 → NaN;`divide` 对缺失/≤0 分母 →
NaN,PE/PB 分母 ≤0 同约定);`LOT_SIZE = 100`(手 → 股);
`latestPeriodValue(f10, metric)` 取 F10 **最新报告期**(period 字典序最大)的
value_num。键名说明(C4 决策):TS 键 `amount/open_/prev_close/
change_percent_60d` 对应 Python StockOverview 的 `turnover/open/
previous_close/change_percent_60days`——4 键更名仅为 TS 内部一致性,消费方
全部读 TS 键,值语义与 Python 逐项一致。
