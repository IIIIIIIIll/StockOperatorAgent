---
description: Core orchestration — DataAcquisition, InvestmentCommittee, formatter, Streamlit UI
paths:
  - core/data_acquisition.py
  - core/investment_committee.py
  - core/stock_output_formatter.py
  - core/ui/**
---

# Core Orchestration (`core/`)

`core/llms/` is covered by [agents/index.md](../agents/index.md). This spec covers
everything else in `core/`.

## DataAcquisition (`core/data_acquisition.py`)

Orchestrates data freshness and ingestion. Local patterns:

- **Freshness-first**: `acquire_daily_overview()` and `acquire_historical_data(ticker)`
  consult the storage layer (`storage.check_need_update_overview()`,
  `stock.last_data_update`) and skip work when data is current.
- **One exchange method per market**: `update_shex_overview` / `update_szex_overview` /
  `update_bjex_overview` iterate `AKShareSource().fetch_*_stocks()` rows and call
  `update_overview_in_storage(row)`.
- **Row → model by positional args**: `StockOverview(*list(row.values())[1:])`
  (first column dropped — see `data_source/index.md`), `ChinaStockData(*list(row.values()))`.
- **Boolean result protocol**: methods return `True` on success and `False` + a
  `logger.error` when a stock is missing from storage (e.g.
  `acquire_historical_data`, `add_performance_report_in_storage`).
- **Report cycle**: `get_next_report_date` walks quarter-end dates
  (0331/0630/0930/1231) and `acquire_performance_report` fetches all reports
  between the last stored date and the latest possible date.
- `get_stock_data(ticker)` is the single entry: overview → performance reports →
  history → return `storage.get_stock(ticker)`.

`ZODBStorageInstance()` is instantiated in the constructor (not injected) — a
module-level singleton in `ZODBStorage.py`. Keep it that way; do not add a second
storage abstraction.

## InvestmentCommittee (`core/investment_committee.py`)

- `make_investment_committee(config, progress_updater=None)` builds a
  `StateGraph(State)`, adds the five agent nodes in fixed order, and wires the
  linear chain `START → fundamental → trend → bullish → bearish → investment_manager → END`.
- Compiled with `InMemorySaver()` checkpointer; runtime `config` must carry
  `{"configurable": {"thread_id": "1"}}`.
- `make_investment_decision(target_ticker)` streams the graph with the initial
  state `{"messages": [...], "target_stock_ticker": ..., "stock_information": get_stock_info(...)}`.
- New agents mean: new node registration here, a new edge, a new `State` key,
  and a new prompt in `core/llms/prompt.py`.

## StockOutputFormatter (`core/stock_output_formatter.py`)

- `format_stock_output(stock) -> str` builds the fixed report layout the LLM sees:
  overview line, last 60 daily bars, last 20 performance reports.
- It is a **pure string builder** — no I/O, no data acquisition. Never let it
  fetch or write data.
- Known quirk: line 1 imports `output` from `openpyxl.styles.builtins` and then
  shadows it with a local `output` variable — a dead import, leave it (see
  `architecture.md`).

## Streamlit UI (`core/ui/display.py`)

- `write_ui()` renders the Chinese UI: ticker form with 6-digit validation, five
  report tabs, and a `status.empty()` container passed as `progress_updater` so
  agents can stream progress into it.
- After streaming, results are pulled from `graph.get_state_history(config)[0].values`
  — including `bullish_opinions[-1].content` (works because the `add_messages`
  reducer wraps agent strings into message lists — see `agents/index.md`).
- The UI is the only consumer of `get_state_history`; keep the committee API
  (`make_investment_committee` / `make_investment_decision`) unchanged.

## Anti-Patterns

- Doing akshare calls directly outside `data_source/` — `DataAcquisition` is the
  only caller of `AKShareSource`.
- Reading/writing ZODB directly outside `data_storage/` — go through
  `ZODBStorageInstance` methods.
- Adding business logic into `display.py`; it should stay a thin render layer.
- Calling `get_stock_info` inside the graph build — it is invoked once by the
  caller and passed in `stock_information`.
