---
description: LangGraph agent pattern, prompt conventions, QwenApi, and the State contract
paths:
  - agents/**
  - core/llms/**
  - utils/state.py
---

# Agents (`agents/`, `core/llms/`)

## The Agent Class Template

All five agents (`fundamental_analysis_expert.py`, `trend_analysis_expert.py`,
`bullish_trader.py`, `bearish_trader.py`, `investment_manager.py` in
`agents/chinese_mainland/`) are near-identical classes. **Copy the existing shape
when adding an agent — do not redesign it.** The pattern:

1. **Constructor** — `__init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater=None)`:
   - `ChatPromptTemplate.from_messages([("system", system_prompt), MessagesPlaceholder(variable_name="query")])`
   - `self.prompt = self.prompt.partial(system_message=<role_message>)`
   - `self.prompt = self.prompt.partial(current_date=get_last_business_day(datetime.date.today()))`
   - `self.llm = self.prompt | llm`
   - store `config` and `progress_updater`
2. **Node method** — named after the role, takes `(self, state: State)`, builds a
   Chinese human query from `state` (see `core/llms/prompt.py` for the system
   messages), invokes `self.llm.invoke({"query": query}, config=self.config)`,
   reports progress via `progress_updater.info("...")`, and returns a state-update
   dict: `{"messages": [query[0], response], "<state_key>": response.content}`.

Reference: any of the five agents, plus their wiring in
`core/investment_committee.py` and single-agent test graphs in
`test/integration/test_basic_graph.py` (which use `dummy_*` fixtures to isolate
downstream agents from live LLM calls).

## The State Contract (`utils/state.py`)

`State` is a `TypedDict`; keys are read by every agent:

- `target_stock_ticker`, `stock_information` — seeded by the caller (committee/UI)
- `fundamental_analysis`, `trend_analysis` — produced by the first two nodes
- `bullish_opinions`, `bearish_opinions` — `Annotated[list, add_messages]`: agents
  return strings, the reducer wraps them into message lists（2026-08-02 升级
  langgraph 0.6.7 → 1.2.10 实测：reducer 对初始输入的应用行为在 1.x 不变，
  节点内读取恒为消息列表——集成测试钉死）
- `final_decision` — produced by `investment_manager`
- `messages` — `Annotated[list, add_messages]` conversation channel

`investment_manager` 读取观点时取 `state['bullish_opinions'][-1].content` /
`bearish_opinions[-1].content`（2026-08-02 修复：原插值整个列表 repr，prompt
里是 `[HumanMessage(...)]` 元数据而非观点正文）。

Node names in the graph and the `State` keys must stay in sync — the graph wiring
in `investment_committee.py:29-41` maps each node to `agent.<role>_method`.

## Prompt Conventions (`core/llms/prompt.py`)

- All system prompts live in `core/llms/prompt.py`: `system_prompt` (shared shell
  with `{system_message}` and `{current_date}` partials) + one role message per agent.
- Prompts are Chinese. They hard-forbid fabrication ("不允许编造数据"),
  require real-data-backed numbers, and demand specific output structure
  (valuation methods, target prices, scenarios). Keep that style.
- The investment-manager prompt references web search — matched by
  `enable_search` in the QwenApi config only. **DeepSeek 不支持该参数**（DashScope
  私有扩展），默认路径下该指示失效，agent 无法联网；如需联网分析可切回 QwenApi。

## LLM Configuration (`core/llms/`)

**默认 DeepSeek**（`core/llms/deepseek/deepseek_api.py`）：
`DeepSeekApi(ChatOpenAI)` — `model=os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")`
（可切 `deepseek-v4-pro`）、`api_key=os.getenv("DEEPSEEK_API_KEY")`、
`base_url="https://api.deepseek.com"`、`seed=114514`；不传 `extra_body`。
无 key 时构造即抛 OpenAIError（与 QwenApi 一致），UI 层 display.py 渲染前
**只检查 `DEEPSEEK_API_KEY`**（2026-08-02 修复：检查与实现对齐——图装配永远
构造 DeepSeekApi，只配 DASHSCOPE 时放行即崩溃）。

**可选 Qwen**（`core/llms/qwen/qwen_api.py`）：`QwenApi` 同上形状 —
`model="qwen-plus-latest"`、`base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"`、
`api_key=os.getenv("DASHSCOPE_API_KEY")`；`extra_body` 传 `enable_search`。

图装配（`core/investment_committee.py`）用 `DeepSeekApi()`；换回 Qwen 只需改这一行。

**依赖版本（2026-08-02 升级 0.3/0.6 → 1.x）**：langchain 1.3.14 /
langchain-core 1.5.3 / langchain-openai 1.4.1 / langgraph 1.2.10 /
langgraph-checkpoint 4.1.1 / langgraph-prebuilt 1.1.0 / langgraph-sdk 0.4.2 /
langsmith 0.10.15 / openai 2.52.0（传递）。代码零改动，全量回归 116 passed
（含 graph streaming / reducer / get_state_history 集成测试）。**Gotcha**：
requirements.txt 是全量 freeze，但曾漏 pin 直接导入的包（langchain /
langchain-openai / openai 缺失——fresh `pip install -r requirements.txt` 会
缺 `langchain_openai`）；更新依赖时确保**直接 import 的包**也在 freeze 中，
不能只靠传递依赖。升级 langgraph 大版本后先跑 test/integration（reducer
行为是 0.x → 1.x 最大风险面）。


## Tools (`core/llms/tools/`)

- `get_company_info.py` — `get_stock_info(ticker) -> str` wraps
  `DataAcquisition.get_stock_data` + `StockOutputFormatter.format_stock_output`.
  The only place that raises on a missing stock.
- `get_trend_indicators.py` — `get_trend_indicators(ticker) -> str`：ZODB 日K →
  vendored `compute_all`（通达信口径 MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比）→ 最近
  一根 bar 中文摘要。无数据返回占位文本，不 raise。vendor 导入需先调用
  `data_source...tdx_source.ensure_vendor_on_path()`（见 data_source spec）。
- `get_market_intel.py` — `get_market_intel(ticker) -> str`：TDX MCP 实时情报
  （概念/资金流/大盘）。无 `TDX_API_KEY` 或查询失败返回占位文本，不 raise。
- 三者均不直接传给 agent 作为 callable——在 `make_investment_decision` 图前
  拼接进 `stock_information`（见 core spec）。

## Anti-Patterns

- Breaking the uniform constructor signature — committee wiring and the UI pass
  `(llm, config, progress_updater)` positionally.
- Adding agent logic outside the node method or mutating `state` in place (return
  the update dict instead).
- Writing new prompts into agent files — they belong in `core/llms/prompt.py`.
- Returning a raw string into a `State` key that downstream code indexes with
  `[-1].content` without checking the reducer type first.
