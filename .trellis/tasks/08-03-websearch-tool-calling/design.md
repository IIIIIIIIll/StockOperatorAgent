# Design: Web 搜索工具调用（DuckDuckGo，投资经理 + 多空交易员）

Task: 08-03-websearch-tool-calling · 2026-08-03

## 目标与边界

- 3 个 agent（bullish_trader / bearish_trader / investment_manager）获得工具调用
  型联网搜索；fundamental / trend 两个专家不变（用户拍板）。
- 供应商：仅 DuckDuckGo（用户拍板）——`langchain_community.tools.ddg_search
  .DuckDuckGoSearchResults` + `ddgs` SDK（调研见
  `research/search-provider-comparison.md`）。
- 图拓扑不变（Q3 决议）：**节点内工具循环**——不引入 LangGraph 条件边/
  独立工具节点，保持 5-agent 模板形状与图接线不动（对齐 R6 与 agents spec
  模板约定）。
- 上限（Q4 决议，2026-08-04 修订）：每 agent 节点至多 `_MAX_TOOL_ROUNDS = 10`
  轮工具调用、每查询 `max_results=5`。最坏情况：一次分析 3 agent × 10 轮 =
  30+ 次搜索（每轮可并行多调用，实测 3 个/轮 → 90 次）。原决议 2 轮——
  2026-08-04 真实 DeepSeek 实测 2 轮内不收敛（模型持续要求搜索而非给出
  最终回答），用户拍板放宽至 10（模型自主决定何时收尾，DDG 免费）。

## 架构

### 1. 新依赖（requirements.txt freeze 必须直写，spec gotcha）

- `langchain-community==0.4.2`（已停更但有存量版，research pip dry-run 实测与
  langchain 1.3.14 无冲突；解析出 langchain-classic 1.0.8 传递依赖）
- `ddgs==9.14.4`（DuckDuckGo 官方新 SDK，DuckDuckGoSearchResults 底层用它；
  旧包 duckduckgo-search 已死不可用）

### 2. `core/llms/tools/web_search.py`（新）

- `web_search_enabled() -> bool`：`WEB_SEARCH_DISABLED` 环境变量，判定语义
  逐字对齐 `get_market_intel._mcp_disabled()`（存在且值非 `""`/`"0"`/`"false"`
  /`"no"` → 禁用）。
- `make_web_search_tool(_searcher=None) -> BaseTool`：
  - 默认构造 `DuckDuckGoSearchResults(api_wrapper=DuckDuckGoSearchAPIWrapper(
    region="cn-zh", max_results=5), output_format="json")`——cn-zh 中文财经
    结果实测可用（research 第 3 节）。
  - **降级约定（error-handling spec）**：查询失败/空结果 → 返回占位文本
    `（联网搜索失败：{原因}）`，**不 raise**（模型拿到占位 ToolMessage 继续
    生成）。
  - 结果 JSON → 中文摘要文本（title / url / snippet，news 源含日期）。
  - `_searcher` 注入点（house style 无 mock 框架——测试传 stub 验证成功路径，
    不碰网络）。

### 3. `core/llms/tool_loop.py`（新）

`invoke_with_tools(llm, query: str, config, *, tools, max_tool_rounds=_MAX_TOOL_ROUNDS,
progress_updater=None) -> tuple[AIMessage, list]`

- `messages = [("human", query)]`；循环至多 `max_tool_rounds` 轮：
  1. `response = invoke_with_retry(llm, {"query": messages}, config)`（复用重试
     包装，语义不变）
  2. 无 `response.tool_calls` → 返回 `(response, messages + [response])`
  3. 有：`safe_progress("正在联网搜索…")`；逐条 tool_call 按 name 查工具、
     `tool.invoke(args)` 包 try/except（异常 → 占位文本）；messages 追加
     该 AIMessage（含 tool_calls）+ `ToolMessage(content, tool_call_id)`；
     `safe_progress("联网搜索完成…")`
- 轮数耗尽且模型仍在要工具（2026-08-04 实测场景：2 轮时 DeepSeek 返回
  中间态"让我进一步核实…"）→ **追加一轮"收尾"调用**：附中文指令
  "工具调用轮数已用尽。请基于以上全部信息（包括联网搜索结果）直接给出
  完整、明确的最终回答，不要再调用任何工具。"——模型被强约束为最终轮
  （cost +1 次 LLM 调用/分析，有界），**保证即使轮数用尽也基于已有信息
  给出完整回答**。收尾轮仍带 tool_calls 属病态（指令未遵从），照旧返回
  该响应不阻断（消息已含全部搜索结果）。
- 返回的 messages 列表由节点整体写入 State.messages（add_messages 天然支持
  AIMessage-with-tool_calls + ToolMessage，无需改 State——见下）。

### 4. Agent 变更（3 个文件，模板形状不变）

`bullish_trader.py` / `bearish_trader.py` / `investment_manager.py`：

- 构造器新增可选第 4 参 `tools: list | None = None`（默认 None，既有调用点
  位置兼容）：
  ```python
  if tools:
      try:
          llm = llm.bind_tools(tools)
      except NotImplementedError:
          logger.warning("LLM {} 不支持 bind_tools，跳过工具绑定", type(llm).__name__)
  self.llm = self.prompt | llm
  ```
  **NotImplementedError 回退是硬约束**（已实测 langchain-core 1.5.3
  `FakeListChatModel.bind_tools` 抛 NotImplementedError）——离线图测试
  （`test_graph_parallel.py` 用 `_llm=FakeListChatModel` 跑真实图）靠它保持
  全绿；生产 DeepSeek/Qwen（OpenAI 兼容，支持 function calling）正常绑定。
- 节点方法：`invoke_with_retry(self.llm, {"query": query})` →
  `invoke_with_tools(self.llm, query_text, self.config, tools=self.tools,
  progress_updater=self.progress_updater)`；返回值：
  `{"messages": <loop 全量 messages>, "<state_key>": final.content}`（消息通道
  完整含工具交换）。
- fundamental / trend 专家零改动。

### 5. Committee 接线（`core/investment_committee.py`）

- `tools = [make_web_search_tool()] if web_search_enabled() else None`
- 三个 agent 构造处传 `tools=tools`。禁用时 `tools=None` → 构造路径与现状
  逐字节一致（AC3 由构造保证）。
- 环境变量在**图装配时**判定（与 TDX MCP 在调用时判定不同——工具绑定是
  构造期行为，语义一致：图级开关）。

### 6. Prompt（`core/llms/prompt.py`）

- bullish / bearish "决策要求"各加一行：`- 可使用联网搜索工具验证行业与
  市场论据（如需要）`
- investment_manager 已有"善用联网搜索，验证多头和空头的核心逻辑是否可被
  验证"——保留（本任务后该指示在 DeepSeek 默认路径首次真正可用）。

## 契约与兼容性

- **State 零变更**：工具消息经既有 `messages` 通道回流（add_messages reducer
  处理 AIMessage.tool_calls / ToolMessage 无需改动）；无新 key、无新 reducer。
- **测试兼容**：FakeListChatModel 路径（test_graph_parallel 6 用例）靠
  NotImplementedError 回退保持原行为；`test_committee_enrichment.py:73` 的
  `InvestmentManager(fake, config)` 无 tools 参 → 不触碰 bind_tools。
- **禁用语义**（AC3）：`WEB_SEARCH_DISABLED=1` → committee 不绑定 → 与现状
  完全一致（prompt 里联网指示再次失效，与今天 DeepSeek 路径行为相同，可逆）。
- **无跨层改动**：不碰 data_source / data_storage / data_structure /
  utils.constants / State——cross-layer 风险面为零（仅 agents + core/llms +
  committee + prompts + requirements + tests）。
- **降级链**：DDG 失败 → 占位 ToolMessage → 模型继续（对齐 error-handling
  spec 的"失败返回占位不 raise"约定，与 get_market_intel 同风格）；
  轮数用尽 → 收尾轮保底完整回答（见 §3）。

## 权衡（Trade-offs）

| 决策 | 取舍 |
|---|---|
| 节点内循环 vs 图级工具节点 | 拓扑不变、模板不变、测试零破坏；代价：工具轮次不上图（无 get_state_history 里的工具步骤回放，MVP 可接受） |
| 仅 DDG vs Tavily | 零账号零成本（用户拍板）；代价：community 停更自担维护、质量低于 Tavily、裸端点反爬依赖 ddgs SDK 内部处理（backend auto/html/lite 可切） |
| 绑定期 try/except | 生产全功能、测试自动兼容；代价：禁用期无法在测试里观察到"绑定"路径（用注入 stub 补偿） |

## 运维 / 回滚

- 开关：`WEB_SEARCH_DISABLED=1` 即整体停用（图装配时判定，重启生效）。
- 回滚：特性纯增量（新文件 + 3 agent 构造/节点 + committee 接线 + prompt
  一行 + requirements 两行）；`git revert` 即可，无数据/存储迁移。
- 风险点：ddgs SDK 若被 DDG 反爬升级击穿 → 失败路径已降级为占位文本，图
  不中断；升级路径为切换 backend 或换供应商（调研已备 Tavily 方案）。
