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
  return strings, the reducer wraps them into message lists
- `final_decision` — produced by `investment_manager`
- `messages` — `Annotated[list, add_messages]` conversation channel

Node names in the graph and the `State` keys must stay in sync — the graph wiring
in `investment_committee.py:29-41` maps each node to `agent.<role>_method`.

## Prompt Conventions (`core/llms/prompt.py`)

- All system prompts live in `core/llms/prompt.py`: `system_prompt` (shared shell
  with `{system_message}` and `{current_date}` partials) + one role message per agent.
- Prompts are Chinese. They hard-forbid fabrication ("不允许编造数据"),
  require real-data-backed numbers, and demand specific output structure
  (valuation methods, target prices, scenarios). Keep that style.
- The investment-manager prompt is the only one that references web search —
  matched by `enable_search` in the QwenApi config.

## LLM Configuration (`core/llms/qwen/qwen_api.py`)

`QwenApi` subclasses `langchain_openai.ChatOpenAI`:

- `model="qwen-plus-latest"`, `base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"`
- `api_key=os.getenv("DASHSCOPE_API_KEY")` — from `.env`
- `extra_body` sets `enable_search` (and optionally `enable_thinking`); `seed=114514`

Use `QwenApi` everywhere; do not construct a second model/client for agent calls.

## Tool (`core/llms/tools/get_company_info.py`)

`get_stock_info(ticker) -> str` wraps `DataAcquisition.get_stock_data` +
`StockOutputFormatter.format_stock_output`. It is the only function passed to
agents as a callable and the only place that raises on a missing stock.

## Anti-Patterns

- Breaking the uniform constructor signature — committee wiring and the UI pass
  `(llm, config, progress_updater)` positionally.
- Adding agent logic outside the node method or mutating `state` in place (return
  the update dict instead).
- Writing new prompts into agent files — they belong in `core/llms/prompt.py`.
- Returning a raw string into a `State` key that downstream code indexes with
  `[-1].content` without checking the reducer type first.
