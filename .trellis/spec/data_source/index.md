---
description: Data source conventions — akshare wrappers and DataFrame→dataclass positional mapping
paths:
  - data_source/**
---

# Data Source (`data_source/`)

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
- **既有映射疑点（未修，待流程梳理任务实测）**：akshare 源码显示
  `stock_zh_a_hist` 的"股票代码"列在**末尾**（日期,开盘,收盘,最高,最低,成交量,
  成交额,振幅,涨跌幅,涨跌额,换手率,股票代码），`stock_*_a_spot_em` 第 2 列是
  "_" 占位——与位置构造假设（ticker 第 2 位）不匹配。本环境东方财富端点不可达
  无法实测实际输出；若实测确认错位，需按列名构造或调整映射（TDX 路径的
  `mapping.to_akshare_hist_schema` 输出 12 列序与 ChinaStockData 字段**对齐**，
  不受此影响）。
- **`stock_yjbb_em` 列序实测（2026-08-02，源码级，1.18.81）**：最终输出恰
  16 列（列名已过滤中间 `_` 占位）：序号/股票代码/股票简称/每股收益/营业总收入-
  营业总收入/营业总收入-同比增长/营业总收入-季度环比增长/净利润-净利润/净利润-
  同比增长/净利润-季度环比增长/每股净资产/净资产收益率/每股经营现金流量/销售
  毛利率/所处行业/最新公告日期。**位置构造例外（prd 授权，2026-08-02）**：
  `core/data_acquisition.py` 的 `acquire_performance_report`（akshare 备用路径）
  已改按列名映射构造（`YJBB_COLUMN_MAP` 列名 → `StockPerformanceReport` 字段）+
  列名存在性断言（缺失 → `logger.error` + 返回 False 不写库）——yjbb 列序曾在
  版本间插入过 `_` 占位列，位置构造会静默错位写垃圾；列名映射对列序变化健壮。
  此例外仅限 yjbb 备用路径，TDX 路径（`build_reports` 15 列序契约）与其余
  akshare 端点保持位置构造。

## TdxSource (`data_source/chinese_mainland/tdx/`)

pytdx (通达信直连) 数据源，**全链路主数据源**（历史行情 + 个股概览 + 业绩
报告）；akshare 为备用路径（主流程不调用，原方法保留）。结构：

- `vendor/` — vendored [tdx_quant](https://github.com/henrylin99/tdx_quant)
  快照（55 文件，`VENDOR.md` 记录上游 commit）。`tdx_source.py` 模块级调用
  `ensure_vendor_on_path()` 把 vendor 根插入 `sys.path`（幂等），上游绝对导入
  `scripts.*` 原样可用。**不要直接改 vendor 代码**——更新走重拷流程。
- `tdx_source.py` — `TdxSource` 薄包装，方法级对应 `TdxDownloader`：
  `fetch_daily/minute/xdxr/finance_capital/company_finance/security_list/
  snapshot/index`，返回原始 DataFrame，不吞异常（非法代码抛 `ValueError`）。
  另有构建入口（委托 overview.py/reports.py）：`build_overview(ticker) ->
  pd.DataFrame | None`、`build_reports(ticker) -> pd.DataFrame | None`、
  `get_stock_name(ticker) -> str`。名称索引模块级缓存
  `_NAME_INDEX: dict[tuple[int, str], str]`（**(market, code)** 键——SH 列表
  含指数代码，纯 code 键会撞车；market 由 `infer_hq_market` 推断），失败回退
  ticker 本身（name 永不 NaN）。**2026-08-02 修复**：`_NAME_INDEX_LOADED`
  仅两市场都成功才置 True——任一市场失败保持未加载，下次 `get_stock_name`
  重试（不固化部分索引）。模块函数 `is_bj_ticker(ticker)`（4/8 前缀）供
  入口处拦截北交所代码（TDX 全链路不可用）。
- `overview.py` — `compose_overview(...)` 纯函数 + `build_overview`：输出**恰
  22 列**（含代码列），与 `StockOverview` 22 字段序一致，消费者**全量位置构造
  `StockOverview(*list(row.values()))`（无切片）**——与 akshare spot_em 路径
  （23 列含序号需 `[1:]`）不同，勿混淆。PE/PB/市值/涨跌幅/60日/ytd 均由
  snapshot/F10/股本/日K 派生；量比/5分钟/动量 = NaN（pytdx 无）。逐源降级：
  单项失败 → 该源字段 NaN + `logger.warning`；snapshot 与日K 均无价格来源 →
  None。日K 窗口 `max_bars=250`（覆盖 60 日前 + 年初窗口）。
  **2026-08-02 修复**：YTD 基准 `_ytd_base_close(daily, today)`——窗口含
  上年末 bar → 用上年最后一根收盘（年初首日不把当日自身当基准，YTD 不漏
  首日）；末根 bar 年份 ≠ 当年（跨年停牌）→ YTD NaN；无上年 bar → 回退当年
  首根。`latest_period_value` 先 `dropna(subset=["period"])` 再 idxmax——
  NaN period 的 astype(str)='nan' 字典序最大，会掩盖真实最新期。`today`
  默认 `asia_today()`（北京时间）。
- `reports.py` — `compose_reports(...)` 纯函数 + `build_reports`：F10 tidy
  long（metric/period/value_num）→ pivot 每期一行，输出**恰 15 列** =
  `StockPerformanceReport` 15 字段序（含 ticker），全量位置构造。QoQ 环比
  (本期-上期)/上期×100：period 升序（ISO 字符串序）后计算、首期 NaN、只防
  除零（负分母合法——净利可为负，与 overview `_divide` 的"分母≤0→NaN"有意
  区分）。**2026-08-02 修复**：QoQ 相邻性校验（`_qoq_series` 按 period 索引
  转日期，间隔 ∈ [88,93] 天恰为一季度才算环比，缺报告期跨 2+ 季度 → NaN）；
  `industry` 输出空串 `""`（float NaN 写进 `StockPerformanceReport.industry:
  str` 污染类型契约；`sales_gross_margin` 保持 float64 NaN）；已知 8 指标
  命中率 < 50% → `logger.warning`（vendor metric 改名检测）。
  `report_date` 输出 '%Y%m%d' 字符串。缺指标列用 `reindex` 补 NaN
  （`wide[list(...)]` 会 KeyError）。F10 失败/空 → None + `logger.warning`。
- `mapping.py` — `to_akshare_hist_schema(df, ticker, float_shares=None)`：
  pytdx bars → akshare `stock_zh_a_hist` 12 列序（日期/股票代码/开盘/收盘/
  最高/最低/成交量/成交额/振幅/涨跌幅/涨跌额/换手率），使既有
  `ChinaStockData(*list(row.values()))` 位置构造零改动复用。
  日期列输出 **`datetime.date` 对象**（`add_data` 按 `data.date >
  last_data_update` 比较）；成交量单位与 akshare 一致（手）；首行无前收盘，
  振幅/涨跌幅/涨跌额 NaN。**2026-08-02 修复**：`vol` 先 `fillna(0)` 再
  `.astype("int64")`（NaN vol 直接 astype 抛 IntCastingNaNError，在
  `acquire_historical_data_tdx` 的 try 之外炸整条链）；换手率分支改
  `float_shares is not None`（0.0 显式传入 ≠ 未传，走计算路径而非静默 NaN）。
- `adjust.py` — `qfq_adjust(bars12col, xdxr)` 前复权，对齐 akshare `qfq`。
  实测约定：xdxr 的 `fenhong/songzhuangu/peigu` 是**每10股单位**（除 10），
  `peigujia` 为元/股；事件用事件日前最后一根未复权收盘算因子；先累乘因子再
  应用；复权后重算振幅/涨跌幅/涨跌额（除权跳空消除）。无事件 = 恒等变换。
  **2026-08-02 修复**：事件字段取值 `v if pd.notna(v) else 0.0`（
  `float('nan') or 0` 得 nan——nan 为 truthy，因子被污染 → 事件前 bar 价格/
  成交量全 NaN）；`ratio_vol <= 0`（如 10:1 缩股）→ 跳过成交量调整 +
  `logger.warning`（价格因子照算）；调整后成交量 `round().astype("int64")`
  舍回整手（小数手无意义 + 避免 int64 列原地乘小数因子的 FutureWarning——
  旧 NaN 污染把列静默变 float64 掩盖了该问题）。

新数据源仍遵循同一形状：class per source、method per endpoint、raw DataFrame
out；DataAcquisition 是唯一消费者。

## DataFrame → Dataclass Mapping

The codebase constructs persistent dataclasses from akshare rows **positionally**,
so field order in the dataclasses must match akshare column order:

```python
StockOverview(*list(row.values())[1:])        # first column dropped (ticker)
ChinaStockData(*list(row.values()))           # all columns kept
StockPerformanceReport(*list(row.values())[1:])
```

See `core/data_acquisition.py` and `test/data_source/test_akshare.py`.

- The dropped first column differs per endpoint — verify against akshare output
  before adding a new mapping.
- This is **column-order coupling**: akshare column renames are fine, but
  reordering akshare columns (or dataclass fields) silently misaligns fields.
  When changing either side, run `test/data_source/test_akshare.py` and the
  DataAcquisition tests.
- Do not "fix" mappings by switching to keyword construction without checking
  every construction site (DataAcquisition + tests) — keep the pattern uniform.
  **唯一例外**：`stock_yjbb_em` 业绩报表行（列名曾在版本间变化，见上"列序实测"
  段）按列名映射构造，其余端点一律位置构造。

## Tests

`test/data_source/test_akshare.py` is a live smoke test: it calls the real APIs
and constructs each dataclass from real rows. Needs network access; akshare
endpoints can be slow or rate-limited (README notes first load can take 10+ min).

## Anti-Patterns

- Importing `akshare` outside `data_source/` — always go through `AKShareSource`.
- Wrapping/cleaning DataFrames inside `AKShareSource` — return raw; consumers
  (DataAcquisition) do the conversion.
- Constructing dataclasses from dict keys (`**row`) — the local pattern is
  positional with `list(row.values())`.
