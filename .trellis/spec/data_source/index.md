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
