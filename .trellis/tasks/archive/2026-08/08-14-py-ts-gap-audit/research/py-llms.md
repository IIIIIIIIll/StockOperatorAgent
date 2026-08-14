# 分片 3：LLM 基础设施 + 工具面（core/llms + tools）Python→TS 功能差距审计

> 审计日期：2026-08-14 · 分片：Slice3Llms · 纯只读（零业务代码改动）
> 对照面：`ts/src/llm.ts`、`prompt.ts`、`toolLoop.ts`、`progress.ts`、`retry.ts`、`webSearch.ts`、`billionsTools.ts`、`mcp.ts`、`f10.ts`、`indicators.ts`、`gates.ts`；辅助证据：`committee.ts`、`events.ts`、`pipeline.ts`、`billionsClient.ts`、`app/lib/runner.ts`、`app/lib/settings.ts`、`app/App.tsx`、vendor `tdx_mcp/tdx_client.py`、vendor `indicators/core.py`。
> 防假阳性：所有「存在」结论均经全仓 grep（含 ts/app、ts/test）确认名字不同但功能等价者不算 MISSING；拿不准处标注「需人工确认」。

---

## ① 认领文件清单（逐文件确认已通读）

**Python（5 + 13 = 18 个，全部读完）**

| 文件 | 行数 | 通读确认 |
|---|---|---|
| core/llms/llm_factory.py | ~40 | ✅ |
| core/llms/prompt.py | 230 | ✅ |
| core/llms/tool_loop.py | ~115 | ✅ |
| core/llms/progress.py | ~75 | ✅ |
| core/llms/retry.py | ~60 | ✅ |
| core/llms/tools/web_search.py | 128 | ✅ |
| core/llms/tools/get_financial_indicators.py | ~60 | ✅ |
| core/llms/tools/get_market_intel.py | 104 | ✅ |
| core/llms/tools/_capped.py | ~40 | ✅ |
| core/llms/tools/billions_fetch.py | ~95 | ✅ |
| core/llms/tools/billions_twitter.py | 126 | ✅ |
| core/llms/tools/billions_search.py | 133 | ✅ |
| core/llms/tools/_items.py | ~30 | ✅ |
| core/llms/tools/billions_fin_db.py | ~80 | ✅ |
| core/llms/tools/get_trend_indicators.py | ~100 | ✅ |
| core/llms/tools/extra_indicators.py | ~90 | ✅ |
| core/llms/tools/mcp_intel_cache.py | 70 | ✅ |
| core/llms/tools/get_company_info.py | 20 | ✅ |

**辅助只读（契约核对用，非认领文件）**：`utils/runtime_config.py`、`utils/billions_config.py`、`utils/market_time.py`、`core/investment_committee.py`（build_stock_information / make_investment_committee 工具绑定）、vendor `scripts/tdx_mcp/tdx_client.py`（query 契约）、vendor `scripts/data_pipeline/indicators/core.py`（compute_all shares 语义）。

**TS 对照面（11 个目标文件全部读完）**：llm.ts、prompt.ts、toolLoop.ts、progress.ts、retry.ts、webSearch.ts、billionsTools.ts、mcp.ts、f10.ts、indicators.ts、gates.ts。
**辅助证据**：committee.ts、events.ts、pipeline.ts、billionsClient.ts、runner.ts、settings.ts、App.tsx、test/{tool-loop,pipeline,mcp,billions-client,committee,events,query-content}.test.ts、fixtures/prompts.json。

---

## ② 功能点差距表

### A. core/llms/llm_factory.py（TS 对照：llm.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| A1 | `make_llm()` 三键必填校验（LLM_API_KEY/LLM_MODEL/LLM_BASE_URL，缺任一抛 ValueError 且点名缺失键；llm_factory.py:14-23） | `readLlmEnv`（llm.ts:23-41）抛 `MissingLlmConfigError`，点名缺失键（llm.ts:25-29） | FULL | 语义一致；异常类型不同（ValueError vs MissingLlmConfigError），均为构造期抛错、消息点名缺失键 | NON_BLOCKER |
| A2 | base_url 必须 http:// 或 https:// 前缀（llm_factory.py:24-26） | `readLlmEnv` 正则 `^https?:\/\//`（llm.ts:27-30） | FULL | 一致 | NON_BLOCKER |
| A3 | `seed=114514`（llm_factory.py:30） | `modelKwargs: { seed: 114514 }`（llm.ts:53） | FULL | 一致（JS SDK 无 seed 字段，经 modelKwargs 透传——注释明示） | NON_BLOCKER |
| A4 | `LLM_REASONING_EFFORT` 设了才传 reasoning_effort（llm_factory.py:31-33） | `reasoningEffort` 条件透传（llm.ts:54-55） | FULL | 一致 | NON_BLOCKER |
| A5 | 不传任何 extra_body（llm_factory.py:10-11 注释） | 无 extraBody 相关传参 | FULL | 一致 | NON_BLOCKER |
| A6 | 不设请求超时（长生成不误杀；llm.ts:39-43 注释明示「Python 版同语义」） | `createLlm` 不设 timeout（llm.ts:49-52） | FULL | 一致 | NON_BLOCKER |
| A7 | （Python 无） | （TS 增补）`proxyBase` 浏览器同源代理 + `X-LLM-Base` 头透传真实端点（llm.ts:47-52）；`makeLlm` 等价入口（llm.ts:66-68） | — | TS 侧 web 架构增补（绕 CORS），Node/真机直连与 Python 一致；SSRF 校验在 proxies.cjs（08-13 C2，服务面切片） | NON_BLOCKER |

### B. core/llms/prompt.py（TS 对照：prompt.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| B1 | `system_prompt`（含 `{system_message}`/`{current_date}` 占位符；prompt.py:1-4） | `system_prompt` 模板字符串（prompt.ts:3） | FULL | 逐字一致；占位符替换点在 agents.ts:58-61（agent 切片核） | NON_BLOCKER |
| B2 | `fundamental_analysis_expert_message`（prompt.py:6-38） | prompt.ts:5-8 | FULL | 逐字移植（prompt.ts:1 注释声明 AC6 与 fixtures/prompts.json 对比；fixtures/prompts.json 含全部 10 条） | NON_BLOCKER |
| B3 | `trend_analysis_expert_message`（prompt.py:40-65） | prompt.ts:10-13 | FULL | 同上 | NON_BLOCKER |
| B4 | `technical_indicator_analyst_message`（prompt.py:67-97） | prompt.ts:15-18 | FULL | 同上（含 MACD-VH/乖离率知识段逐字） | NON_BLOCKER |
| B5 | `information_analyst_message`（prompt.py:99-121） | prompt.ts:20-23 | FULL | 同上 | NON_BLOCKER |
| B6 | `bullish_trader_message` / `bearish_trader_message`（prompt.py:123-170） | prompt.ts:25-31 | FULL | 同上 | NON_BLOCKER |
| B7 | `bullish_revise_message` / `bearish_revise_message`（prompt.py:172-210） | prompt.ts:33-39 | FULL | 同上 | NON_BLOCKER |
| B8 | `investment_manager_message`（prompt.py:212-230） | prompt.ts:41-42 | FULL | 同上 | NON_BLOCKER |

### C. core/llms/tool_loop.py（TS 对照：toolLoop.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| C1 | 工具调用轮数上限 `_MAX_TOOL_ROUNDS = 15`（tool_loop.py:29） | `MAX_TOOL_ROUNDS = 15`（toolLoop.ts:12） | FULL | 一致 | NON_BLOCKER |
| C2 | 消息序列 `("human", query)` 起，AIMessage(含 tool_calls) + ToolMessage 追加回流（tool_loop.py:51-75） | 同构（toolLoop.ts:55、87-101：`['human', query]` 起，ToolMessage 构造） | FULL | 一致（TS 用 langchain 消息对象，与 Python 相同） | NON_BLOCKER |
| C3 | 工具按 name 分发；未知工具占位 `（未找到工具 {name}）`（tool_loop.py:60-62） | 同文本（toolLoop.ts:96-98） | FULL | 逐字一致 | NON_BLOCKER |
| C4 | 工具异常 → 占位 `（联网搜索失败：{exc}）` 不 raise；**同时 logger.warning("Tool {} invoke failed: {}")**（tool_loop.py:63-68） | 占位同文本（toolLoop.ts:99-102）；**但 catch 内无 warn 日志** | PARTIAL | 差异：TS 工具失败静默降级（占位文本仍返回，图不中断语义一致）；Python 有失败 warn 日志，TS 缺失（可观测性差异）。需人工确认是否有意省略 | NON_BLOCKER |
| C5 | content_and_artifact 形态取 content[0]（tool_loop.py:66-67） | `Array.isArray(content) → content[0]`（toolLoop.ts:103） | FULL | 一致 | NON_BLOCKER |
| C6 | 空 tools → 模型无法发工具调用，单轮直调（tool_loop.py:36-37 docstring；agents 层 tools 空则跳过 bindTools） | 同（toolLoop.ts roundCall；agents.ts:66 `if (tools.length && bindTools)`） | FULL | 一致 | NON_BLOCKER |
| C7 | 轮数耗尽仍在要工具 → 追加「收尾轮」（human 指令文本 +1 次调用，收尾轮仍带 tool_calls 属病态照返）（tool_loop.py:82-96） | 同：`FINAL_ROUND_INSTRUCTION` 文本逐字一致（toolLoop.ts:14-15），收尾轮逻辑（toolLoop.ts:104-110） | FULL | 一致 | NON_BLOCKER |
| C8 | 进度文案：`正在联网搜索。。。` / `联网搜索完成。。。` / `搜索轮数已用尽，正在整理最终回答。。。`（tool_loop.py:59、73、85） | 同文本（toolLoop.ts:92、108、106） | FULL | 一致 | NON_BLOCKER |
| C9 | （Python 无） | （TS 增补）onDelta/onReset/onRetry 流式通道：轮末 tool_calls 非空 → onReset + warn（toolLoop.ts:86-91）；每轮经 streamWithRetry 流式（toolLoop.ts:61-72） | — | TS 方案 B agent 级流式（ts/index.md 流式节）；Python LangGraph 无此通道。TS 增补非差距 | NON_BLOCKER |
| C10 | 每轮多 tool_calls **顺序**执行（tool_loop.py:60-73 for 循环） | 同：for-of await 顺序（toolLoop.ts:95-101） | FULL | 一致 | NON_BLOCKER |

### D. core/llms/progress.py（TS 对照：progress.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| D1 | `safe_progress`：updater 为 None / 抛异常 → no-op 降级（progress.py:22-35） | `safeProgress` try/catch no-op（progress.ts:20-27） | FULL | 协议一致；Python 另有「非脚本线程 → debug 日志」细节（Streamlit 线程语义，TS 单线程无对应物） | NON_BLOCKER |
| D2 | `ProgressBridge`：info/push_report 线程安全 queue 入队，脚本线程消费（progress.py:37-54） | `ProgressUpdater` 接口 info/pushReport（progress.ts:10-17）；JS 单线程直调，无桥类需要（事件经 events.ts 流转） | FULL | 协议对齐（ts/index.md ProgressUpdater 节）；线程桥是 Python/Streamlit 运行时特性，TS 架构不需要 | NON_BLOCKER |
| D3 | `push_report`：非 bridge updater → no-op（progress.py:56-68） | `pushReport` 同语义（progress.ts:29-39） | FULL | 一致 | NON_BLOCKER |
| D4 | （Python 无） | （TS 增补）可选 `pushDelta`/`pushStatus` + `safePushDelta`/`safePushStatus` 守卫（progress.ts:42-60；ts/index.md「扩展接口一律加可选方法」） | — | 08-11 流式决策增补；Python 侧无对应 | NON_BLOCKER |

### E. core/llms/retry.py（TS 对照：retry.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| E1 | 可恢复判定：429/500/502/503/504（openai.APIStatusError）+ APIConnectionError/APITimeoutError/httpx Connect/Timeout（retry.py:26-36） | `isRetryable`：status 数字表 + message 正则 `/connection|connect error|timeout|timed out|network/i`（retry.ts:13-27） | PARTIAL | 差异：**异常识别机制不同**——Python 用异常类层次（isinstance），TS 无 SDK 类层次，用 status 字段 + message 文本正则兜底。SDK 若抛 message 不含关键词的连接类异常可能漏判重试（低概率）。行为等价性高，机制不同 | NON_BLOCKER |
| E2 | 指数退避：3 次、1s 起、×2、上限 8s（retry.py:22-24；tenacity wait_exponential） | `ATTEMPTS=3 / BASE_DELAY=1 / MAX_DELAY=8`，delay=min(base×2^(attempt-1), 8) → 1/2/4s（retry.ts:10-12、64-66） | FULL | 档位逐项一致 | NON_BLOCKER |
| E3 | 业务错误（400/认证等）直抛零延迟（retry.py:37-38 docstring；_is_retryable False） | `!isRetryable → throw`（retry.ts:60-61） | FULL | 一致 | NON_BLOCKER |
| E4 | 耗尽 reraise 原异常（retry.py:44 `reraise=True`） | `throw err` 原对象（retry.ts:61、72） | FULL | 一致 | NON_BLOCKER |
| E5 | 退避前 warn：attempt_number/异常类型名/下次间隔（retry.py:50-55 before_sleep） | `retryWarnMessage`（invoke/stream 两路径共用；attempt/errType/HTTP status 后缀/delay）（retry.ts:31-47、62） | FULL | 一致（TS 额外带 HTTP status 数字，信息更全） | NON_BLOCKER |
| E6 | （Python 无） | （TS 增补）`streamWithRetry`：迭代 llm.stream() + concat 聚合 + onDelta/onRetry + 空流 `{content:''}` + 非对象聚合原样返回（retry.ts:115-154；ts/index.md 流式节） | — | 08-11 方案 B 增补；Python 无流式重试孪生 | NON_BLOCKER |

### F. core/llms/tools/web_search.py（TS 对照：webSearch.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| F1 | `make_web_search_tool`：名 `web_search`，query 参数，docstring=LLM 描述（web_search.py:104-128） | `makeWebSearchTool` + `WEB_SEARCH_DESCRIPTION`/`WEB_SEARCH_SCHEMA`（webSearch.ts:183-212） | FULL | 工具名/描述/参数一致（TS 额外显式 JSON Schema 供 bindTools，修复 400——实现细节） | NON_BLOCKER |
| F2 | 搜索供应商：**仅 DuckDuckGo**（langchain_community DuckDuckGoSearchResults / ddgs SDK，region=cn-zh，max_results=5，json 输出；web_search.py:51-74） | 供应商链：**Tavily 优先（TAVILY_API_KEY，max_results=5）→ DDG html 端点（cn-zh）→ 反爬回退 vqd+news.js**（webSearch.ts:45-58、123-181）；浏览器分支走同源 /web-search 代理（webSearch.ts:60-85；proxies.cjs 20s 超时） | PARTIAL | 差异：**搜索源/回退链不同**——Python 只有 DDG（ddgs SDK 实现）；TS 增 Tavily 可选主选 + DDG 自实现（html+news.js 双端点）。region cn-zh 与 max_results=5 对齐。同一 query 可能返回不同源结果（对 LLM 输入有实质影响）。Python 侧无浏览器代理分支（web 架构差异） | NON_BLOCKER |
| F3 | `_summarize_results`：标题/链接/摘要/日期 → `- 标题：…；链接：…；摘要：…；日期：…`，`【联网搜索结果】` 头，脏条目跳过（web_search.py:76-98） | `summarizeResults` 逐字同构（webSearch.ts:27-42） | FULL | 一致 | NON_BLOCKER |
| F4 | 查询失败/空结果 → 占位 `（联网搜索失败：{原因}）`/`（联网搜索失败：无返回结果）` 不 raise（web_search.py:117-122） | 同文本（webSearch.ts:205-210） | FULL | 一致 | NON_BLOCKER |
| F5 | `web_search_enabled()`：WEB_SEARCH_DISABLED 负极性 + **WEB_SEARCH_ENABLED 正极性覆盖层优先**（web_search.py:36-48；runtime_config runtime_bool） | `webSearchEnabled()`：仅 `!envDisabled('WEB_SEARCH_DISABLED')`（webSearch.ts:22-24）；**WEB_SEARCH_ENABLED 覆盖键不识别** | PARTIAL | 差异：TS 不实现 WEB_SEARCH_ENABLED 正极性覆盖。TS UI 路径等价——设置面板直接写 WEB_SEARCH_DISABLED='0'/'1'（settings.ts:112 applySwitchesToEnv；App.tsx:128-133）；仅 env 级正向覆盖键缺失 | NON_BLOCKER |
| F6 | （Python 无） | （TS 增补）`envDisabled` 假值元组 ""/"0"/"false"/"no"（webSearch.ts:16-19，对齐 Python env_disabled）；Tavily/代理/ddg 三 searcher 归一化 SearchResult | — | TS 增补（web 架构必需） | NON_BLOCKER |

### G. core/llms/tools/get_financial_indicators.py（TS 对照：pipeline.ts + f10.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| G1 | `get_financial_indicators(ticker)`：F10 raw → parse_indicator_section('【盈利能力指标】') → 最新报告期（period 字典序 max）每指标 `metric: 值%`，过滤 NaN，保持 F10 原始顺序（get_financial_indicators.py:23-60） | `financialIndicatorsText`（pipeline.ts:148-161）+ `parseIndicatorSection`（f10.ts:109-111，双分隔符/模糊分节定位同 Python f10_parser） | FULL | 文本层一致（头部 `【盈利能力指标（YYYY-MM-DD）】`、fmt 2 位+%、NaN 过滤、顺序保持）。数据链差异：Python 读 tdx_source parquet raw 缓存；TS 从 store 注入 f10Text（采集层差异，属数据源切片） | NON_BLOCKER |
| G2 | 降级占位 `（无 {ticker} 的盈利能力指标，跳过）` 不 raise（get_financial_indicators.py:31-34） | 同文本（pipeline.ts:149-151） | FULL | 一致 | NON_BLOCKER |

### H. core/llms/tools/get_market_intel.py（TS 对照：mcp.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| H1 | `_mcp_disabled()`：TDX_MCP_DISABLED 假值元组判定 + **TDX_MCP_ENABLED 覆盖层优先**（get_market_intel.py:33-47） | `mcpDisabled()` 同语义（mcp.ts:194-199） | FULL | 一致（含覆盖层） | NON_BLOCKER |
| H2 | 无 key 占位 `（未配置 TDX_API_KEY，跳过实时市场情报）`（get_market_intel.py:29） | `MCP_NO_KEY_TEXT` 逐字（mcp.ts:190） | FULL | 一致 | NON_BLOCKER |
| H3 | 查询：TdxMcpClient(api_key).query(f"{ticker} 实时行情 资金流向 所属概念板块", size=50)（get_market_intel.py:49-67） | `queryMarketIntel` 同 query 文本 + size 50（mcp.ts:211-233）；TdxMcpClient.query → callTool('tdx_wenda_quotes', {question, range:'AG', size, page:1})（mcp.ts:176-184）与 vendor tdx_client.py:182-202 默认契约一致 | FULL | 一致（含工具名/range/page） | NON_BLOCKER |
| H4 | 失败占位：`（通达信 MCP 查询失败：{msg}）`/`（通达信 MCP 无返回数据）`/`（通达信 MCP 查询异常，跳过{ticker}的实时情报）`（get_market_intel.py:55-65） | 同文本（mcp.ts:224-231） | FULL | 一致 | NON_BLOCKER |
| H5 | 摘要：rows[:10] + `row_to_text`（`字段: 值`，过滤 None/""）（get_market_intel.py:66-67、102-104） | rows.slice(0,10) + `rowToText`（mcp.ts:203-209、226-228） | FULL | 一致 | NON_BLOCKER |
| H6 | 缓存：非交易时段读 mcp_intel_cache；交易时段实时查并写缓存；**失败占位文本也写缓存**（get_market_intel.py:70-99；utils/market_time.is_trading_time） | **不做缓存**：mcp.ts:5-6 注释 + 08-13-ts-capability-completion/design.md:30「缓存简化（R3 设计决策）：TS 无 is_trading_time 完整移植——不做缓存，每次实时查询…mcp_intel_cache.py 不移植」 | BY_DESIGN | 决策出处已记录（design.md:30 + mcp.ts:5-6 + implement.md:6）。差异注：Python 失败占位亦写缓存（非交易时段后续读到的是失败占位）；TS 每次实时查询无此行为 | NON_BLOCKER |
| H7 | `is_trading_time`（utils/market_time.py，北京时间工作日 9:30-11:30/13:00-15:00） | TS 无移植（同 H6 BY_DESIGN 出处） | BY_DESIGN | 同上 | NON_BLOCKER |
| H8 | 客户端超时：vendor TdxMcpClient 默认（initialize 通知 10s；mcp_intel 查询超时见 vendor） | `DEFAULT_TIMEOUT_MS = 30_000` + initialize 通知 10s（mcp.ts:11、157-158） | PARTIAL | 差异：TS 查询超时档位 30s 为显式常量，Python 走 vendor 默认（需人工确认 vendor 查询超时值是否与 30s 一致——vendor 属 out-of-scope 只读面） | NON_BLOCKER |

### I. core/llms/tools/_capped.py（TS 对照：billionsTools.ts cappedCall）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| I1 | `capped_call`：上限判定（cap 占位文本**逐字节保留**，{max_calls} 插值）→ 计数 → try/except → logger.warning + 失败占位（{exc} 插值），不 raise（_capped.py:21-40） | `cappedCall` 同构（billionsTools.ts:117-127），支持 async fn（网络调用 await）；cap/fail 占位经 replace 插值 | FULL | 一致（TS 为 async 骨架，语义对齐） | NON_BLOCKER |

### J. core/llms/tools/billions_search.py（TS 对照：billionsTools.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| J1 | `make_billions_search_tool`：名 `billions_search`；参数 query / source（web/academic/image/video/announcement/report/expert，默认 web）/ count=5 / time_range 可空 / search_mode（fast/advanced/expert，默认 fast）（billions_search.py:81-133） | `makeBillionsSearchTool` + `SEARCH_SCHEMA` 同参数字段（billionsTools.ts:172-217、189）；invoke 内 `Number(args.count ?? 5)` 默认 5 | FULL | schema 一致（Python @tool 类型提示生成 vs TS 手写 JSON Schema，语义等价） | NON_BLOCKER |
| J2 | 开关关 → 工厂 None 不绑定（billions_search.py:92；billions_enabled：主闸 key 存在 且 总闸开 且 能力闸开；utils/billions_config.py:29-47） | `billionsCapEnabled`：无 apiKey/env key → undefined；BILLIONS_DISABLED + BILLIONS_{CAP}_DISABLED（billionsTools.ts:134-139；committee.ts:31-40） | PARTIAL | 差异：Python 另有 `BILLIONS_MASTER`/`BILLIONS_{CAP}` **正极性运行时覆盖键**（billions_config.py:29-47 runtime_bool）；TS 只识别 DISABLED 负极性键。TS UI 等价：设置面板写 DISABLED 键（settings.ts:113-117）。env 级正向覆盖键缺失（与 F5 同类） | NON_BLOCKER |
| J3 | 硬上限 search 3（env `BILLIONS_SEARCH_MAX_CALLS` 覆盖 + 会话 runtime_int 覆盖）（billions_search.py:95；billions_config.py:117-122） | `maxCallsFor('SEARCH', …)`：注入 > env（数字校验，非法回退）> 默认 3（billionsTools.ts:141-145、17-20） | FULL | env 覆盖与默认一致；Python 会话覆盖层由 TS 面板/注入机制取代（见 J7） | NON_BLOCKER |
| J4 | `_format_item`/`_summarize_results`：`[title](link) — date — institution — doc_id: …` + `(snippet)`；`【亿信检索结果】` 头；占位 `（亿信检索失败：无返回结果）`（billions_search.py:34-79） | `formatSearchItem`/`summarizeSearchResults` 逐字同构（billionsTools.ts:47-73） | FULL | 一致 | NON_BLOCKER |
| J5 | 失败 → logger.warning + 占位（capped_call） | cappedCall warn + 占位 | FULL | 一致 | NON_BLOCKER |
| J6 | 客户端函数内懒加载（billions_search.py:100-104） | `makeClient` 构造注入/apiKey（billionsTools.ts:147-149），无副作用 | FULL | 一致 | NON_BLOCKER |
| J7 | （UI 覆盖接线）Python 设置面板运行时覆盖 `BILLIONS_SEARCH_MAX_CALLS` **生效**（08-08-billions-switches-ui） | TS SettingsPanel 有 `searchMax` 输入（SettingsPanel.tsx:31-35、57-59）且持久化（settings.ts:46、69），**但从未应用到 env/工具**：applySwitchesToEnv 只处理开关（settings.ts:108-120），App.tsx onSettingsChange 只 save+applySwitches（App.tsx:128-133）；maxCallsFor 只读 env | PARTIAL | 差异：**TS 调用上限 UI 设置是死控件**（持久化但不生效）。env `BILLIONS_{CAP}_MAX_CALLS` 与默认 3/2/3 本身生效，仅面板值未接线 | BLOCKER（删 Python 前需接线或移除该 UI 控件） |

### K. core/llms/tools/billions_twitter.py（TS 对照：billionsTools.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| K1 | `make_billions_twitter_tool`：名 `billions_twitter`；参数 query / count=5 / search_mode 三档（billions_twitter.py:81-126） | `makeBillionsTwitterTool` + `TWITTER_SCHEMA`（billionsTools.ts:220-256）；count 默认 5 | FULL | 一致 | NON_BLOCKER |
| K2 | 硬上限 twitter 2 + env 覆盖（billions_twitter.py:95） | `maxCallsFor('TWITTER', …)` 默认 2（billionsTools.ts:17-20） | FULL | 一致 | NON_BLOCKER |
| K3 | `_format_tweet`：@username（title @ 前缀兜底）/ 浏览数 / 日期 / 正文 / link，`- ` 列表行（billions_twitter.py:32-62） | `formatTweetItem` 同构（billionsTools.ts:76-94） | FULL | 一致 | NON_BLOCKER |
| K4 | 占位：`（亿信推特检索失败：无返回结果）`/cap 文本/失败文本（billions_twitter.py:70-78、112-113） | 逐字同（billionsTools.ts:96-103、238-240） | FULL | 一致 | NON_BLOCKER |
| K5 | 开关/懒加载/上限语义同 J2/J3/J6 | 同 | FULL/PARTIAL 同 J | 同 J 差异（正极性覆盖键缺失、UI caps 死控件同样适用于 TWITTER） | 同 J7 |

### L. core/llms/tools/billions_fetch.py（TS 对照：billionsTools.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| L1 | `make_billions_fetch_tool`：名 `billions_fetch`；url/doc_id 二选一（都传/都不传上游 422 归一化降级）（billions_fetch.py:49-95） | `makeBillionsFetchTool` + `FETCH_SCHEMA`（billionsTools.ts:259-297） | FULL | 一致 | NON_BLOCKER |
| L2 | `_format_fetch`：标题 + Markdown 正文；`_MAX_CONTENT_CHARS = 3000` 截断注明（billions_fetch.py:30-47） | `FETCH_MAX_CONTENT_CHARS = 3000` + `formatFetch`（billionsTools.ts:107-116） | FULL | 截断阈值/文案一致 | NON_BLOCKER |
| L3 | 硬上限 fetch 3 + env 覆盖（billions_fetch.py:95） | `maxCallsFor('FETCH', …)` 默认 3 | FULL | 一致 | NON_BLOCKER |
| L4 | （Python 无本地校验——url 任意字符串交给上游，上游 422 归一化降级） | （TS 增补）invoke 内 url http(s) 前缀本地校验，非法 → `（亿信全文抓取失败：url 仅支持 http(s) 协议）`（billionsTools.ts:286-288，08-13 security F10 顺带） | — | TS 增补安全加固（行为差异：非法 url Python 走上游 422 占位，TS 本地占位） | NON_BLOCKER |

### M. core/llms/tools/_items.py（TS 对照：billionsTools.ts collectContentItems）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| M1 | `collect_content_items`：result[].content[] 收集，非 dict 脏条目跳过（_items.py:13-30） | `collectContentItems` 同构（billionsTools.ts:25-43） | FULL | 一致 | NON_BLOCKER |

### N. core/llms/tools/billions_fin_db.py（TS 对照：runner.ts makeBillionsIntel）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| N1 | `get_billions_financial_intel(ticker)`：开关关 → 空串 ""（段不出现）；成功 → `【亿信金融数据库】` 标题 + result[].content Markdown 表拼接；失败/无有效结果 → logger.warning + 占位（billions_fin_db.py:48-80） | `makeBillionsIntel`：开关关/无 key → undefined（pipeline 视同空串，pipeline.ts:196-198）；成功标题+`\n\n` join（runner.ts:144-146）；失败/无结果占位同文本（runner.ts:145-149） | FULL | 语义一致（undefined↔空串等价）；占位文本逐字一致 | NON_BLOCKER |
| N2 | `_build_question` 固定问数（billions_fin_db.py:26-28） | 同文本（runner.ts:138） | FULL | 一致 | NON_BLOCKER |
| N3 | `_format_results`：字段缺失容错、多条 result 依次拼接（billions_fin_db.py:31-45） | 同（runner.ts:139-146 filter content） | FULL | 一致 | NON_BLOCKER |
| N4 | 客户端懒加载（billions_fin_db.py:56-58） | runner.ts 注入构造 | FULL | 一致 | NON_BLOCKER |
| N5 | （超时）Python client fin_db 120s（billions_fin_db.py:69 注释；spec ts/index.md「超时档位 fin_db 120s」） | `FIN_DB_TIMEOUT = 120_000`（billionsClient.ts:84；billions-client.test.ts:177 验证） | FULL | 档位一致（client 属数据源切片，本行仅核对工具侧超时语义） | NON_BLOCKER |

### O. core/llms/tools/get_trend_indicators.py（TS 对照：pipeline.ts + indicators.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| O1 | `get_trend_indicators(ticker)`：ZODB 日K → compute_all(daily) + calc_macd_vh + calc_liu_bias → 末根摘要 9 组指标（_INDICATOR_ROWS：MA5/10/20/60、EMA5/10/20/60、MACD、RSI6/12/24、KDJ、BOLL、ATR、量比/VOL_MA5、换手率；小数位 2/2/3/2/2/2/2/2/3；头 `【技术指标（{date} 收盘）】`）（get_trend_indicators.py:30-40、68-100） | `trendIndicatorsText`（pipeline.ts:116-143）+ `computeAll`（indicators.ts:212-242）+ `INDICATOR_ROWS` 同列表（pipeline.ts:100-113）；MACD-VH/乖离率行格式一致 | FULL | 列集/小数位/行格式一致；computeAll 含 Python compute_all + calc_macd_vh + calc_liu_bias 全列（indicators.ts:233-234 注释）；fixtures/600036_indicators.json + export_fixtures.py 数值对照存在 | NON_BLOCKER |
| O2 | 换手率：**compute_all 不传 shares → TURNOVER_RATE 恒 NaN → `换手率: N/A`**（get_trend_indicators.py:8-9 注释 + 68 行调用；vendor core.py:58-76 shares=None 全 NaN） | **TS 有流通股本时传 shares（liutongguben/10000 万股）→ 真实换手率**（pipeline.ts:118-121）；无股本 → null 同 Python N/A | PARTIAL | 差异：TS 在有股本数据时输出真实换手率，Python 该工具恒 N/A（行为改进型差异，非缺失）。Python 的精确换手率走 M1 路径 float_shares（data_acquisition.py:139-143）——TS 股本经采集层 parseCapitalStructure 注入 | NON_BLOCKER |
| O3 | 无行情数据占位 `（无 {ticker} 的行情数据，跳过技术指标）`（get_trend_indicators.py:72-73） | 同文本（pipeline.ts:117） | FULL | 一致 | NON_BLOCKER |
| O4 | 数据链：Python 读 ZODB ChinaStockData；TS 读 store bars（采集/存储层差异，属其它切片） | — | FULL（工具层） | 文本层一致，数据源层差异不重复列 | NON_BLOCKER |

### P. core/llms/tools/extra_indicators.py（TS 对照：indicators.ts + pipeline.ts）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| P1 | `calc_macd_vh`（fast=12/slow=26/atr_len=26/signal=9）：MACD_V/SIGNAL/MACD_VH；ATR=0 → MACD_V NaN（extra_indicators.py:35-56） | `calcMacdVh` 同参数同 NaN 语义（indicators.ts:186-201；注释「ATR 窗口 = atrLen(26)」） | FULL | 一致 | NON_BLOCKER |
| P2 | `calc_liu_bias`（n=20）：ln(close) − ln(EMA n)（extra_indicators.py:59-65） | `calcLiuBias` 同（indicators.ts:203-207） | FULL | 一致 | NON_BLOCKER |
| P3 | `macd_vh_state` 四色（正扩张/正衰减/负扩张/负衰减；NaN→N/A）（extra_indicators.py:68-76） | `macdVhState`（pipeline.ts:86-90） | FULL | 一致（含 NaN 边界） | NON_BLOCKER |
| P4 | `momentum_zone` 5 区（±150/±50 阈值；NaN→N/A）（extra_indicators.py:29-32、79-89） | `momentumZone` 同阈值（pipeline.ts:93-99） | FULL | 一致 | NON_BLOCKER |

### Q. core/llms/tools/mcp_intel_cache.py（TS 对照：无，BY_DESIGN）

| # | Python 功能点 (file:line) | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| Q1 | `read_cache`/`write_cache`：按 ticker JSON 落 data/tdx_cache/mcp_intel/ticker=<T>/data.json；原子写（tmp+os.replace）；损坏/缺失→None/False 不 raise（mcp_intel_cache.py:28-70） | 无（明确不移植） | BY_DESIGN | 决策出处：08-13-ts-capability-completion/design.md:30「缓存简化（R3 设计决策）…**不做缓存**，每次实时查询…mcp_intel_cache.py 不移植」；实现记录 implement.md:6；代码注释 mcp.ts:5-6。TS 无 is_trading_time 移植（market_time.py），每次实时查询与 Python 交易时段行为一致 | NON_BLOCKER |

### R. core/llms/tools/get_company_info.py（TS 对照：pipeline.ts formatStockOutput + App.tsx）

| # | Python 功能点 (file:line) | TS 等价物 (file:line) | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| R1 | `get_stock_info`：北交所显式 raise（中文报错，get_company_info.py:15-17） | App.tsx 入口拦截：6 位数字校验 + `4/8` 开头 BJ 报错（App.tsx:147-156，文案对齐） | FULL | 用户可见行为一致（TS 在 UI 入口拦截；Python 另有 API 路径 raise 兜底——TS 唯一入口是 App） | NON_BLOCKER |
| R2 | 缺 stock → `raise Exception('Stock not found')`（get_company_info.py:19-20） | TS pipeline 构建函数**不 raise**：name 回退 ticker、bars 空走各块占位（pipeline.ts:181-183、116-117）；缺数据由采集阶段失败中止（runner.ts:34-35 collectForWeb 抛错→中止分析） | PARTIAL | 差异：**错误处理路径不同**——Python 在 stock_information 构建期 raise；TS 依赖上游采集保证存在 + 容错渲染。TS 无等价 raise 点（需人工确认：直接调 runner.run 且 store 为空时是否静默产出 N/A 报告——pipeline.test.ts:141-145 显示空 store 产出全占位文本而非报错） | NON_BLOCKER |
| R3 | `StockOutputFormatter.format_stock_output`（get_company_info.py:21；stock_output_formatter 属采集切片） | `formatStockOutput`（pipeline.ts:43-80：Stock 行/最新价/PE/PB/Momentum/60 日价格/20 条财务摘要） | FULL（本切片范围） | 块 1 等价物存在且同构；逐字段对照属采集/格式化切片（Slice2） | NON_BLOCKER |

### S. TS 对照面补充（无 Python 一对一对应，接线证据）

| # | TS 文件/功能点 (file:line) | 对应 Python 面 | 状态 | 说明 |
|---|---|---|---|---|
| S1 | gates.ts：asiaToday/getLastBusinessDay/overviewNeedsRefresh/latestPastQuarterEnd/reportsFresh/FetchScope（gates.ts:5-55） | utils/time_helper + data_acquisition 新鲜度门（采集切片） | FULL（接线） | 本切片确认：agents.ts:58-60 system 日期 = `getLastBusinessDay(localToday())`（对齐 Python prompt {current_date} 替换）；逐门对照属采集切片 |
| S2 | billionsClient.ts：4 端点 + BillionsApiError 归一化 + 超时档位 fin_db 120s / search+twitter fast 25/advanced 70/expert 120 / fetch 90s + X-API-KEY（billionsClient.ts:22-32、76-85） | data_source/…/billions/client.py（数据源切片） | FULL（引用） | 作为亿信工具行为底层证据；spec ts/index.md 能力接线节已核对 |
| S3 | events.ts:67-119 createPipelineRunner.run：buildStockInformation → makeInvestmentCommittee(config, updater, llm, opts.tools)（events.ts:110-119） | core/investment_committee.py（编排切片） | FULL（接线） | 工具注入链完整：App.tsx:224 `tools: assembleTools(settings.keys)` → events.ts:119 → committee.ts:129 兜底 webSearch 开关 |
| S4 | committee.ts:118-133 makeInvestmentCommittee 工具兜底：`_tools ?? (webSearchEnabled() ? [makeWebSearchTool()] : [])` | investment_committee.py:110-124（web_search 开关绑定 + 亿信三件套 None 过滤 + 空→None） | FULL（接线） | 对齐 |

---

## ③ MISSING + PARTIAL 汇总清单（移植/phaseout 时照此逐条处理）

### MISSING（0 项）

全部 18 个 Python 文件的公开功能点均有 TS 等价物。无 MISSING 功能点。

### BY_DESIGN（2 项，均 NON_BLOCKER）

1. **mcp_intel_cache（Q1）**：TS 不做缓存——决策出处 08-13-ts-capability-completion/design.md:30 + mcp.ts:5-6 + implement.md:6。删 Python 时 mcp_intel_cache.py 可直接删除。
2. **is_trading_time（H7）**：TS 无移植（与 Q1 同一决策出处）。

### PARTIAL（10 项，按移植/修复优先级排序）

| # | 功能点 | Python 证据 | TS 证据 | 差异 | 阻断 |
|---|---|---|---|---|---|
| P-1 | **亿信调用上限 UI 设置（searchMax/twitterMax/fetchMax）** | bills_config.py:117-122 会话覆盖生效（billions_enabled/max_calls 消费 runtime_int） | settings.ts:46/69 持久化、SettingsPanel.tsx:31-35/57-59 输入；applySwitchesToEnv（settings.ts:108-120）与 App.tsx:128-133 **均不应用 caps**；maxCallsFor 只读 env（billionsTools.ts:141-145） | 面板上限值是死控件（用户改了不生效）；env `BILLIONS_{CAP}_MAX_CALLS` 覆盖本身可用 | **BLOCKER**（删 Python 前需把 caps 接线到 env/注入，或移除该 UI 控件并明示仅 env 可配） |
| P-2 | 亿信开关正极性覆盖键（BILLIONS_MASTER / BILLIONS_{CAP}） | bills_config.py:29-47 runtime_bool 正极性覆盖 | committee.ts:31-40 / billsTools.ts:134-139 仅识别 DISABLED 负极性键 | env 级正向覆盖键缺失；UI 路径等价（面板写 DISABLED） | NON_BLOCKER |
| P-3 | WEB_SEARCH_ENABLED 正极性覆盖键 | web_search.py:36-48 runtime_bool("WEB_SEARCH_ENABLED") | webSearch.ts:22-24 仅 WEB_SEARCH_DISABLED | 同上（TS UI 写 DISABLED 键等价）；settings.ts:112 已覆盖 UI 路径 | NON_BLOCKER |
| P-4 | 搜索供应商链 | web_search.py:51-74 仅 DDG（ddgs SDK） | webSearch.ts:45-58/78-85/123-181 Tavily 优先→DDG html→news.js 回退；浏览器走 /web-search 代理 | 搜索结果来源可能不同（同一 query 不同源）；region cn-zh 与 max_results=5 对齐 | NON_BLOCKER |
| P-5 | 工具失败日志 | tool_loop.py:67 logger.warning("Tool {} invoke failed") | toolLoop.ts:99-102 catch 无 warn | TS 工具失败无 warn 日志（占位语义一致，可观测性差异） | NON_BLOCKER |
| P-6 | retry 可恢复判定机制 | retry.py:29-36 异常类 isinstance（openai/httpx 类层次） | retry.ts:21-27 status 数字 + message 正则 | 机制不同：message 不含关键词的连接类异常可能漏判（低概率） | NON_BLOCKER |
| P-7 | MCP 查询超时档位 | get_market_intel.py:49-67 走 vendor 默认（值需人工确认） | mcp.ts:11 DEFAULT_TIMEOUT_MS=30_000 | TS 显式 30s；Python 与 vendor 默认一致与否需人工确认（vendor out-of-scope） | NON_BLOCKER |
| P-8 | 技术指标换手率 | get_trend_indicators.py:68 compute_all 不传 shares → N/A；vendor core.py:58-76 | pipeline.ts:118-121 有股本传 shares → 真实值 | TS 行为改进（有股本时真实换手率）；无股本时同为 N/A | NON_BLOCKER |
| P-9 | Stock-not-found 错误路径 | get_company_info.py:19-20 raise 'Stock not found' | pipeline.ts:181-183/116-117 容错渲染，采集失败中止 | TS 无构建期 raise 点；空 store 直调 runner.run 产出全占位（需人工确认是否符合预期契约） | NON_BLOCKER |
| P-10 | 北交所拦截位置 | get_company_info.py:15-17 API 路径 raise 兜底 | App.tsx:153-156 仅 UI 入口拦截 | TS API 路径（Node 探针 probe.mts 直调）无 BJ 拦截（App 是唯一用户入口，风险低） | NON_BLOCKER |

### FULL 汇总计数

- A（llm_factory）：6 FULL + 1 TS 增补
- B（prompt）：8 FULL
- C（tool_loop）：8 FULL + 1 PARTIAL（P-5）+ 1 TS 增补
- D（progress）：3 FULL + 1 TS 增补
- E（retry）：4 FULL + 1 PARTIAL（P-6）+ 1 TS 增补
- F（web_search）：3 FULL + 2 PARTIAL（P-3、P-4）+ 1 TS 增补
- G（get_financial_indicators）：2 FULL
- H（get_market_intel）：6 FULL + 1 PARTIAL（P-7）+ 2 BY_DESIGN
- I（_capped）：1 FULL
- J/K/L（亿信三件套）：search 6 FULL+2 PARTIAL（P-2、P-1 之 search 部分）/ twitter 同 / fetch 5 FULL+1 增补（L4）
- M（_items）：1 FULL
- N（billions_fin_db）：5 FULL
- O（get_trend_indicators）：3 FULL + 1 PARTIAL（P-8）
- P（extra_indicators）：4 FULL
- Q（mcp_intel_cache）：1 BY_DESIGN
- R（get_company_info）：2 FULL + 1 PARTIAL（P-9、P-10 计 2 项→ 表内 R1 FULL、R2 PARTIAL）

---

## ④ spec 符合性结论（ts/index.md「能力接线」逐项核对）

| 能力接线点（ts/index.md 要求） | 结论 | 证据 |
|---|---|---|
| **亿信三件套 + fin_db**：billionsTools.ts（search/twitter/fetch，开关关/无 key → undefined 不绑定，硬上限 search 3 / twitter 2 / fetch 3 + env 覆盖）+ runner.ts makeBillionsIntel + assembleTools → App.tsx | ✅ 存在 | billsTools.ts:189/231/268/299（工厂+三件套聚合）；billionsTools.ts:134-145（开关+上限）；runner.ts:131-151（makeBillionsIntel）、168-177（assembleTools）；App.tsx:224（注入）；events.ts:119（committee 接线）；billionsClient.ts:76-85（4 端点+超时档位） |
| **mcp 实时情报**：mcp.ts（JSON-RPC 2.0 + tdx-api-key + Mcp-Session-Id + SSE 取首个 result；getMarketIntel 门控 + 无 key 占位 + 中文摘要 ≤10 行）+ runner.ts makeMcpIntel → App.tsx deps.mcp | ✅ 存在 | mcp.ts:57-184（TdxMcpClient 类）、194-199（门控）、211-233（查询+摘要）、235-243（getMarketIntel）；runner.ts:155-159（makeMcpIntel）；pipeline.ts:191-195（deps.mcp 接线）；App.tsx:225-227 |
| **mcp 不做缓存**（08-13 决策） | ✅ 决策已记录 | 08-13-ts-capability-completion/design.md:30 + implement.md:6 + mcp.ts:5-6 注释（三处一致） |
| **LLM 工厂/重试**：llm.ts（三键强校验 + seed 对齐 + 可选 reasoning_effort + 代理/直连）+ retry.ts（invokeWithRetry/streamWithRetry 语义对齐 1s×2 上限 8s ≤3 次） | ✅ 存在 | llm.ts:23-55；retry.ts:10-27/51-72/115-154 |
| **ProgressUpdater 协议**：info/pushReport + 可选 pushDelta/pushStatus，safe 守卫，扩展一律可选方法 | ✅ 存在 | progress.ts:10-60；committee 传 null、pipeline 用 info（pipeline.ts:198-204）、safePushDelta/safePushStatus 经 agents.ts:88-97 上报 |
| **流式输出（方案 B）**：streamWithRetry + toolLoop onDelta/onReset/onRetry + pushStatus('retry') 复位单通道 | ✅ 存在 | retry.ts:115-154；toolLoop.ts:61-72/86-91/104-110；progress.ts:55-60；ts/index.md 流式节与「工具轮与重试的复位通道」一致 |
| **工具接线**：web_search 开关 + 亿信三件套经 committee 绑定（bindTools）；空 tools → 直调 | ✅ 存在 | committee.ts:129（兜底）；agents.ts:66-72（bindTools 条件绑定）；events.ts:119；App.tsx:224 |
| **同源代理**（/llm-proxy SSE 透传、/web-search 20s 超时） | ✅ 存在（服务面切片详核） | proxies.cjs:220-252（/web-search）；llm.ts:47-52（proxyBase）；ts/index.md 同源代理节 |
| **图表/数据源/存储接线** | 不在本切片范围 | 其它切片核 |

**结论**：本切片覆盖的「能力接线点」（亿信三件套+fin_db、mcp 实时情报、LLM 工厂/重试、ProgressUpdater 协议、流式输出、工具绑定）在 TS 侧**全部存在且已接线**；唯一需在 phaseout 前处理的接线缺陷是 **亿信调用上限 UI 死控件（P-1，BLOCKER）**，其余 PARTIAL 均为 NON_BLOCKER 的行为差异/缺失，可在移植收尾或后续任务中处理。
