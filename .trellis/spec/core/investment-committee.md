---
description: InvestmentCommittee — 注册表驱动图装配、8 节点 4 阶段、build_stock_information 组装
paths:
  - core/investment_committee.py
  - core/role_registry.py
---
# InvestmentCommittee (`core/investment_committee.py`)

- `make_investment_committee(config, progress_updater=None, _llm=None)` builds
  a `StateGraph(State)` with **8 节点（条件 9 节点）16 边（ANALYST 开 19
  边）**——**注册表驱动装配**（08-09-role-registry）：节点/边由
  `core/role_registry.py` 的 `ROLES` + `build_edges` 生成，固定 4 阶段
  形状（见下）。历史演进：2026-08-02 review #4 三对并行；08-04
  adversarial-verdict-loop +2 revise 节点；08-08 technical-indicator-
  analyst +1 技术指标分析师；08-08 billions-api-integration +1 条件信息面
  分析师（启用谓词在注册表单点定义）。形状：`START → fundamental`、
  `START → trend` 与 `START → technical_indicator_analyst` 并行（都只依赖
  `stock_information`），三专家 → `bullish/bearish` 并行（都只依赖三份
  报告，trader 变**三入边 join**），
  `bullish/bearish → bullish_revise/bearish_revise`（对抗修订轮——各
  revise 双入边 join 两份初稿，互相独立保持并行），两份修订版 →
  `investment_manager → END`。LangGraph 多入边 = **隐式 join**：trader 等
  三上游都完成、revise 等两份初稿都完成（否则对方初稿缺失）、manager 等
  两份修订版都完成——墙钟 8 串行 → 4 阶段。并行分支写不同 State key
  （无写冲突），`messages` 由 add_messages reducer 合并（顺序不确定——
  display 只读最终 state，不依赖顺序）。边/节点两形态（16/19 边、8/9
  节点）由 `test/core/test_role_registry.py` 冻结断言钉死；加 agent 改
  `ROLES` 即可，**不要**在 committee 手写条件接线。
- `_llm` 为测试注入点（house style 无 mock 框架）：默认 `make_llm()`
  （08-09-llm-provider-agnostic 通用 OpenAI 兼容工厂，见 agents spec）；
  离线图测试（test/integration/test_graph_parallel.py）传假 LLM 验证
  join/并行语义。**假 LLM 路由注意**：FakeListChatModel 按共享调用计数器
  循环响应——并行下节点调用顺序非确定，必须按 system 消息路由（角色文案
  含"基本面分析师"字样，需用角色独有短语）。
- Compiled with `InMemorySaver()` checkpointer; runtime `config` must carry
  `{"configurable": {"thread_id": "1"}}`.
- `make_investment_decision(target_ticker)` streams the graph with the initial
  state `{"messages": [...], "target_stock_ticker": ..., "stock_information": ...}`.
  `stock_information` 由模块函数 **`build_stock_information(ticker, progress=None)`**
  生成（display 与 make_investment_decision 共用同一组装点——2026-08-02 抽出；
  `progress` 为可选回调，review #9——三工具调用之间输出分步进度，display
  传 `updatable_container.info` 包装，无 UI 上下文路径缺省 None 不受影响）：
  `get_stock_info`（stock 缺失 raise，唯一 raise 点）+ 技术指标
  (`get_trend_indicators`，无行情数据降级占位) + **财务指标**
  (`get_financial_indicators`，raw 缓存缺失降级占位，2026-08-02
  08-02-f10-financial-indicator-sections——F10【盈利能力指标】节最新
  期中文摘要) + 实时情报 (`get_market_intel`，无 `TDX_API_KEY` 时降级
  文本) + **亿信金融问数** (`get_billions_financial_intel`，第 5 段，
  08-08-billions-api-integration) 拼接——顺序：个股信息 → 技术指标 →
  财务指标 → 实时情报 → 亿信，display 与 make_investment_decision 共用。
  工具在函数内 import，避免无 key 环境的模块级副作用。亿信段条件拼接：
  `billions_enabled("FINDB")` 关 → 空串（段不出现，与之前逐字节一致）；
  `_billions_intel` 注入参数（None 时懒加载真实现）；失败 → 占位段，
  不污染 stock_information；`data_markdown.iter_sections` 已注册
  `【亿信金融数据库】` marker（采集 Tab 独立成节）。
- **MCP 情报缓存（2026-08-02，08-02-mcp-intel-cache）**：`get_market_intel`
  非交易时段（`utils.market_time.is_trading_time`，收盘后到次日开盘前
  行情不变）优先读缓存——按 ticker JSON 落 `data/tdx_cache/mcp_intel/
  ticker=<T>/data.json`（`core/llms/tools/mcp_intel_cache.py`，
  `{"fetched_at": 北京时间 ISO, "text": 结果文本}`，原子写；读缺失/
  损坏 → None 回退实时）。交易时段（或缓存缺失）实时查询并写缓存；
  查询失败 → 降级占位（**不静默用旧缓存**——盘中必须新鲜）；无
  TDX_API_KEY 不读写缓存。查询+拼文本独立为 `_query_mcp`（模块级，
  测试计数注入）。缓存只省网络往返，展示/LLM 语义零变化。
- **MCP 开关（2026-08-02，08-02-disable-tdx-mcp）**：`TDX_MCP_DISABLED`
  环境变量设置时（除显式假值 "0"/"false"/"no"）`get_market_intel` 直接
  返回 `（TDX MCP 已禁用，跳过实时市场情报）`——**不查 MCP、不读写
  缓存**（分析流程不再等 MCP 网络/超时）；恢复 = 删环境变量，不动代码。
  判定函数 `_mcp_disabled()`（模块级，测试钉死真值/假值/未设置三态）。
- **联网搜索开关（2026-08-03，08-03-websearch-tool-calling）**：
  `make_investment_committee` 图装配时 `web_search_enabled()` 判定——
  `WEB_SEARCH_DISABLED` 设置（存在且值非 ""/"0"/"false"/"no"）→
  `tools=None` 不绑定，三个工具角色（bullish/bearish/investment_manager）
  构造行为与现状逐字节一致；启用 → `tools = [make_web_search_tool()]`
  传三个 agent（fundamental/trend 专家不传）。与 TDX MCP 不同：工具
  绑定是构造期行为，开关在图装配时判定（TDX MCP 在调用时判定）；二者
  都是图级可逆开关。语义与测试见 agents spec Tools 段。
- **亿信工具绑定（2026-08-08，08-08-billions-api-integration）**：
  `tools` 列表在 web_search 旁按开关追加 `billions_search` /
  `billions_twitter` / `billions_fetch`（各自 `billions_enabled(cap)`，
  工厂关 → 返回 None 不绑定）。**每次 run 调用上限**（闭包计数器，
  默认 3/2/3，env `BILLIONS_{SEARCH,TWITTER,FETCH}_MAX_CALLS` 覆盖）：
  超限返回占位提示、不再发真实请求——防 15 轮工具循环烧配额。
  未配置 `BILLIONS_API_KEY` 时 tools 与今日逐字节一致。
- **信息面分析师条件接线（2026-08-08；08-10-web-search-fallback 放宽）**：
  有效条件 = `billions_cap_switch("ANALYST")` 且（`billions_enabled("SEARCH")`
  或 `billions_enabled("TWITTER")` 或 `web_search_enabled()`）——ANALYST
  段无主闸 key 约束（`billions_cap_switch`，utils/billions_config.py），
  亿信源仍受 key 硬约束，联网路径只受 `WEB_SEARCH_DISABLED` 总闸；开 →
  注册 `information_analyst` 节点 + START 边 + trader 第 4 入边（4 专家
  并行，墙钟 8 串行 → 4 阶段不变）；关 → 完全不注册（图与今日逐字节
  一致，条件接线非占位节点）。无 key + web 开 → 注册且预抓走 DDG 回退
  （见 agents spec 信息面分析师段）。信息面报告经 State key
  `information_analysis` 插值进 trader/manager 查询（条件段，缺失时
  查询字节级不变——AC1 硬约束，test_query_baselines 钉死）。
- New agents mean: new node registration here, a new edge, a new `State` key,
  and a new prompt in `core/llms/prompt.py`.
