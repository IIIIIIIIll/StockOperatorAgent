---
description: Core orchestration — DataAcquisition, InvestmentCommittee, formatter, Streamlit UI
paths:
  - core/data_acquisition.py
  - core/investment_committee.py
  - core/stock_output_formatter.py
  - core/ui/**
---

# Core Orchestration (`core/`)

`core/llms/` is covered by [agents/index.md](../agents/index.md). This spec covers
everything else in `core/`.

## DataAcquisition (`core/data_acquisition.py`)

Orchestrates data freshness and ingestion. Local patterns:

- **Freshness-first**: `acquire_daily_overview()` and `acquire_historical_data(ticker)`
  consult the storage layer (`storage.check_need_update_overview()`,
  `stock.last_data_update`) and skip work when data is current.
- **One exchange method per market**: `update_shex_overview` / `update_szex_overview` /
  `update_bjex_overview` iterate `AKShareSource().fetch_*_stocks()` rows and call
  `update_overview_in_storage(row)`.
- **Row → model by positional args**: `StockOverview(*list(row.values())[1:])`
  (first column dropped — see `data_source/index.md`), `ChinaStockData(*list(row.values()))`.
- **Boolean result protocol**: methods return `True` on success and `False` + a
  `logger.error` when a stock is missing from storage (e.g.
  `acquire_historical_data`, `add_performance_report_in_storage`).
- **Report cycle**: `get_next_report_date` walks quarter-end dates
  (0331/0630/0930/1231) and `acquire_performance_report` fetches all reports
  between the last stored date and the latest possible date.
- `get_stock_data(ticker)` is the single entry — **纯 TDX 按需链路，无 akshare
  回退**：`ensure_stock(ticker)`（storage 无该股票 → `build_overview` →
  `StockOverview` **全量 22 值位置构造，无 `[1:]` 切片**（TDX 概览恰 22 列含
  代码列，与 akshare spot_em 23 列需 `[1:]` 不同）→ `ChinaStock(name, ticker,
  overview)` → `put_stock`）→ `acquire_historical_data_tdx`（失败记日志不
  阻断）→ `acquire_performance_report_tdx` → return `storage.get_stock(ticker)`。
  `ensure_stock` 失败（overview None）→ `return None`（纯 TDX，无 akshare 兜底；
  `core/llms/tools/get_company_info.py` 的 `raise Exception('Stock not found')`
  由此触发）。
- **单遍拉取（2026-08-02，review #2+#3）**：`get_stock_data(ticker, _scope=None)`
  创建 `FetchScope`（data_acquisition.py 内的拉取去重，方法名与 TdxSource
  同构 `fetch_*`）贯穿三个消费者——各源（daily/snapshot/capital/F10/xdxr）
  每次分析调用只拉一次。**预播种 daily 在 ensure_stock 之前**：首建（storage
  无该股）→ 全量 `max_bars=None` 预拉（覆盖 overview 250 窗口与 history
  全量回填）；已有股票 → 门 helper（`_overview_stale` / `_history_gap` /
  `_reports_stale`，与消费者共用同一实现，不双份逻辑）算本次最大尺寸：
  gap>120 → 全量，否则 250 覆盖两者；三门全 fresh → 零拉取。预播种失败 →
  warning + scope 标记 failed（消费者后续请求空 → 各自降级，保首建不阻断）。
  FetchScope 复用判定按**请求尺寸**（cached_bars ≥ 请求）而非实际行数——
  短历史股票 250 拉取返回 <250 行是完整数据，按 len 判定会错误重拉。三个
  消费者均有 `_scope=None` 可选参数：None → 独立直拉（独立调用语义与既有
  测试不变）；`overview.build_overview` / `reports.build_reports` 同样接受
  `_scope` 透传。
- `ensure_stock(ticker, _build_overview=None, _scope=None) -> bool` — 按需构建
  语义 + 概览 freshness 门（review #1，2026-08-02）：storage 已有 →
  `overview_last_update`（真实 freshness 标记，`update_overview` 同步 +
  commit）**早于当前交易日**（date 比较：同日多次分析稳定，跨交易日必刷新）
  → 重建概览（best-effort：`build_overview` None → `logger.warning` + 保留旧
  概览，仍 `True`）；当日已更新 → `True`（幂等）。`_build_overview` 为测试
  注入点（house style，同 `acquire_performance_report_tdx` 的
  `_fetch_reports`，优先级最高）；`_scope` 透传（review #2+#3，见单遍拉取
  段）。首建 `build_overview` None（无价格来源）→ `logger.error` + `False`。
- `acquire_performance_report_tdx(ticker, _fetch_reports=None, _scope=None) -> bool`
  — storage 无该股票 → `False`；`build_reports` 返回单表多行，批量
  `StockPerformanceReport(*list(row.values()))`（15 列无切片）→
  `add_performance_reports`（单次 commit，report_date 字符串去重）→
  `put_stock` → `True`；`build_reports` None（无报告）→ `logger.warning` +
  `True`（无报告不是失败）。`_scope` 透传（review #2+#3，见单遍拉取段）。
- **业绩 freshness 门**（2026-08-02，对齐日K"先查再拉"）：调 `build_reports`
  （远端 F10）前先读 ZODB 最新 `report_date`（`performance_reports[-1]`，无报告
  → 门未命中直接拉）。门命中 = 最新 `report_date` == 最近一个已到截止日的季度末
  （`_latest_past_quarter_end(asia_today())`，与 `get_latest_possible_report_date`
  同季度末推算 0331/0630/0930/1231，'%Y%m%d' 字符串比较）→ `logger.debug` +
  `True`（不拉远端）。披露滞后语义：公司未披露当期 → F10 最新期仍为上一季 →
  门未命中 → 照常拉取（旧期由 `add_performance_report` 去重；同季重复拉直到
  披露）——只承诺"该季截止日已过且已入库则不重复拉"，不引入跨季补拉。
  `_fetch_reports` 为测试注入点（house style 无 mock 框架，计数包装验证门跳过
  时不触发网络）。
- akshare 方法（`acquire_daily_overview` / `acquire_performance_report` /
  `update_*_overview` / `acquire_historical_data` / `get_next_report_date` /
  `get_latest_possible_report_date` / `build_performance_report_from_row` /
  `add_performance_report_in_storage` / `update_overview_in_storage`）
  **迁出至 `core/legacy_akshare.py`**（2026-08-02，review #10）：`YJBB_COLUMN_MAP`
  随迁；`DataAcquisition(LegacyAksharePaths)` mixin 继承——`da.update_*(...)`
  等既有调用与测试引用不变（deprecated 测试照常 skip）。主流程文件减半，
  备用路径可独立演进。
- **AKShareSource 惰性导入**（2026-08-02）：`core/data_acquisition.py` 与
  `core/legacy_akshare.py` 均无模块级 akshare import——每个 deprecated 方法
  内部局部 import，纯 TDX 启动不付出
  akshare 重依赖成本（`import core.data_acquisition` 不触发 akshare 加载，
  test_module_import_lazy_akshare 钉死）。
- `acquire_historical_data_tdx(ticker, _scope=None)` — freshness-first + boolean
  协议；chain: `TdxSource.fetch_finance_capital`（流通股本, 失败降级 → 换手率
  NaN）→ `fetch_daily` (失败 → `False`) → `fetch_xdxr` (失败降级 → 未复权) →
  `mapping.to_akshare_hist_schema` → `adjust.qfq_adjust` → 批量
  `ChinaStockData(*list(row.values()))` → `add_datas`（单次 commit，review #3）。
  `_scope` 透传（review #2+#3，见单遍拉取段）。
  See `data_source/index.md` for the layer contracts.

`self.storage = get_zodb_storage()` in the constructor — a lazy **process-wide
singleton** in `ZODBStorage.py` (FileStorage flock 不可重入，同进程第二个实例
会 LockError；spec 原称"module-level singleton"，现已落地为 `get_zodb_storage`).
Keep it that way; do not add a second storage abstraction.

## InvestmentCommittee (`core/investment_committee.py`)

- `make_investment_committee(config, progress_updater=None, _llm=None)` builds
  a `StateGraph(State)` with the **seven agent nodes**（7 节点 12 边）and
  **三对并行边**（2026-08-02，review #4；2026-08-04，08-04-adversarial-
  verdict-loop +2 revise 节点）：`START → fundamental` 与 `START → trend`
  并行（都只依赖 `stock_information`），`fundamental → bullish/bearish` 与
  `trend → bullish/bearish` 并行（都只依赖两份报告），
  `bullish/bearish → bullish_revise/bearish_revise`（对抗修订轮——各
  revise 双入边 join 两份初稿，互相独立保持并行），两份修订版 →
  `investment_manager → END`。LangGraph 多入边 = **隐式 join**：trader 等
  两上游都完成、revise 等两份初稿都完成（否则对方初稿缺失）、manager 等
  两份修订版都完成——墙钟 7 串行 → 4 阶段。并行分支写不同 State key
  （无写冲突），`messages` 由 add_messages reducer 合并（顺序不确定——
  display 只读最终 state，不依赖顺序）。
- `_llm` 为测试注入点（house style 无 mock 框架）：默认 `DeepSeekApi()`；
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
  文本) 拼接——顺序：个股信息 → 技术指标 → 财务指标 → 实时情报，
  四段 display 与 make_investment_decision 共用。不改 State/图/agent
  模式。工具在函数内 import，避免无 key 环境的模块级副作用。
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
- New agents mean: new node registration here, a new edge, a new `State` key,
  and a new prompt in `core/llms/prompt.py`.

## StockOutputFormatter (`core/stock_output_formatter.py`)

- `format_stock_output(stock) -> str` builds the fixed report layout the LLM sees:
  overview line, last 60 daily bars, last 20 performance reports.
- It is a **pure string builder** — no I/O, no data acquisition. Never let it
  fetch or write data.
- **2026-08-02 修复（NaN 渲染）**：所有数值经 `utils.formatting.fmt_number`
  （与 `get_trend_indicators._fmt` 共用单点实现）渲染——NaN/None → "N/A"、
  数值保留两位小数。TDX 路径恒有 NaN 字段（量比/涨速/5分钟、盘中换手率与
  成交量、历史首行振幅/涨跌幅、F10 缺失指标），旧实现直接把 str(float) 拼进
  prompt（nan%/nanlots 字面）；golden 断言无字面 'nan'。
- Known quirk: line 1 imports `output` from `openpyxl.styles.builtins` and then
  shadows it with a local `output` variable — a dead import, leave it (see
  `architecture.md`).

## Streamlit UI (`core/ui/display.py`)

- `write_ui()` renders the Chinese UI: ticker form with 6-digit validation, five
  report tabs, and a `status.empty()` container passed as `progress_updater` so
  agents can stream progress into it.
  **2026-08-02**：BJ 代码（4/8 前缀，`tdx_source.is_bj_ticker`）提交时直接
  `st.error` 明确提示不支持（TDX 不覆盖 BJ 证券），不静默 NaN。
- **2026-08-02（enrichment 真实接入）**：display 构造 `stock_information` 调用
  `build_stock_information(ticker)`（与 `make_investment_decision` 共用组装
  点）——技术指标与 TDX 实时情报段真实进入 agent 上下文；无 `TDX_API_KEY`
  时情报段为降级占位文本。
- **2026-08-02（UI 层错误守护）**：`build_stock_information` 与事件循环
  包 try/except（error-handling spec 允许的 UI 守护边界）——图后台线程的
  异常经队列回抛（error 事件 → raise），失败 `st.error` 中文提示 +
  `logger.exception`，不裸 traceback 红屏、不吞错误。
- **2026-08-02（日志）**：各 agent 的 Query/Response debug 日志是结果
  唯一打印点（display 不再重复打 Assistant 行）；`main.py` 的
  `_ensure_file_handler()` 幂等注册文件 handler——Streamlit 每次 rerun
  重执行 main.py 顶层代码，裸 `logger.add` 会叠加同文件 handler（实测
  同毫秒时间戳 2-14 份重复；用私有 `handler._sink._file_path` 判定已存在
  路径后跳过）。
- **2026-08-02（queue bridge：进度实时上屏 + 报告节点级填充）**：并行
  节点在 LangGraph 工作线程，Streamlit DeltaGenerator 只能在脚本线程
  enqueue——旧方案（sync stream 循环内渲染）只能按 superstep 填充
  （2-2-1：同一 superstep 的并行节点更新一起到达），且并行节点进度被
  safe_progress 降级丢弃。现架构：`ProgressBridge`（core/llms/progress.py，
  `info`/`push_report` 都是线程安全 `queue.put`，永不抛）作为
  progress_updater 传给图；`graph.stream` 在**后台线程**驱动
  （`_stream_graph_events`：superstep update 的报告入队作兜底、异常与
  sentinel 入队）；脚本线程 `events.get()` 循环实时渲染——进度 →
  status 容器，报告 → 对应 Tab。每个 agent 在 LLM 返回后调 `push_report`
  （core/llms/progress.py helper，None/非 bridge no-op）——报告**节点级
  即时到达**（1-1-1-1-1，实测 asymmetric 延迟：fast 节点 0.5s 即到，
  不等同 superstep 的慢节点 3s）；`rendered` 集合按 **(key, content)** 对
  去重（agent push 先到渲染，superstep update 同内容后到跳过；
  08-04-adversarial-verdict-loop 起 opinions key 推送两次——初稿 + 修订版
  ——同 key 不同内容 → **追加渲染**，观点 tab 依次显示初稿 → 修订版；
  08-04-ui-opinion-round-labels 起追加渲染带**轮次计数**：`counts` 按 key
  计数（替代 `rendered_keys` 首次渲染标记，行为等价），通用轮次计数（非
  "初稿/修订版"字样），未来多轮互驳每轮追加自然成为第 3、4 次观点；
  08-05-ui-opinion-expanders 起观点 key（`OPINION_REPORT_KEYS` =
  bullish_opinions / bearish_opinions）渲染为**可折叠条目**：每份观点一个
  `st.expander("第 {n} 次观点", expanded=(n == 1))`——第 1 次默认展开、
  后续默认折叠（用户先见初稿，修订版点击展开，不占空间）；非观点 key
  单次渲染保持平铺（header + 内容））。
  图失败 → error 事件回抛 → 既有 st.error 守护。
- **流式渲染契约（2026-08-02）**：`REPORT_TABS` 五元组（state key → Tab
  标题）顺序 = `st.tabs` 中报告 Tab 的创建顺序（数据 Tab 插入不影响相对
  顺序），渲染 dispatch 依赖该契约；`_report_content`
  消化两种值形态——stream update 中报告为**原始字符串**（节点返回即写，
  reducer 未应用；实测 2026-08-02），最终 state 里 bullish/bearish 为
  add_messages 消息列表（`[-1].content`，见 `agents/index.md`）——展示
  语义与旧实现一致。`iter_report_items` / `_report_content` 为纯函数
  （与 Streamlit 解耦，display.py 仍是薄渲染层），离线测试喂合成 update
  验证映射（`test/core/ui/test_display.py::TestDisplayIncrementalRender`）。
- **2026-08-02（采集数据 Tab）**：`st.tabs` 六元组——「采集数据」
  （`DATA_TAB_TITLE` 常量）放**最前**，后接五报告 Tab（顺序不变）。
  `build_stock_information` 成功返回后、`graph.stream` 前填充：
  `st.header(DATA_TAB_TITLE)` + `st.markdown(...)`。异常路径
  （`st.error` + return）不填充不占位；技术指标/实时情报的降级占位
  文本原样透传。display 保持薄渲染层：不新增数据解析/格式化逻辑。
- **2026-08-02（采集数据 markdown 表格化）**：`core/ui/data_markdown.py`
  纯函数模块把定宽文本转成带表格的 markdown——`to_markdown_tables(str)`
  分节（概览/日K/业绩/指标/情报）逐节转表：行内 token 按 `, ` 切分，
  兼容 `Key: value` / `Key=value` / `label 数值` 三种形态（业绩段
  YoY/QoQ 无冒号标签，rpartition 空格 + 数值判定）；指标行
  `label: K=V` 融合 token 递归展开；**多行且键集合一致 → 列向表**
  （日K 8 列 / 业绩 9 列），单行或键不一致 → 扁平两列表（指标|数值）；
  `KEY_LABELS` 英文 key → 中文标签，未知 key 原样透传；降级占位文本
  （无键值形态）原样透传不吞。**约束**：`stock_information` 同时是
  LLM 上下文（build_stock_information 唯一组装点）——只改展示端，
  源头文本零改动（方案 B，2026-08-02 确认）。测试
  `test/core/ui/test_data_markdown.py`（离线合成输入，house style）。
- `get_state_history` 现仅测试消费（如 `test_graph_parallel._run_graph`
  取最终 state 断言）；UI 不再调用。保留 committee API
  （`make_investment_committee` / `make_investment_decision`）不变。
- **2026-08-05（主题:dark mode 与整体打磨,08-05-ui-dark-mode-theme）**：
  - **Streamlit 版本基线 1.61.1**（环境与 requirements.txt 同步,自 1.50.0
    升级）：1.51.0 起支持 `[theme.light]`/`[theme.dark]` 分主题表（亮暗
    两套独立色板）；Settings 主题选择持久化（1.54+ 含 #13306 修复）；1.61
    起内置 uvicorn 服务。改动前先核对安装版与 pin（requirements.txt 可能
    领先/落后环境）。
  - **`.streamlit/config.toml`**：`[theme]`（base="light" + font）+
    `[theme.light]`/`[theme.dark]` 两套色板——品牌红（A 股语境）亮色
    `#D32F2F`（白底对比 4.6:1）/ 暗色 `#EF5350`（暗底可读）；中性色沿用
    Streamlit 官方默认；`baseRadius = "0.5rem"`（**注意**：旧
    `borderRadius` 选项已移除更名 `baseRadius`，light/dark 分表均支持）。
    初始主题跟随系统偏好，用户 Settings 切换。系列色键（redColor 等）
    当前无图表消费不配置。
  - **`core/ui/theme.py`** 纯常量模块（无 Streamlit import，离线可测）：
    `PALETTE`（亮暗色板，与 config.toml 同值——`test/core/ui/
    test_theme.py` 用 tomllib 解析钉死一致性，防两份配置漂移）+
    `CSS`（注入样式，**不含** `<style>` 标签，display 用 `st.html` 包装）。
    色板注入用 `string.Template`（$占位）——**不要换回 %-formatting**：
    CSS 文本里 % 常见（width: 100%），裸 % 会被当转换符（实测踩坑）。
    主题感知选择器用 `@media (prefers-color-scheme: light/dark)` 媒体
    查询——1.61.1 前端把激活主题同步到 iframe 根元素 color-scheme，
    媒体查询精确匹配 Streamlit 主题而非 OS 偏好（改动前在浏览器实测，
    失效回退 `html[data-theme]`）。打磨范围：表格（表头品牌色下边框/
    斑马纹/圆角）、expander（悬停主色）、alert 圆角、紧凑页距、wide 布局。
  - **display.py 接线**：`st.set_page_config`（标题/📈/wide）必须是首个
    st 调用（Streamlit 要求，ast 测试钉死）；`st.html` 注入样式。渲染
    流程/事件循环/tab 契约零改动。**涨跌幅红绿染色记为后续增强**（需
    解析文本,违反薄渲染层约束,不在本次范围）。

- Doing akshare calls directly outside `data_source/` — `DataAcquisition` is the
  only caller of `AKShareSource`.
- Reading/writing ZODB directly outside `data_storage/` — go through
  `ZODBStorageInstance` methods.
- Adding business logic into `display.py`; it should stay a thin render layer.
- Calling `get_stock_info` inside the graph build — it is invoked once by the
  caller and passed in `stock_information`.
