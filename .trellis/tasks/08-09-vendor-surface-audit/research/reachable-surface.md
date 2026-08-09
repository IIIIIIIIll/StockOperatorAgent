# Research: TdxSource 可达面 import 图

- **Query**: 从非 vendor 代码出发的 vendor import 闭包，三态标注 + 行数统计
- **Scope**: internal（grep import 引用闭包 + 离线 import probe）
- **Date**: 2026-08-09

## 入口（非 vendor → vendor，共 4 个生产入口 + 1 个测试入口）

所有入口均经 `ensure_vendor_on_path()`（`tdx_source.py:24-30`，模块级幂等 `sys.path.insert(0, VENDOR_ROOT)`），无其他 sys.path 注入点。测试入口同样调用该函数。

| 入口文件 | 位置 | vendor 目标 |
|---|---|---|
| `data_source/chinese_mainland/tdx/tdx_source.py` | :33 | `scripts.data_pipeline.tdx_client.TdxDownloader`（模块级） |
| 同上 | :34 | `scripts.data_pipeline.fetch_realtime_watchlist.infer_hq_market`（模块级） |
| 同上 | :114 | `scripts.data_pipeline.code_mapping.market_code_to_ts_code`（`fetch_company_finance_raw` 内懒加载） |
| `core/llms/tools/get_market_intel.py` | :26 | `scripts.tdx_mcp.tdx_client.TdxMcpClient` — **直接 import vendor，无非 vendor 包装层**（构造在 `_query_mcp()` 内，受 `TDX_MCP_ENABLED` 开关门控） |
| `core/llms/tools/get_trend_indicators.py` | :27 | `scripts.data_pipeline.indicators.compute_all` |
| `core/llms/tools/extra_indicators.py` | :23-24 | `scripts.data_pipeline.indicators.trend.calc_ema`、`...volatility.calc_atr`（只 import 不修改，vendor 零分叉约束） |
| `test/data_source/test_tdx_screener.py` | :12-13 | `scripts.data_pipeline.screener.conditions.golden_cross`、`...run_screener.RESULT_COLUMNS, screen`（**仅测试入口**） |

## 簇 1：data_pipeline/（48 文件 / 2753 行）

### 1a. TdxDownloader 闭包（经 tdx_source.py 可达，28 文件 / 1644 行）

`scripts.data_pipeline.tdx_client`(492) 直接 import：pytdx_client(111)、tdx_bars(42)、tdx_index_bars(36)、tdx_xdxr(26)、fetch_realtime_watchlist(229，→ pytdx_client + pytdx_exhq_client(60))、code_mapping(8)、jobs/minute_job(50)、jobs/security_list_job(46)、jobs/transaction_job(44)、jobs/minute_time_job(31)、jobs/company_info_job(59)、jobs/finance_capital_job(28)、materializers/symbol_writer(41)。

jobs → extractors（tdx_security_list 31 / tdx_transactions 51 / tdx_minute_time 23 / tdx_company_info 96 / tdx_finance 31）+ materializers（canonical_writer 29 / raw_writer 76）+ normalizers/canonical(90)。包 `__init__`（data_pipeline 1、connectors 1、extractors 1、jobs 5、materializers 1、normalizers 1）随子模块导入被触发。

TdxSource 方法 → vendor 方法映射：`fetch_daily/minute` → `download_daily/minute`，`fetch_xdxr` → `download_xdxr`，`fetch_finance_capital` → `download_finance_capital`，`fetch_company_finance`/`fetch_company_finance_raw` → `download_company_finance`（raw 路径只读缓存 + `market_code_to_ts_code`），`fetch_security_list` → `download_security_list`（security_list_job，当日快照读缓存）。

### 1b. indicators/ 簇（6 文件 / 282 行）— 可达 + 在用

`get_trend_indicators` 经 `indicators/__init__`(26) → core(96)/momentum(42)/trend(40)/volatility(35)/volume(43)；`extra_indicators` 直连 trend.calc_ema、volatility.calc_atr。`compute_all` 为通达信口径技术指标主路径。

### 1c. tdx_mcp/ 可达子集（2 文件 / 287 行）

`get_market_intel.py:26` 直接 `from scripts.tdx_mcp.tdx_client import TdxMcpClient`（**确认：直接 vendor import，无包装**）。`tdx_mcp/__init__.py`(18) 仅 re-export TdxMcpClient/TdxQueryResult，随子模块导入被触发。TdxMcpClient 依赖仅 stdlib + httpx（离线可导入，已 probe）。

## 可达面汇总（生产）

| 状态 | 文件数 | 行数 | 构成 |
|---|---|---|---|
| (a) 可达+在用 | 36 | 2213 | TdxDownloader 闭包 28 文件/1644 行 + indicators 6 文件/282 行 + tdx_mcp 2 文件/287 行 |
| (b) 可达+弃用（有非 vendor 重实现） | 1 | 96 | `extractors/tdx_company_info.py` — 见下 |
| (c) 不可达死面 | 15 | 1580 | 见 dead-surface.md |
| 测试独有（仅 test_tdx_screener.py） | 3 | 330 | screener/ 簇 — 见 screener-finding.md |

## (b) 弃用标注

- `extractors/tdx_company_info.py`(96)：vendor F10 解析器遇表 2 日期头 `break` 丢季度（bug 冻结于 VENDOR.md 零改动约束）；非 vendor `f10_parser.py` 重实现全表并入（`f10_parser.py:7` 文档明确引用该 vendor 解析器）。**仍被生产执行**：`build_reports` raw 缺失/解析失败时回退 vendor 解析 df，`overview` 走 vendor 路径（只需最新期）→ 语义为「可达+在用，但季度表职责已被 f10_parser 取代」。
- PRD 提及的 mapping.py/adjust.py 经核查为**追加式后处理**（mapping 在 TdxSource 输出上加 12 列 akshare 契约与换手率；adjust 做 qfq，vendor 无对应实现），非对特定 vendor 模块的替换——不构成弃用证据。

## Caveats

- 判定基于 grep import 闭包（全量、无动态 importlib 引用）+ 离线 import probe（screener、tdx_mcp.tdx_client 均导入成功、无模块级副作用）；未构造 TdxDownloader（不触发网络）。
- `jobs/__init__.py` 被 tdx_client 闭包触发（包 init 导入 minute_job），无独立生产引用。
