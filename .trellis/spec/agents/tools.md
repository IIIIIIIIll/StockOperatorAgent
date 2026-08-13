---
description: 工具调用循环与 Tools — invoke_with_tools、bind_tools 工具三件套、信息面分析师与 DDG 回退
paths:
  - core/llms/tool_loop.py
  - core/llms/tools/**
  - agents/chinese_mainland/information_analyst.py
---
# 工具调用循环与 Tools（`core/llms/`）

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
  信息面分析师直接导入复用（防契约漂移）。**骨架收敛（08-09-agent-base-
  class）**：三工厂的调用体骨架（上限判定 → 计数 → try/except 占位）收敛
  到 `core/llms/tools/_capped.py` 的 `capped_call(counter, max_calls,
  cap_text, fail_fmt, warn_msg, fn)`——占位文本以格式串直传（三工具措辞
  各异，逐字保留，test_billions_tools 钉死）；`result[].content[]` 条目
  walk 收敛到 `core/llms/tools/_items.py` 的 `collect_content_items(data)`
  （billions_search/billions_twitter/信息面分析师三处共用，非 dict 跳过、
  字段缺失容错单点维护）。web_search._summarize_results 不并入（键契约
  不同：title/link/snippet，非 result[].content[] 形态）。
- **信息面分析师（`agents/chinese_mainland/information_analyst.py`）**：
  继承 AgentNode（`_client=None` 注入由子类自存），末段 LLM 走基类
  `complete_expert`（直调 invoke_with_retry），但**不用工具循环**——
  node 内**确定性预抓**：SEARCH 开 → announcement/report/web 各 1 次
  `client.search`（fast、count=5、time_range="past 3 months"）+ TWITTER
  开 → 1 次 `client.twitter_search`；失败源 `logger.warning` + 报告注明
  跳过；全失败仍产出报告（说明无可用信息）。单次 LLM 总结写
  `information_analysis`，prompt 唯一路由短语 "精于整合公告、研报、新闻
  与推特等多源信息"（与其余角色互斥）。预抓逻辑保持本文件显式（差异化
  不抽象）。
- **联网搜索回退（08-10-web-search-fallback，R2）**：`_prefetch` 以
  「检索结果】」分节标记判真实素材（亿信「…检索结果」/ 联网
  「【联网搜索结果】」；「检索失败」「无返回结果」注明不算）——亿信路径
  无真实素材且 `web_search_enabled()` → 固定 1 次 `_QUERY_TEMPLATES["web"]`
  查询（`{ticker} 最新新闻`）经 `make_web_search_tool(_searcher=…)` 追加
  「联网搜索结果」节（复用单点摘要实现，不复制 `_summarize_results`；
  `_searcher` 为测试注入点，构造参数追加在 `_client` 之后）；回退也
  失败/空（双失败）→ 返回空列表，落固定回退文本
  `（本次运行未检索到任何信息面素材：所有来源均不可用或未启用）`
  （逐字不变，不 raise——error-handling spec 降级风格）；web 关时亿信
  失败/空注明照旧保留（现状语义）。TS 侧同语义：web 开 → `{ticker} 最新新闻`
  1 次（缺省 `defaultSearcher()`：浏览器经 `/web-search` 同源代理、
  Node/真机直连 DDG），失败/空 → 同一固定回退文本（`ts/src/agents.ts`）。
- **info_section 条件插值模式（trader/manager 查询，AC1 硬约束）**：
  `AgentNode.info_section(state)`——`state.get("information_analysis")`
  为空 → 空串，f-string 其余逐字节不变（关闭态查询与改动前完全一致）；
  非空 → 追加「信息面分析报告」段（trader 在查询尾、manager 在技术指标
  与多头观点之间）。字节一致性由 test/agents/test_query_baselines.py 钉死
  （删除插值立即 FAIL）。
