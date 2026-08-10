# M2 执行计划：编排层移植

工程：`~/soa-ts-prototype`。先装 `@langchain/langgraph` + `@langchain/core`。

## 步骤 1 — 依赖 + 读源码

- `npm i @langchain/langgraph @langchain/core`
- 通读移植源：prompt.py（229 行）、role_registry.py（192 行）、
  agents/base.py（142 行）、tool_loop.py（94 行）、retry.py、
  investment_committee.py（184 行）、web_search.py。

## 步骤 2 — prompt.ts（R1）

- `core/llms/prompt.py` 常量逐字复制：system_prompt 壳 + 各角色 message +
  revise 角色 message（"对抗修订轮的多方/空方交易员"独有短语）+ 经理/
  多空"善用联网搜索"指示。
- `test/prompt.test.ts`：TS 常量 == Python 常量（读 Python 文件解析对比）。

## 步骤 3 — retry.ts + tool_loop.ts（R2/R3）

- invokeWithRetry：错误分类（status 429/5xx、连接/超时）→ 指数退避
  （1s 起 ×3）；业务错误直抛。
- invokeWithTools：15 轮 + 收尾轮（"工具调用轮数已用尽…"中文指令）+
  未知工具占位 + 异常 try/catch 占位 + 计数上限钩子。
- `test/tool_loop.test.ts`：消息序列/降级/截断语义（stub LLM + stub 工具）。

## 步骤 4 — agents.ts（R4）

- AgentNode 类：构造（prompt 壳 + bind_tools 回退 + revise 链）+
  completeExpert / completeWithTools / infoSection + safeProgress/pushReport。
- `test/agents.test.ts`：骨架语义（查询文本、state 返回形状、bind_tools 回退）。

## 步骤 5 — committee.ts（R5/R6）

- ROLES 常量（Role 结构）+ buildEdges + enabledRoles。
- StateGraph 装配：Annotation（messages/bullish_opinions/bearish_opinions
  addMessages）+ 4 阶段节点/边 + 条件信息面节点。
- `test/committee.test.ts`：假 LLM 离线图——join/并行/对抗修订/条件节点。
  **假 LLM 按 system 消息路由**（角色独有短语，对齐 Python 集成测试约定）。

## 步骤 6 — 验收

- `npm test` 全绿 + `tsc --noEmit` 过；AC1-AC7 逐条核。
- 汇报：AC 打勾表 + 与 Python 契约对齐证据（测试名对照）。
