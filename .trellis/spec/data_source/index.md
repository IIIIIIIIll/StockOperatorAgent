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

## TdxSource (`data_source/chinese_mainland/tdx/`)

pytdx (通达信直连) 数据源，历史行情主路径；akshare 兜底。结构：

- `vendor/` — vendored [tdx_quant](https://github.com/henrylin99/tdx_quant)
  快照（55 文件，`VENDOR.md` 记录上游 commit）。`tdx_source.py` 模块级调用
  `ensure_vendor_on_path()` 把 vendor 根插入 `sys.path`（幂等），上游绝对导入
  `scripts.*` 原样可用。**不要直接改 vendor 代码**——更新走重拷流程。
- `tdx_source.py` — `TdxSource` 薄包装，方法级对应 `TdxDownloader`：
  `fetch_daily/minute/xdxr/finance_capital/company_finance/security_list/
  snapshot/index`，返回原始 DataFrame，不吞异常（非法代码抛 `ValueError`）。
- `mapping.py` — `to_akshare_hist_schema(df, ticker, float_shares=None)`：
  pytdx bars → akshare `stock_zh_a_hist` 12 列序（日期/股票代码/开盘/收盘/
  最高/最低/成交量/成交额/振幅/涨跌幅/涨跌额/换手率），使既有
  `ChinaStockData(*list(row.values()))` 位置构造零改动复用。
  日期列输出 **`datetime.date` 对象**（`add_data` 按 `data.date >
  last_data_update` 比较）；成交量单位与 akshare 一致（手）；首行无前收盘，
  振幅/涨跌幅/涨跌额 NaN。
- `adjust.py` — `qfq_adjust(bars12col, xdxr)` 前复权，对齐 akshare `qfq`。
  实测约定：xdxr 的 `fenhong/songzhuangu/peigu` 是**每10股单位**（除 10），
  `peigujia` 为元/股；事件用事件日前最后一根未复权收盘算因子；先累乘因子再
  应用；复权后重算振幅/涨跌幅/涨跌额（除权跳空消除）。无事件 = 恒等变换。

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
