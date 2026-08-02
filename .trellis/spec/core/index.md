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
  `add_performance_report_in_storage` / `update_overview_in_storage`）**保留
  不删**（备用 + 既有测试引用），但主流程不再调用——docstring 统一标注
  `deprecated（备用路径，主流程不调用）`（2026-08-02）。
- **AKShareSource 惰性导入**（2026-08-02）：`data_acquisition.py` 无模块级
  akshare import——每个 deprecated 方法内部局部 import，纯 TDX 启动不付出
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

- `make_investment_committee(config, progress_updater=None)` builds a
  `StateGraph(State)`, adds the five agent nodes in fixed order, and wires the
  linear chain `START → fundamental → trend → bullish → bearish → investment_manager → END`.
- Compiled with `InMemorySaver()` checkpointer; runtime `config` must carry
  `{"configurable": {"thread_id": "1"}}`.
- `make_investment_decision(target_ticker)` streams the graph with the initial
  state `{"messages": [...], "target_stock_ticker": ..., "stock_information": ...}`.
  `stock_information` 由模块函数 **`build_stock_information(ticker)`**（2026-08-02
  抽出，display 与 make_investment_decision 共用同一组装点——原 enrichment
  只存在于死方法里，display 流程从未执行）生成：`get_stock_info`（stock 缺失
  raise，唯一 raise 点）+ 技术指标 (`get_trend_indicators`，无行情数据降级
  占位) + 实时情报 (`get_market_intel`，无 `TDX_API_KEY` 时降级文本) 拼接
  ——不改 State/图/agent 模式。工具在函数内 import，避免无 key 环境的
  模块级副作用。
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
- **2026-08-02（UI 层错误守护）**：`build_stock_information` 与 `graph.stream`
  包 try/except（error-handling spec 允许的 UI 守护边界）——失败
  `st.error` 中文提示 + `logger.exception`，不裸 traceback 红屏、不吞错误。
- **2026-08-02（日志修复）**：`logger.debug("Assistant: {}", ...)` 正确
  占位符风格（原 `logger.debug("\nAssistant:", value)` 消息被 loguru 丢弃）。
- After streaming, results are pulled from `graph.get_state_history(config)[0].values`
  — including `bullish_opinions[-1].content` (works because the `add_messages`
  reducer wraps agent strings into message lists — see `agents/index.md`).
- The UI is the only consumer of `get_state_history`; keep the committee API
  (`make_investment_committee` / `make_investment_decision`) unchanged.

## Anti-Patterns

- Doing akshare calls directly outside `data_source/` — `DataAcquisition` is the
  only caller of `AKShareSource`.
- Reading/writing ZODB directly outside `data_storage/` — go through
  `ZODBStorageInstance` methods.
- Adding business logic into `display.py`; it should stay a thin render layer.
- Calling `get_stock_info` inside the graph build — it is invoked once by the
  caller and passed in `stock_information`.
