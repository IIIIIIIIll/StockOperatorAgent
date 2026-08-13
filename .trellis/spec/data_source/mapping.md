---
description: 命名行构造 from_row — column_map 契约、列名承重、缺失列 KeyError、映射双射测试
paths:
  - data_structure/chinese_mainland/**
  - core/legacy_akshare.py
---
# DataFrame → Dataclass Mapping

The codebase constructs persistent dataclasses from DataFrame rows with **named
row constructors** (08-09-named-row-constructors) — column **names** carry the
contract, not column order:

```python
StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)
ChinaStockData.from_row(row, column_map=AKSHARE_HIST_COLUMN_MAP)
StockPerformanceReport.from_row(row)          # identity: columns are field names
```

`from_row(row, *, column_map=None, **overrides)` lives on each dataclass
(`data_structure/chinese_mainland/`): `column_map` maps 字段名 → 行内列名
(None = 恒等，字段名即列名); a missing column raises **KeyError** (loud
failure — positional construction silently wrote garbage on column drift);
unmapped extra columns are ignored (the akshare 序号 column no longer needs a
`[1:]` slice); `overrides` are applied after the mapping (akshare 业绩的
`report_date` comes from the caller).

- Column maps live next to the column-order constants they derive from
  (`zip(fields(Dataclass), COLUMNS)` — same-source, cannot drift):
  `OVERVIEW_COLUMN_MAP` (overview.py), `AKSHARE_HIST_COLUMN_MAP` (mapping.py),
  `YJBB_COLUMN_MAP` (legacy_akshare.py, field→column direction);
  `REPORT_COLUMNS` already are field names → identity path, no map.
- Output equivalence is field-by-field with the old positional construction
  (NaN/None pass through unenforced numpy annotations) — proven by
  `test/data_structure/test_row_constructors.py` plus the existing
  data_source/data_structure/DataAcquisition tests.
- When changing either side (a dataclass field or a column constant), run
  `test/data_structure/`, `test/data_source/test_tdx_*.py` and the
  DataAcquisition tests; the bijection tests pin
  `set(COLUMN_MAP) == {f.name for f in fields(...)}`.
