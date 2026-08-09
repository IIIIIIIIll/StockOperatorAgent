# Cross-Layer Thinking Guide

> **Purpose**: Think through data flow across layers before implementing.

---

## The Problem

**Most bugs happen at layer boundaries**, not within layers. In this project the
data chain is long and every hop changes format:

```
akshare DataFrame → persistent dataclass → ZODB → formatted string → LangGraph State → LLM prompt → UI
```

---

## The Real Boundaries

| Boundary | Format change | What breaks |
|----------|---------------|-------------|
| DataFrame row ↔ dataclass | DataFrame row → named constructor `StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)` | Column **names** carry the contract; a missing/renamed column → loud `KeyError`; extra columns ignored (positional `*list(row.values())` silently misaligned on column reorder — removed 08-09) |
| dataclass ↔ ZODB | In-memory object → `transaction.commit()` | Mutating a `PersistentList` without committing is lost on restart |
| ZODB ↔ agent | `ChinaStock` object → `StockOutputFormatter` string | Formatter must stay in sync with dataclass fields (`stock_output_formatter.py` prints every field it reads) |
| Storage ↔ `State` | `get_stock_info(ticker)` string → `state['stock_information']` | Key names are the contract — every agent reads `target_stock_ticker` / `stock_information` |
| Agent node ↔ `State` | node return dict → `add_messages` reducers | `bullish_opinions` / `bearish_opinions` are typed `list` but agents return strings; consumers must know the reducer wraps them |
| LLM ↔ progress UI | agent call → `progress_updater.info("...")` | Constructor must accept `progress_updater=None` — the committee passes it, tests don't |
| Dates | `datetime` (`ChinaStockData.date`, ZODB timestamps) vs `'%Y%m%d'` strings (`StockPerformanceReport.report_date`, `fetch_performance_report`) | Comparing one format with the other (`acquire_performance_report` string-walks the report cycle) |

---

## Before Implementing Cross-Layer Features

### Step 1: Map the Data Flow

For each arrow in the chain, ask:

- What format is the data in now?
- Who converts it, and is the conversion positional or keyed?
- What happens on a missing piece (empty DataFrame, `None` stock, missing key)?
- Where does a failure surface: boolean `False`, `None`, or a raised `Exception`?

### Step 2: Follow the Layer Rules

- Data source returns raw DataFrames only — never write akshare calls outside `data_source/`.
- Dataclasses are constructed via named `from_row(row, column_map=...)` — column
  names carry the contract (missing column → `KeyError`); never positionally or
  from dict keys.
- Persistent objects commit after every mutation — no commit, no save.
- Agents copy the uniform template in `agents/index.md` — constructor, prompt
  partials, node method, state-update dict.
- Storage is only touched through `ZODBStorageInstance` — `get_stock` returns
  `None`, never raises.

### Step 3: Define Contracts

For each boundary you touch, state in your head:

- Exact input format (DataFrame column order? `'%Y%m%d'` string? `datetime`?)
- Exact output format (named-constructed dataclass? return `True/False`? state dict?)
- What errors can occur and who handles them (see `error-handling.md`)

---

## Common Cross-Layer Mistakes In This Codebase

### Mistake 1: Positional/dict construction instead of `from_row`

**Bad**: `StockOverview(*list(row.values())[1:])` or `StockOverview(**row)` —
column drift silently misaligns fields (or `**row` chokes on extra columns);
the old code had exactly this failure on an akshare column reorder.

**Good**: `StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)` — a
missing column raises `KeyError` loudly, extra columns are ignored. Still append
new dataclass fields at the end (ZODB field-order stability) and keep the
`column_map` in sync with its column constants (`zip(fields(...), COLUMNS)`).

### Mistake 2: Skipping the commit

**Bad**: `stock.add_data(...)` without `transaction.commit()` — works until
restart, then data vanishes.

**Good**: Every mutator in `ChinaStock` / `ZODBStorageInstance` ends with
`transaction.commit()` — keep it there, don't move commits to callers.

### Mistake 3: Drifting State keys

**Bad**: An agent writes a new key (`state['analysis']`) that the graph wiring or
`display.py` doesn't read.

**Good**: Add the key to `State` in `utils/state.py`, read it in
`core/investment_committee.py` edges, and render it in `core/ui/display.py` tabs
in the same change.

### Mistake 4: Formatting dates per-layer

**Bad**: Converting `report_date` to a `datetime` inside `DataAcquisition`
— the `'%Y%m%d'` string is the cross-layer format (`fetch_performance_report`
input, `StockPerformanceReport.report_date`, string comparisons in
`acquire_performance_report`).

**Good**: Keep `'%Y%m%d'` strings across the data chain; only `time_helper` and
the UI layer work with `datetime` objects.

### Mistake 5: Forgetting the progress protocol

**Bad**: A new agent constructor without `progress_updater=None` default — the
single-agent tests (`test_basic_graph.py`) pass no updater and break.

**Good**: Match the exact signature: `(self, llm, config, progress_updater=None)`.

---

## Checklist for Cross-Layer Features

- [ ] Traced the full chain for the change (DataFrame → dataclass → storage →
      string → state → prompt → UI)
- [ ] Identified every boundary and its format (positional vs keyed, `'%Y%m%d'`
      vs `datetime`, string vs message list)
- [ ] Verified the `column_map` covers every dataclass field at the construction site (missing column → `KeyError`)
- [ ] Confirmed writes commit (`transaction.commit()`)
- [ ] Confirmed `State` keys, graph nodes, and UI reads stay in sync
- [ ] Kept the agent constructor signature uniform
- [ ] Ran the boundary's tests: `test/data_source/test_akshare.py`,
      `test/data_storage/test_ZODBStorage.py`,
      `test/core/data_acquisition/test_data_acquisition.py`
- [ ] Checked error path: `False`/`None` vs `raise` at `get_stock_info`
