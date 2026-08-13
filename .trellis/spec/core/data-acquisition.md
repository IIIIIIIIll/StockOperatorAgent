---
description: DataAcquisition — freshness-first 采集、纯 TDX 按需链路、单遍拉取、boolean 协议
paths:
  - core/data_acquisition.py
  - core/legacy_akshare.py
---
# DataAcquisition (`core/data_acquisition.py`)

Orchestrates data freshness and ingestion. Local patterns:

- **Freshness-first**: `acquire_daily_overview()` and `acquire_historical_data(ticker)`
  consult the storage layer (`storage.check_need_update_overview()`,
  `stock.last_data_update`) and skip work when data is current.
- **One exchange method per market**: `update_shex_overview` / `update_szex_overview` /
  `update_bjex_overview` iterate `AKShareSource().fetch_*_stocks()` rows and call
  `update_overview_in_storage(row)`.
- **Row → model by named construction (08-09)**: `from_row(row,
  column_map=...)` on the persistent dataclasses — `StockOverview.from_row(row,
  column_map=OVERVIEW_COLUMN_MAP)` (akshare 23 列含序号，map 天然忽略),
  `ChinaStockData.from_row(row, column_map=AKSHARE_HIST_COLUMN_MAP)`,
  `StockPerformanceReport.from_row(row)` (identity). Column **names** carry the
  contract; missing column → KeyError — see `data_source/index.md`.
- **Boolean result protocol**: methods return `True` on success and `False` + a
  `logger.error` when a stock is missing from storage (e.g.
  `acquire_historical_data`, `add_performance_report_in_storage`).
- **Report cycle**: `get_next_report_date` walks quarter-end dates
  (0331/0630/0930/1231) and `acquire_performance_report` fetches all reports
  between the last stored date and the latest possible date.
- `get_stock_data(ticker)` is the single entry — **纯 TDX 按需链路，无 akshare
  回退**：`ensure_stock(ticker)`（storage 无该股票 → `build_overview` →
  `StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)` 命名构造
  （08-09——TDX 22 列与 akshare 23 列共用同一 map，序号列天然忽略，无
  `[1:]` 切片）→ `ChinaStock(name, ticker, overview)` → `put_stock`）→
  `acquire_historical_data_tdx`（失败记日志不
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
  `StockPerformanceReport.from_row(row)`（恒等路径，列名即字段名，08-09）→
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
  `ChinaStockData.from_row(row, column_map=AKSHARE_HIST_COLUMN_MAP)` →
  `add_datas`（单次 commit，review #3）。
  `_scope` 透传（review #2+#3，见单遍拉取段）。
  See `data_source/index.md` for the layer contracts.

`self.storage = get_zodb_storage()` in the constructor — a lazy **process-wide
singleton** in `ZODBStorage.py` (FileStorage flock 不可重入，同进程第二个实例
会 LockError；spec 原称"module-level singleton"，现已落地为 `get_zodb_storage`).
Keep it that way; do not add a second storage abstraction.
