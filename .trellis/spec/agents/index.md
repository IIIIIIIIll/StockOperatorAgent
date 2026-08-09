---
description: LangGraph agent pattern, prompt conventions, QwenApi, and the State contract
paths:
  - agents/**
  - core/llms/**
  - utils/state.py
---

# Agents (`agents/`, `core/llms/`)

## The Agent Class Template

All six agents (`fundamental_analysis_expert.py`, `trend_analysis_expert.py`,
`technical_indicator_analyst.py`, `bullish_trader.py`, `bearish_trader.py`,
`investment_manager.py` in `agents/chinese_mainland/`) are near-identical
classes. **Copy the existing shape when adding an agent — do not redesign it.**
The pattern:

1. **Constructor** — `__init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater=None, tools: list | None = None)`:
   - `ChatPromptTemplate.from_messages([("system", system_prompt), MessagesPlaceholder(variable_name="query")])`
   - `self.prompt = self.prompt.partial(system_message=<role_message>)`
   - `self.prompt = self.prompt.partial(current_date=get_last_business_day(datetime.date.today()))`
   - **可选工具绑定（08-03-websearch-tool-calling）**——三个工具角色
     （bullish/bearish/investment_manager）由 committee 传 `tools`；构造时
     `llm.bind_tools(tools)` 包 **NotImplementedError 回退**（硬约束：
     langchain-core 1.5.3 `FakeListChatModel.bind_tools` 实测抛
     NotImplementedError——离线图测试靠它保持全绿；生产 DeepSeek/Qwen
     OpenAI 兼容路径正常绑定）。fundamental/trend 两专家不传，保持直调：
     ```python
     if tools:
         try:
             llm = llm.bind_tools(tools)
         except NotImplementedError:
             logger.warning("LLM {} 不支持 bind_tools，跳过工具绑定", type(llm).__name__)
     self.llm = self.prompt | llm
     ```
   - store `config` and `progress_updater`（工具角色另存 `self.tools = tools or []`）
2. **Node method** — named after the role, takes `(self, state: State)`, builds a
   Chinese human query from `state` (see `core/llms/prompt.py` for the system
   messages), invokes **`invoke_with_retry(self.llm, {"query": query},
   config=self.config)`**（2026-08-02，review #6——见下方重试约定；三个专家
   fundamental/trend/technical_indicator_analyst 保持此直调；三个工具角色
   bullish/bearish/
   investment_manager 改用 **`invoke_with_tools`**——08-03-websearch-tool-
   calling，见下方"工具调用循环"段，返回 `(final, 全量 messages)`），reports
   progress via **`safe_progress(self.progress_updater, "...")`**
   （2026-08-02，`core/llms/progress.py`——并行节点运行在 LangGraph 工作
   线程，Streamlit DeltaGenerator 只能在脚本线程 enqueue，工作线程 info()
   抛 NoSessionContext 会把分析打崩；safe_progress 降级为 debug 日志），
   **`push_report(self.progress_updater, "<state_key>", response.content)`**
   （2026-08-02，queue bridge——LLM 返回后即推送报告，display 节点级
   即时填充；None/非 bridge updater 为 no-op，superstep update 兜底
   渲染），and returns a state-update
   dict: `{"messages": [query[0], response], "<state_key>": response.content}`.
   工具角色返回 `{"messages": <invoke_with_tools 全量 messages>,
   "<state_key>": final.content}`——消息通道完整含工具交换（AIMessage
   with tool_calls + ToolMessage）。
   UI 路径的 `progress_updater` 是 **`ProgressBridge`**（core/llms/progress.py，
   `info`/`push_report` 线程安全入队，脚本线程消费后渲染；离线图测试可传
   `_ThrowingUpdater` 验证 safe_progress 降级——详见 core spec Streamlit
   UI 段）。

Reference: any of the five agents, plus their wiring in
`core/investment_committee.py` and single-agent test graphs in
`test/integration/test_basic_graph.py` (which use `dummy_*` fixtures to isolate
downstream agents from live LLM calls).

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
断言钉死）。信息面分析师的启用谓词（ANALYST 开且 SEARCH/TWITTER 至少一
者开）在注册表单点定义，装配与 Tab 共用。**不要**在 committee/display 里
再手写条件接线。

## Prompt Conventions (`core/llms/prompt.py`)

- All system prompts live in `core/llms/prompt.py`: `system_prompt` (shared shell
  with `{system_message}` and `{current_date}` partials) + one role message per agent.
- Prompts are Chinese. They hard-forbid fabrication ("不允许编造数据"),
  require real-data-backed numbers, and demand specific output structure
  (valuation methods, target prices, scenarios). Keep that style.
- 联网指示（08-03-websearch-tool-calling）：investment_manager 的"善用联网
  搜索"与 bullish/bearish 的"可使用联网搜索工具验证行业与市场论据"指示，
  默认 DeepSeek 路径下经 **bind_tools 工具调用真实生效**（OpenAI 兼容
  function calling）——不再是 QwenApi `enable_search`（DashScope 私有扩展）
  专属；`WEB_SEARCH_DISABLED` 可整体停用（见 Tools 段）。历史：该指示曾仅
  QwenApi enable_search 生效、DeepSeek 默认路径失效。

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

**LLM 调用重试（2026-08-02，review #6）**：节点 invoke 统一走
`core/llms/retry.py` 的 `invoke_with_retry(llm, payload, config)`——
可恢复错误（429 限流 / 500/502/503/504 / APIConnectionError / 超时）
指数退避重试 3 次（1s 起，上限 8s）；业务错误（400/认证）直抛零延迟；
耗尽后 reraise 原异常（既有 UI 守护行为不变）。判定用
`openai.APIStatusError.status_code` + 连接/超时类型（openai 2.x 构造
测试异常需真实 httpx.Response）。新增 agent 节点沿用同一包装。

**依赖版本（2026-08-02 升级 0.3/0.6 → 1.x）**：langchain 1.3.14 /
langchain-core 1.5.3 / langchain-openai 1.4.1 / langgraph 1.2.10 /
langgraph-checkpoint 4.1.1 / langgraph-prebuilt 1.1.0 / langgraph-sdk 0.4.2 /
langsmith 0.10.15 / openai 2.52.0（传递）。代码零改动，全量回归 116 passed
（含 graph streaming / reducer / get_state_history 集成测试）。**Gotcha**：
requirements.txt 是全量 freeze，但曾漏 pin 直接导入的包（langchain /
langchain-openai / openai 缺失——fresh `pip install -r requirements.txt` 会
缺 `langchain_openai`）；更新依赖时确保**直接 import 的包**也在 freeze 中，
不能只靠传递依赖。升级 langgraph 大版本后先跑 test/integration（reducer
行为是 0.x → 1.x 最大风险面）。**Gotcha（08-03-websearch-tool-calling）**：
`langchain-community==0.4.2`（已停更自担维护）的 `DuckDuckGoSearchResults`
**只能从顶层 `langchain_community.tools` 导入**——子包
`tools.ddg_search.__init__` 只 re-export 旧名 `DuckDuckGoSearchRun`（实测
ImportError）；community 0.4.2 依赖声明不含 `ddgs`（惰性导入）——fresh
环境必须显式 pin `ddgs==9.14.4`（旧包 duckduckgo-search 已死不可用）；
`langchain-classic==1.0.8` 为传递依赖一并 freeze。

## 工具调用循环（08-03-websearch-tool-calling）

工具角色节点不再裸 invoke——经 `core/llms/tool_loop.py` 的 `invoke_with_tools`
驱动至多 `_MAX_TOOL_ROUNDS = 15` 轮工具调用（2026-08-04 实测 DeepSeek 2 轮
内不收敛——模型持续要搜索而非收尾——用户拍板放宽；08-08 实测 10 轮仍常
耗尽，再放宽至 15；最坏 3 agent × 15 轮 = 45+ 次搜索/分析，每轮可并行
多调用）：

```python
invoke_with_tools(llm, query: str, config, *, tools,
                  max_tool_rounds=_MAX_TOOL_ROUNDS, progress_updater=None,
                  ) -> tuple[AIMessage, list]
```

- 循环体复用 `invoke_with_retry`（重试语义与 payload 形状不变）：LLM 返回
  带 `tool_calls` → `safe_progress("正在联网搜索…")`、逐条按 name 查工具
  执行（未知工具名 → 占位 ToolMessage；工具异常 → try/except +
  `logger.warning` + 占位文本，**不 raise** 打断图）、messages 追加该
  AIMessage（含 tool_calls）+ `ToolMessage(content, tool_call_id)`，再交
  给模型；无 `tool_calls` → 返回 `(response, messages + [response])`；
  轮数耗尽且模型仍在要工具（2026-08-04 实测场景）→ **追加一轮"收尾"
  调用**：附中文指令"工具调用轮数已用尽。请基于以上全部信息（包括联网
  搜索结果）直接给出完整、明确的最终回答，不要再调用任何工具。"——模型
  被强约束为最终轮（cost +1 次 LLM 调用/分析，有界），**保证即使轮数
  用尽也基于已有信息给出完整回答**。**实测注意**：收尾轮仍带 tool_calls
  属病态（指令未遵从），照旧返回该响应不阻断（消息已含全部搜索结果）。
- 返回的 messages 由节点整体写入 `State.messages`——add_messages reducer
  天然处理 AIMessage.tool_calls / ToolMessage，**State 零改动**。
- 空 `tools` → 单轮直调，行为与现状一致。

## 对抗修订轮（08-04-adversarial-verdict-loop，critique-and-revise）

bullish/bearish trader 各新增**第二个节点方法** `bullish_revise` /
`bearish_revise`——单轮对抗修订（verdict MVP：固定轮数、无收敛检测、无
多轮循环、无 conditional edge）：各读对方初稿与自己初稿
（`state['<opp_key>'][-1].content` / `state['<own_key>'][-1].content`——
双入边 join 保证两份初稿已就绪），修订一版**追加写原 opinions key**
（State 零新 key，add_messages 累积；初稿保留在列表中供 UI 展示对抗过程
与评估"修订保留率"），manager 经 `[-1].content` **零改动**读修订版。
模板（bullish 侧，bearish 对称）：

```python
def bullish_revise(self, state: State):
    own_draft = state['bullish_opinions'][-1].content
    opponent_draft = state['bearish_opinions'][-1].content
    query = f"…对方观点 {opponent_draft} …你的初稿 {own_draft} …"
    response, messages = invoke_with_tools(
        self.revise_llm, query, self.config,
        tools=self.tools, max_tool_rounds=3, progress_updater=self.progress_updater,
    )
    push_report(self.progress_updater, "bullish_opinions", response.content)
    return {"messages": messages, "bullish_opinions": response.content}
```

- **第二条链 `self.revise_llm`**：同一实例的第二条 `ChatPromptTemplate`，
  system 消息为 `bullish_revise_message` / `bearish_revise_message`
  （prompt.py）——角色独有短语"对抗修订轮的多方/空方交易员"，**与初稿
  路由短语（"坚定看多/看空的股票交易员"）互斥**（离线测试按 system 消息
  路由，歧义即 "UNROUTED" 暴露）；`llm` 复用同一 bind_tools 后实例
  （初稿链 `self.llm` 不动）。
- **成本护栏**：revise 节点 `invoke_with_tools(..., max_tool_rounds=3)`
  ——初稿轮保持默认 15（`_MAX_TOOL_ROUNDS`）。公共签名零改动，只传参；
  评估跑批仍可用 `WEB_SEARCH_DISABLED` 整体停用搜索。
- **修订约束（prompt 硬约束，R4）**：**先复述对方最强的一条论据，再逐条
  回应**（strongest-rebuttal，08-04-draft-prompt-pure 用户拍板）、保留自己
  ≥80% 核心论据、可承认对方有效点但**不得反转立场**、输出**完整修订版观点**
  （manager 把 [-1] 当完整观点消费，不能只输出反驳）、可联网搜索验证、中文
  禁编造（house style）。
- **初稿纯观点（08-04-draft-prompt-pure）**：bullish/bearish **初稿** prompt
  只要求完整多头/空头观点（不要求预想对方反驳——方案 4 增补已撤，2026-08-04
  用户拍板）；**对抗只发生在修订轮**（看到对方真实观点后交锋）。
- **UI 契约（core spec Streamlit UI 段）**：display 同 key **追加渲染**
  （观点 tab 初稿 → `---` 分隔 → 修订版），去重集合按 `(key, content)` 对
  （防 superstep 兜底重复推送同内容）。
- 图装配：8 节点 16 边（ANALYST 开 9 节点 19 边；08-09-role-registry
  起由 `core/role_registry.py` 注册表驱动——加角色只改 `ROLES`，装配
  循环生成，见 core spec InvestmentCommittee 节）。历史增量：+2 节点
  +6 边（各 revise 双入边 join 两份初稿、各 revise → manager）；+1 节点
  +3 边（技术指标分析师——START → 分析师 与三专家并行、分析师 → 两个
  trader，bullish/bearish 变**三入边 join**）；+1 节点 +4 边（信息面分析
  师，条件接线——启用谓词在注册表单点定义）；墙钟 3 → 4 阶段。manager /
  State / tool_loop 公共语义零改动。

## Tools (`core/llms/tools/`)

- `get_company_info.py` — `get_stock_info(ticker) -> str` wraps
  `DataAcquisition.get_stock_data` + `StockOutputFormatter.format_stock_output`.
  The only place that raises on a missing stock.
- `get_trend_indicators.py` — `get_trend_indicators(ticker) -> str`：ZODB 日K →
  vendored `compute_all`（通达信口径 MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比）→ 最近
  一根 bar 中文摘要。无数据返回占位文本，不 raise。vendor 导入需先调用
  `data_source...tdx_source.ensure_vendor_on_path()`（见 data_source spec）。
  **新指标行（08-08-technical-indicator-analyst）**：输出追加 MACD-VH 行
  （MACD_V/Signal/VH + 柱态四色 + 动量区，需相邻 bar 比较）与刘晨明乖离率
  行（ln(close)−ln(EMA20)）——计算在本仓库 `extra_indicators.py`（vendor
  零改动，VENDOR.md 严禁分叉），复用 vendor 参数化 `calc_ema` / `calc_atr`；
  柱态/动量区阈值解读在 prompt（工具只输出数据）。公式与研究来源见
  `.trellis/tasks/08-08-technical-indicator-analyst/research/`。
- `get_market_intel.py` — `get_market_intel(ticker) -> str`：TDX MCP 实时情报
  （概念/资金流/大盘）。无 `TDX_API_KEY` 或查询失败返回占位文本，不 raise。
- `web_search.py` — **唯一 bind_tools 工具**（08-03-websearch-tool-calling）：
  `make_web_search_tool(_searcher=None) -> BaseTool` 构造名 "web_search" 的
  StructuredTool——DuckDuckGo（`langchain_community.tools.DuckDuckGoSearchResults`，
  region="cn-zh"、max_results=5、json 输出）→ 中文摘要文本（标题/链接/摘要，
  news 源含日期）；查询失败/空结果 → 占位文本 `（联网搜索失败：{原因}）`
  不 raise（error-handling spec 降级风格）；`_searcher` 为测试注入点
  （house style 无 mock 框架）。`web_search_enabled()` 读 `WEB_SEARCH_DISABLED`
  环境变量，判定语义逐字对齐 `get_market_intel._mcp_disabled()`（存在且值非
  ""/"0"/"false"/"no" → 禁用）；committee **图装配时**判定——禁用 →
  `tools=None` 不绑定，行为与现状逐字节一致（工具绑定是构造期行为，故与
  TDX MCP 调用时判定不同）。
- stock_information 拼接族（前三个 + get_financial_indicators +
  get_billions_financial_intel）均不直接传给 agent 作为 callable——在
  `make_investment_decision` 图前拼接进 `stock_information`（见 core spec）；
  web_search 与亿信三工具相反：经 bind_tools 进 agent 的工具。
- **亿信工具三件套（2026-08-08，08-08-billions-api-integration）**：
  `make_billions_search_tool(_client=None, _max_calls=None) -> BaseTool | None`
  / `make_billions_twitter_tool` / `make_billions_fetch_tool`——web_search
  形状逐字对齐（`_client` 注入、函数内懒加载、失败 `logger.warning` +
  占位文本不 raise）；**开关关 → 返回 None**（committee 不绑定）；
  **闭包计数上限**（默认 3/2/3，env 覆盖；超限返回占位提示不再请求）。
  search 的 `source`/`search_mode` 用 `typing.Literal`（schema 级枚举防
  上游 422）；search 公告条目输出附 `doc_id`（供 fetch 精读，仅
  announcement 开放全文）；fetch 支持 `url` 与 `doc_id` 互斥（互斥校验
  留上游，薄包装不本地判）。`_format_item` 等输出格式化函数**单点实现**，
  信息面分析师直接导入复用（防契约漂移）。
- **信息面分析师（`agents/chinese_mainland/information_analyst.py`）**：
  复制 expert 模板（ChatPromptTemplate + partial + invoke_with_retry +
  safe_progress/push_report），但**不用工具循环**——node 内**确定性预抓**：
  SEARCH 开 → announcement/report/web 各 1 次 `client.search`（fast、
  count=5、time_range="past 3 months"）+ TWITTER 开 → 1 次
  `client.twitter_search`；失败源 `logger.warning` + 报告注明跳过；全失败
  仍产出报告（说明无可用信息）。`_client=None` 注入点（测试 fake）。
  单次 LLM 总结写 `information_analysis`，prompt 唯一路由短语
  "精于整合公告、研报、新闻与推特等多源信息"（与其余角色互斥）。
- **info_section 条件插值模式（trader/manager 查询，AC1 硬约束）**：
  `state.get("information_analysis")` 为空 → 插值变量为空串，f-string
  其余逐字节不变（关闭态查询与改动前完全一致）；非空 → 追加
  「信息面分析报告」段（trader 在查询尾、manager 在技术指标与多头观点
  之间）。字节一致性由 test/agents/test_query_baselines.py 钉死（删除
  插值立即 FAIL）。

## Anti-Patterns

- Breaking the uniform constructor signature — committee wiring and the UI pass
  `(llm, config, progress_updater)` positionally（08-03 起工具角色可带可选
  第 4 参 `tools=None`——默认 None 保持位置兼容，仅 committee 传，见模板段）。
- Adding agent logic outside the node method or mutating `state` in place (return
  the update dict instead).
- Writing new prompts into agent files — they belong in `core/llms/prompt.py`.
- Returning a raw string into a `State` key that downstream code indexes with
  `[-1].content` without checking the reducer type first.
