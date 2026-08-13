---
description: Data source — AKShareSource 薄包装 + BillionsClient + 测试；子规范: TdxSource/映射
paths:
  - data_source/chinese_mainland/akshare/**
  - data_source/chinese_mainland/billions/**
---
# Data Source (`data_source/`)

## Layer Specs

| Topic | Spec | When to read |
|-------|------|--------------|
| TdxSource（`data_source/chinese_mainland/tdx/`，含 TS 移植补充与日K 缓存待办） | [tdx.md](./tdx.md) | Editing the TDX source, overview/reports builders, F10 parser, adjust/mapping |
| DataFrame → Dataclass 命名构造（`from_row` + `column_map`） | [mapping.md](./mapping.md) | Adding a persistent dataclass, changing column constants, or `from_row` semantics |

## AKShareSource (`data_source/chinese_mainland/akshare/fetch_stcok_data.py`)

The only module that talks to akshare. Local patterns:

- `AKShareSource` is a **thin wrapper**: one method per akshare endpoint, no
  business logic. Methods return the raw pandas DataFrame untouched:
  - `fetch_shex_stocks()` / `fetch_szex_stocks()` / `fetch_bjex_stocks()` —
    spot listings via `ak.stock_*_a_spot_em()`
  - `fetch_stock_info(ticker)` — `ak.stock_individual_info_em`
  - `fetch_stock_history(ticker, look_back_days=120)` — `ak.stock_zh_a_hist`,
    `adjust="qfq"`, date range from `timedelta`
  - `fetch_performance_report(date)` — `ak.stock_yjbb_em` (`'%Y%m%d'` string)
- New data sources should follow this shape: class per source, method per
  endpoint, raw DataFrame out.
- Note the filename typo `fetch_stcok_data.py` — intentional to keep, renaming
  breaks imports (`core/data_acquisition.py:2`, `test/data_source/test_akshare.py:1`).
- **akshare 版本注记**（2026-08-02 升级 1.18.25 → 1.18.81，源码级对比确认 4 个
  使用中接口列序零变化：`stock_zh_a_hist` / `stock_*_a_spot_em` / `stock_yjbb_em`
  / `stock_individual_info_em`）。
- **既有映射疑点（08-09 命名构造后已消除）**：akshare 源码显示
  `stock_zh_a_hist` 的"股票代码"列在**末尾**（日期,开盘,收盘,最高,最低,成交量,
  成交额,振幅,涨跌幅,涨跌额,换手率,股票代码），`stock_*_a_spot_em` 第 2 列是
  "_" 占位——位置构造假设（ticker 第 2 位）下会静默错位。本环境东方财富端点
  不可达无法实测实际输出；命名构造（`from_row` 按列名取值）后列的位置不再
  承重——无论"股票代码"在第二还是末尾都正确取值，列漂移只可能 KeyError。
- **`stock_yjbb_em` 列序实测（2026-08-02，源码级，1.18.81）**：最终输出恰
  16 列（列名已过滤中间 `_` 占位）：序号/股票代码/股票简称/每股收益/营业总收入-
  营业总收入/营业总收入-同比增长/营业总收入-季度环比增长/净利润-净利润/净利润-
  同比增长/净利润-季度环比增长/每股净资产/净资产收益率/每股经营现金流量/销售
  毛利率/所处行业/最新公告日期。akshare 备用路径（`core/legacy_akshare.py`）
  按列名映射构造（`YJBB_COLUMN_MAP` 字段 → 列名，from_row 传入 +
  `report_date` overrides）+ 列名存在性断言（缺失 → `logger.error` + 返回
  False/None 不写库）——yjbb 列序曾在版本间插入过 `_` 占位列，命名构造对
  列序变化健壮；该先例（2026-08-02）即 08-09 全量命名构造的原型。

## BillionsClient (`data_source/chinese_mainland/billions/client.py`)

亿信 Fin 开放平台薄包装（2026-08-08，08-08-billions-api-integration）。**与
TDX/akshare 不同**：不产出 DataFrame——4 个 REST 端点（全 POST，网关
`https://openapi.billionsintelligence.com/api`，鉴权 `X-API-KEY` 头），
返回**原始响应 dict**，字段提取在消费方。形态仍是 class per source /
method per endpoint：

- `__init__(_http=None, _key=None)` — `_http` 注入 httpx 实例（测试 fake）、
  `_key` 注入覆盖 env `BILLIONS_API_KEY`；httpx.Client 懒加载（函数内懒
  import，无 key 环境零副作用）
- 方法：`fin_db(query, data_sources=None)`（默认 auto 路由）/ `search(query,
  source, search_mode, count, time_range)` / `twitter_search(query,
  search_mode, count)` / `fetch(url=None, doc_id=None, page=None, max_chars=None)`
- 超时参数化：fin_db 120s；search/twitter 按档位 fast 25 / advanced 70 /
  expert 120（服务端等待 15/60/110 + 10s 余量）；fetch 90s
- **错误归一化**：网络异常 / HTTP 非 2xx / 200 + `success:false`（上游超时
  语义）→ 抛 `BillionsApiError(code, status_code, message)`（**唯一自定义
  异常**，wrapper-source 例外，见 error-handling spec）；**不重试**（429 是
  配额，重试无意义）。消费方（亿信工具/前置段/分析师）catch → 占位文本
- 业务语义：HTTP 200 仅表示已处理，成败看 `success` + `result[].status`；
  search 结果 `extra.institution` 为研报机构名（无作者字段）、`doc_id`
  仅 announcement 开放全文；字段允许缺失，调用方容错

开关门控见 `utils/billions_config.py`（`billions_enabled(cap)` /
`billions_max_calls(cap, default)`，truthy 语义对齐 `WEB_SEARCH_DISABLED`：
`("", "0", "false", "no")` 视为关）。API 完整 schema 存档：
`.trellis/tasks/08-08-billions-api-integration/research/billions-api.md`。

## Tests

`test/data_source/test_akshare.py` is a live smoke test: it calls the real APIs
and constructs each dataclass from real rows. Needs network access; akshare
endpoints can be slow or rate-limited (README notes first load can take 10+ min).

## Anti-Patterns

- Importing `akshare` outside `data_source/` — always go through `AKShareSource`.
- Wrapping/cleaning DataFrames inside `AKShareSource` — return raw; consumers
  (DataAcquisition) do the conversion.
- Constructing dataclasses from dict keys (`**row`) or positionally
  (`StockOverview(*list(row.values())[1:])`) — the local pattern is named row
  construction `from_row(row, column_map=...)`: column **names** carry the
  contract (missing column → `KeyError`; extra columns ignored). Positional
  construction was removed in 08-09-named-row-constructors — do not reintroduce it.
