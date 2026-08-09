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
- **Named row construction (08-09-named-row-constructors)**: DataFrame rows →
  dataclass via `from_row(row, *, column_map=None, **overrides)` classmethods
  on `ChinaStockData` / `StockOverview` / `StockPerformanceReport` — column
  **names** carry the contract, not field order. `column_map` maps 字段名 →
  行内列名 (None = 恒等); missing column → **KeyError** (loud failure vs the
  old silent misalignment); extra row columns ignored; `overrides` applied
  after mapping. Column maps live next to the column constants they derive
  from (`OVERVIEW_COLUMN_MAP`, `AKSHARE_HIST_COLUMN_MAP`, `YJBB_COLUMN_MAP`;
  `REPORT_COLUMNS` are field names → identity) — see `data_source/index.md`.
  Field **order** stays stable (ZODB positional data compatibility), but
  positional `*list(row.values())` construction is gone from production.
- `date` / `report_date` fields are loose (`object` / `str`): `ChinaStockData.date`
  is a `datetime.date` object (mapping.py outputs `.dt.date`; keep `object`);
  `ChinaStockData.ticker` is `str`; `StockPerformanceReport.report_date` is a
  `'%Y%m%d'` **string**, and `DataAcquisition` compares them as strings
  (`get_next_report_date` cycle). Keep these formats as they are.
- `StockInfo` exists but is only exercised in `test/data_source/test_akshare.py`;
  `ChinaStock.update_overview` **写 `self.overview`**（2026-08-02 修复：原写
  `self.info` → formatter 永远读构造时的陈旧概览；现 overview 是唯一写入
  槽位）。`info` 死字段已移除（08-09，grep 确认无消费者；既有序列化对象上
  的多余属性不受影响）。`StockInfo.float_market_cap` 与
  `StockOverview.circulating_market_cap` 为语义孪生字段（只加注释，
  不动存储 schema）。`add_info` / `get_info` 已删除（无引用）。

## ChinaStock (`ChinaStock.py`)

`ChinaStock(persistent.Persistent)` is the aggregate root: `name`, `ticker`,
`datas` (PersistentList), `performance_reports` (PersistentList), `overview`,
`overview_last_update`, `last_data_update` (seeded from
`utils.constants.default_start`). (`info` removed in 08-09 — no consumers.)

Behavior rules:

- `add_data(data)` — **dedupes by date**: rejects data not newer than
  `last_data_update`, then advances `last_data_update`. Keeps daily bars sorted
  ascending by construction.
- `add_performance_report(report)` — rejects reports whose `report_date`
  (`'%Y%m%d'` string compare) is not newer than the last one.
- Every mutating method ends with `transaction.commit()` — the persistent-object
  write pattern (see `data_storage/index.md`). (`update_overview` 同步
  `overview_last_update` + commit；`add_info`/`get_info` 已删，勿再添加。)
- **mutator commit 参数（2026-08-09，08-09-tdx-singleton-and-transactions）**：
  `add_datas(datas, commit=True)` / `add_performance_reports(reports,
  commit=True)` / `update_overview(new_overview, commit=True)`——链上调用
  （DataAcquisition 三数据阶段）传 `commit=False` 只 mutate 不 commit，由
  `put_stock` 一次 commit 持久化（单事务，见 data_storage spec 交易规则）；
  默认 True 保持既有调用零变化。单行版 `add_data` / `add_performance_report`
  委托批量版，commit 语义跟随批量版默认。
- **批量 mutator 例外（2026-08-02，review #3）**：`add_datas(list) -> int` /
  `add_performance_reports(list) -> int` 整批**一次 commit**（返回实际追加数，
  0 = 全部重复不 commit；输入须按 date / report_date 升序——数据链路保证）。
  单行版 `add_data` / `add_performance_report` 委托批量版（行为逐行等价）。
  批量语义动机：首建全量回填数千行 = 数千次 FileStorage 事务（tpc + 索引
  更新 + 每条事务记录），批量后 = 1 次。**逐行 commit 是 anti-pattern**。
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
