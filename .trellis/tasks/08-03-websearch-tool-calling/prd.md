# Add web search tool-calling capability to agents

## Goal

让**投资经理 + 多头/空头交易员**三个 agent 获得**工具调用型（tool-calling）**
联网搜索能力：agent 在分析中自行决定是否搜索，搜索结果作为消息回流参与生成
（用户拍板 tool-calling 风格；工具范围为投资经理 + 多空交易员）。当前默认
DeepSeek 路径下 agent 完全无法联网——`prompt.py:121` 的"善用联网搜索"指示
仅 QwenApi `enable_search` 生效（`.trellis/spec/agents/index.md:75-76`）；本任务
让该指示在默认路径下首次真实可用，且可观测、可降级、可开关。

## Background（代码/规格证据，2026-08-03 检查）

- Agent 模板：`self.llm = self.prompt | llm` 纯链，全仓无 `bind_tools`/`@tool`；
  5 agent 近同构，节点方法 `(self, state) -> dict`；prompt 在 `core/llms/prompt.py`
  （bullish/bearish 无联网指示，investment_manager 已有）。
- 图拓扑（`core/investment_committee.py:61-93`）：StateGraph(State)，
  START 并行 → fundamental/trend → bullish/bearish → investment_manager → END；
  默认 `DeepSeekApi()`（function calling 支持，无搜索参数）。
- `State.messages` 已是 `Annotated[list, add_messages]`——tool 消息可回流，
  State 零改动。
- 依赖：langchain 1.3.14 / langgraph 1.2.10 / langgraph-prebuilt 1.1.0；
  langchain-core 1.5.3 `FakeListChatModel.bind_tools` 实测抛
  NotImplementedError（离线图测试用 `_llm=FakeListChatModel` 跑真实图）。
- 降级风格（error-handling spec）：工具失败返回占位文本不 raise
  （`get_market_intel.py` 先例）；环境开关风格：`TDX_MCP_DISABLED` 判定语义。
- 供应商调研（`research/search-provider-comparison.md`，含来源与项目机器
  实测）：仅 DDG 候选可用且零成本；community 已停更（自担维护）；
  Bing 已退役、Baidu 反爬墙、Exa 中文覆盖无证据；Tavily 质量最优但需账号。
- 全量回归基线（2026-08-03 实测）：`pytest test/` → **220 passed, 20 skipped**。
- 网络实测：ddgs SDK 中文财经查询（cn-zh text/news）成功。

## Requirements

- R1: 三个 agent（投资经理 + 多空交易员）获得真实联网搜索能力，**默认
  DeepSeek 路径**可用，不依赖 DashScope enable_search。
- R2: tool-calling 风格——agent 经 LLM 工具调用决定搜索（bind_tools + 节点内
  工具循环，图拓扑与 5-agent 模板形状不变），搜索结果以消息形式回流。
- R3: 供应商 = **仅 DuckDuckGo**（用户拍板）：`langchain-community` 0.4.2 的
  `DuckDuckGoSearchResults` + `ddgs` SDK，cn-zh 中文财经查询（理由与代价见
  research 文件与 design 权衡表）。
- R4: 降级链：DDG 失败/空 → 占位文本 ToolMessage → 模型继续（不 raise 打断
  图）；每 agent 至多 10 轮工具调用、每查询 5 条结果；轮数用尽后追加一轮
  "收尾"调用（指令不再允许工具），要求模型基于已有搜索结果给出完整最终
  回答（2026-08-04 用户拍板；仍不收敛属病态，返回最后一次响应不阻断）。
- R5: 可开关：`WEB_SEARCH_DISABLED` 环境变量（对齐 TDX_MCP_DISABLED 语义，
  图装配时判定，可逆）；禁用后行为与现状一致。
- R6: 兼容既有测试与架构：FakeListChatModel 离线图测试靠 bind_tools
  NotImplementedError 回退保持全绿；不破坏 State 契约、模板形状、既有
  降级/重试约定（复用 `invoke_with_retry`）。

## Acceptance Criteria

- [ ] AC1: 默认配置（DeepSeek）下 agent 分析中可发起真实联网搜索，搜索结果
      出现在生成输入中（`make_web_search_tool()` 直接调用实测 + 图级验证）。
- [ ] AC2: 搜索失败/禁用/超限时图正常完成（占位文本，不 raise）。
- [ ] AC3: `WEB_SEARCH_DISABLED` 设置后不绑定工具，行为与现状一致。
- [ ] AC4: 全量回归 ≥ 基线（220 passed / 20 skipped）+ 新测试全绿
      （先停运行中的应用，ZODB flock）。
- [ ] AC5: 设计文档成文（design.md 含架构/兼容/权衡/回滚；供应商理由引用
      research 文件）。

## Out of Scope

- 不改造 fundamental / trend 专家（无工具）、不改既有 pre-fetch 工具
  （get_market_intel 等）、不引入第二供应商/自动切换、不建搜索缓存
  （MVP 不加）。
- 不改 `utils/state.py` 与 data_source / data_storage / data_structure 层。

## Open Questions

无阻塞项。（Q1 供应商=仅 DDG、Q2 范围=投资经理+多空交易员：用户已拍板；
Q3 节点内循环拓扑、Q4 次数上限：design.md 技术决议。）

## 关键决策记录

| 决策 | 结论 | 出处 |
|---|---|---|
| 供应商 | 仅 DuckDuckGo（零账号零成本；自担 community 停更维护） | Q1 用户拍板 2026-08-03；research §4 |
| 工具范围 | 投资经理 + 多头/空头交易员（论证/验证角色） | Q2 用户拍板 2026-08-03 |
| 图拓扑 | 节点内工具循环（bind_tools + invoke_with_tools 助手），拓扑/模板不变 | design.md §3-4 |
| 上限 | 10 轮/agent、5 条/查询（2026-08-04 实测 2 轮不收敛后用户拍板放宽；每轮可并行多调用，最坏 30-90 次搜索/分析；轮数用尽追加收尾轮保底完整回答） | design.md §1 |
| 测试兼容 | bind_tools NotImplementedError 回退（FakeListChatModel 实测） | design.md §4 |
