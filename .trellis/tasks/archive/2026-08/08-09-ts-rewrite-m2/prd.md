# M2 编排层：LangGraph JS committee + tool loop + prompt 移植

## Goal

用 `@langchain/langgraph`（JS 官方移植）装配投资委员会图，移植 prompt /
retry / tool_loop / AgentNode / 角色注册表，语义对齐 Python 版
（agents spec 契约）。离线图测试（假 LLM）钉死 join/并行/对抗修订/收尾轮。

## Requirements

- **R1 prompt 逐字移植**：`core/llms/prompt.py` 全部系统提示词 → `src/prompt.ts`
  （中文、禁编造硬约束、角色独有路由短语逐字保留——离线测试按 system 消息路由）。
- **R2 retry**：`invokeWithRetry`——429/5xx/连接/超时指数退避 3 次；业务错误直抛。
- **R3 tool_loop**：`invokeWithTools`——15 轮上限 + 收尾轮 + 未知工具占位 +
  工具异常不阻断 + 每 run 调用上限（对齐 Python tool_loop.py 契约）。
- **R4 AgentNode**：prompt 壳（system + messages placeholder）、bind_tools
  回退（NotImplementedError → 不绑定）、revise 第二条链、completeExpert /
  completeWithTools 骨架、safe_progress / push_report 事件协议。
- **R5 角色注册表 + 图装配**：`ROLES`（node_name/state_key/tab_title/kind/
  opinion/enabled 谓词/factory/revise）TS 常量 → StateGraph 4 阶段装配
  （START → 专家∥ → 多空初稿 N 入边 join → 对抗修订双入边 join → 经理
  [-1] 读修订版 → END）+ 条件信息面节点。
- **R6 State 契约**：`messages`/`bullish_opinions`/`bearish_opinions`
  addMessages reducer；`information_analysis` 条件存在（state.get() 容错）；
  并行分支写不同 key。

## Acceptance Criteria

- [ ] **AC1** 离线图测试（假 LLM）绿：三专家并行 join → 多空初稿（N 入边）
      → 对抗修订（读对方初稿、追加写 opinions key）→ 经理读 `[-1]` 修订版
      → END；消息通道含工具交换（AIMessage.tool_calls + ToolMessage）。
- [ ] **AC2** 条件信息面节点：启用谓词开 → 注册（4 专家 + 第 4 入边）；
      关 → 完全不注册（图结构与 Python 逐字节一致语义）。
- [ ] **AC3** tool_loop 契约：轮数耗尽追加收尾轮（模型被强约束不再调工具）；
      未知工具 → 占位 ToolMessage；工具异常 → 占位不 raise；空 tools → 单轮直调。
- [ ] **AC4** retry：429/5xx/超时重试 3 次指数退避；400/认证直抛零延迟。
- [ ] **AC5** bind_tools 回退：不支持 bind_tools 的 LLM → warning + 不绑定，
      专家直调、工具角色有工具时正常绑定。
- [ ] **AC6** prompt 逐字一致：TS prompt 文本 == Python prompt.py 常量
      （diff 级对比测试，删除一行即 FAIL）。
- [ ] **AC7** `tsc --noEmit` + 全部 vitest 绿。

## Constraints

- **C1** 本任务不接真实 LLM（M3 端到端）；图装配 `_llm` 注入点保留
      （对齐 Python house style）。
- **C2** 搜索/亿信工具在 M2 做**可注入工厂**：默认 Tavily（真实 HTTP fetch，
      复用已配 key）；`_searcher` 注入点保留（对齐 Python make_web_search_tool）。
- **C3** 事件协议（progress/report/error/done）形状对齐 Python ProgressBridge，
      M3 接 UI。
- **C4** 语义对齐优先于行数对齐：图 join 语义/State 形状是契约，代码组织可不同。

## Notes

- 参考：`.trellis/spec/agents/index.md`（agent 模板/State/工具循环契约）、
  `.trellis/spec/core/index.md`（InvestmentCommittee 节）、父任务 design.md。
- Python 移植源：`agents/base.py`、`core/role_registry.py`、
  `core/llms/{prompt,tool_loop,retry}.py`、`core/investment_committee.py`、
  `core/llms/tools/web_search.py`。

## 验收结果（2026-08-09）

- [x] **AC1** `test/committee.test.ts`（假 LLM 按 system 消息路由）：三专家
      并行 join → 多空初稿 N 入边 → 对抗修订双入边（读对方初稿、追加写
      opinions key）→ 经理读 `[-1]` 修订版 → END；消息通道含
      AIMessage.tool_calls + ToolMessage 工具交换。
- [x] **AC2** 条件信息面节点：启用谓词开 → 注册（4 专家 + 第 4 入边）；关 →
      完全不注册（committee.test.ts 离线钉死）。
- [x] **AC3** `test/tool-loop.test.ts`：轮数耗尽追加收尾轮、未知工具 → 占位
      ToolMessage、工具异常不 raise、空 tools 单轮直调。
- [x] **AC4** `test/retry.test.ts`：429/5xx/超时重试 3 次指数退避；400/认证
      直抛零延迟。
- [x] **AC5** `test/agents.test.ts`：bind_tools 回退 → warning + 不绑定。
- [x] **AC6** `test/prompt.test.ts` + `fixtures/prompts.json`：TS prompt 与
      Python prompt.py 常量 diff 级对比（删除一行即 FAIL）。
- [x] **AC7** `tsc --noEmit` 干净 + vitest 全绿。
- 搜索工具为可注入工厂（Tavily 默认，`test/web-search.test.ts`），`_searcher`
  注入点保留（C2 满足）；事件协议形状对齐 ProgressBridge（M3 接 UI）。
