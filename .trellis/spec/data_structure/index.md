---
description: Data structure conventions — persistent dataclasses, numpy field types, ChinaStock behavior
paths:
  - data_structure/**
---

# Data Structures (`data_structure/`)

## Persistent Dataclass Pattern

All market data models in `data_structure/chinese_mainland/` follow one shape:

```python
from dataclasses import dataclass
import persistent
from numpy import float64

@dataclass
class StockOverview(persistent.Persistent):
    ticker: str
    name: str
    latest_price: float64
    ...
```

- `@dataclass` + `persistent.Persistent` base — ZODB-storable value objects
  (`StockOverview`, `StockPerformanceReport`, `ChinaStockData`, `StockInfo`).
- Numeric fields typed as **numpy scalars** (`float64`, `int64`) — akshare
  returns numpy types and the dataclasses preserve them without casts.
- Field **order matters**: positional construction from DataFrame rows
  (`StockOverview(*list(row.values())[1:])`) means the declared field order must
  match akshare column order — see `data_source/index.md`.
- `date` / `report_date` fields are loose (`object` / `str`): `ChinaStockData.date`
  is a datetime-like object; `StockPerformanceReport.report_date` is a
  `'%Y%m%d'` **string**, and `DataAcquisition` compares them as strings
  (`get_next_report_date` cycle). Keep both formats as they are.
- `StockInfo` exists but is only exercised in `test/data_source/test_akshare.py`;
  `ChinaStock.update_overview` **写 `self.overview`**（2026-08-02 修复：原写
  `self.info` → formatter 永远读构造时的陈旧概览；现 overview 是唯一写入
  槽位）；`info` 字段保留仅为兼容既有序列化数据，不再写入。`add_info` /
  `get_info` 已删除（无引用）。

## ChinaStock (`ChinaStock.py`)

`ChinaStock(persistent.Persistent)` is the aggregate root: `name`, `ticker`,
`datas` (PersistentList), `performance_reports` (PersistentList), `overview`,
`info`, `overview_last_update`, `last_data_update` (seeded from
`utils.constants.default_start`).

Behavior rules:

- `add_data(data)` — **dedupes by date**: rejects data not newer than
  `last_data_update`, then advances `last_data_update`. Keeps daily bars sorted
  ascending by construction.
- `add_performance_report(report)` — rejects reports whose `report_date`
  (`'%Y%m%d'` string compare) is not newer than the last one.
- Every mutating method ends with `transaction.commit()` — the persistent-object
  write pattern (see `data_storage/index.md`). (`update_overview` 同步
  `overview_last_update` + commit；`add_info`/`get_info` 已删，勿再添加。)
- Constructor signature is `(name, ticker, overview)` — the tests that call
  `ChinaStock('dummy')` (`test/data_structure/test_ChinaStock.py`,
  `test/data_storage/test_ZODBStorage.py`) are stale and broken; new tests must
  pass all three arguments.

## Adding a New Structure

1. Copy an existing class (closest field shape) — do not invent a new pattern.
2. Match akshare column order if the fields come from a DataFrame row.
3. If the dataclass lives inside ZODB, it must extend `persistent.Persistent`.
4. Register usage in `data_acquisition.py` (or the owning service) — dataclasses
   are not standalone; nothing should construct them ad hoc.

## Anti-Patterns

- Plain `float`/`int` annotations on fields fed from akshare — use numpy types.
- `datetime` typing on `report_date` — the codebase compares `'%Y%m%d'` strings.
- Dedupe logic re-implemented outside `ChinaStock.add_data` /
  `add_performance_report` (e.g. in `DataAcquisition`).
- Committing inside the dataclass for reads — only mutations commit.
