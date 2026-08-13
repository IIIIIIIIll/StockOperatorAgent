---
description: Agents — 导航 + State 契约 + prompt 约定 + 反模式；子规范: 模板/LLM 配置/工具
paths:
  - agents/**
  - core/llms/**
  - utils/state.py
  - core/role_registry.py
---
# Agents (`agents/`, `core/llms/`)

## Layer Specs

| Topic | Spec | When to read |
|-------|------|--------------|
| Agent 模板与对抗修订轮（`agents/base.py`、7 个 agent） | [agent-template.md](./agent-template.md) | Writing or editing an agent node method or the revise round |
| LLM 配置（`core/llms/llm_factory.py`、`retry.py`） | [llm-config.md](./llm-config.md) | Changing the LLM factory, retry policy, or dependency versions |
| 工具调用循环与 Tools（`core/llms/tool_loop.py`、`core/llms/tools/`） | [tools.md](./tools.md) | Editing bind_tools tools, the tool loop, or the information analyst |

## The State Contract (`utils/state.py`)

`State` is a `TypedDict`; keys are read by every agent:

- `target_stock_ticker`, `stock_information` — seeded by the caller (committee/UI)
- `fundamental_analysis`, `trend_analysis`, `technical_indicator_analysis` —
  produced by the first three nodes（08-08-technical-indicator-analyst）
- `information_analysis` — 信息面分析师产出（08-08-billions-api-integration，
  条件节点：ANALYST 开关关时 key 不存在，读方必须 `state.get()` 容错——
  trader/manager 查询插值用条件段，缺失时查询与改动前逐字节一致）
- `bullish_opinions`, `bearish_opinions` — `Annotated[list, add_messages]`: agents
  return strings, the reducer wraps them into message lists（2026-08-02 升级
  langgraph 0.6.7 → 1.2.10 实测：reducer 对初始输入的应用行为在 1.x 不变，
  节点内读取恒为消息列表——集成测试钉死）
- `final_decision` — produced by `investment_manager`
- `messages` — `Annotated[list, add_messages]` conversation channel

`investment_manager` 读取观点时取 `state['bullish_opinions'][-1].content` /
`bearish_opinions[-1].content`（2026-08-02 修复：原插值整个列表 repr，prompt
里是 `[HumanMessage(...)]` 元数据而非观点正文）。08-04-adversarial-verdict-
loop 起 opinions 列表含初稿 + 修订版（revise 追加写原 key）——`[-1]` 恒为
最新一版（manager 零改动读修订版），初稿保留供 UI 展示对抗过程。

Node names, `State` keys, Tab 标题与启用谓词的**单一事实源是
`core/role_registry.py`**（08-09-role-registry）——`ROLES` 每条 Role 携带
node_name / state_key / tab_title / kind / opinion / enabled 谓词 /
factory / revise_node_name；图装配（`investment_committee.py` 的
`make_investment_committee`）与 UI 渲染（`display.report_tabs` /
`OPINION_REPORT_KEYS`）都从注册表读取。新增 agent = 加一条 Role + 一个
prompt（外加 State 注解——一致性由 `test/core/test_role_registry.py` 双向
断言钉死）。信息面分析师的启用谓词（08-10-web-search-fallback 起：ANALYST
能力开关开 且（SEARCH/TWITTER 至少一者开 或 联网搜索开）——ANALYST 段用
`billions_cap_switch`（无主闸 key 约束），无 key + web 开同样注册，预抓走
DDG 兜底）在注册表单点定义，装配与 Tab 共用。**不要**在 committee/display
里再手写条件接线。

## Prompt Conventions (`core/llms/prompt.py`)

- All system prompts live in `core/llms/prompt.py`: `system_prompt` (shared shell
  with `{system_message}` and `{current_date}` partials) + one role message per agent.
- Prompts are Chinese. They hard-forbid fabrication ("不允许编造数据"),
  require real-data-backed numbers, and demand specific output structure
  (valuation methods, target prices, scenarios). Keep that style.
- 联网指示（08-03-websearch-tool-calling）：investment_manager 的"善用联网
  搜索"与 bullish/bearish 的"可使用联网搜索工具验证行业与市场论据"指示，
  经 **bind_tools 工具调用真实生效**（OpenAI 兼容 function calling）——
  不再依赖供应商私有扩展（如 DashScope enable_search）；`WEB_SEARCH_DISABLED`
  可整体停用（见 [tools.md](./tools.md) Tools 段）。

## Anti-Patterns

- Breaking the uniform constructor signature — committee wiring and the UI pass
  `(llm, config, progress_updater)` positionally（08-03 起工具角色可带可选
  第 4 参 `tools=None`——默认 None 保持位置兼容，仅 committee 传，见模板段）。
- Adding agent logic outside the node method or mutating `state` in place (return
  the update dict instead).
- Writing new prompts into agent files — they belong in `core/llms/prompt.py`.
- Returning a raw string into a `State` key that downstream code indexes with
  `[-1].content` without checking the reducer type first.
