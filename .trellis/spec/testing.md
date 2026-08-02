---
description: Test conventions — pytest layout, class-based smoke/integration style
paths:
  - test/**
  - pytest.ini
---

# Testing (`test/`)

## Layout and Runner

- `pytest.ini` sets `testpaths = test`; run everything with `python -m pytest`
  from the repo root.
- Directory mirrors the package tree: `test/core/`, `test/data_source/`,
  `test/data_storage/`, `test/data_structure/`, `test/utils/`,
  `test/integration/`.

## Style Conventions

- **Class-based**: test classes named `TestXxx` with `test_*` methods — no
  plain-module test functions, no fixtures or mocking framework in use.
- **Smoke/integration orientation**: most tests call the real systems — live
  akshare endpoints (`test/data_source/test_akshare.py`), the real ZODB file
  (`test/data_storage/test_ZODBStorage.py`, `test/core/data_acquisition/`), and
  the live Qwen API (`test/core/llms/qwen/test_qwen_api.py`). They require
  network access, a populated `database/china_stock_data.fs`, and
  `DASHSCOPE_API_KEY` in `.env` (tests call `load_dotenv()` themselves).
- **Assertions are behavioral, not strict**: e.g.
  `assert storage.get_stock('000001') == stock`,
  `assert da.update_bjex_overview() is True`,
  `assert (datetime.now() - overview_last_updated).seconds < 10`.
- Integration graphs use `stream()` + `get_state_history` and print state
  snapshots (`test/integration/test_investment_committee.py`).

## Isolating Agents from the Live Stack

`test/integration/test_basic_graph.py` is the reference for testing a single
agent node: build a one-node `StateGraph`, compile with `InMemorySaver()`, and
seed upstream state with `dummy_*` module constants (e.g. `dummy_fundamental_analysis`,
`dummy_bullish_opinion`) instead of calling the real pipeline. Use this pattern
when a change touches only one agent.

## Known Broken Tests (do not copy)

- `test/data_structure/test_ChinaStock.py:10` and
  `test/data_storage/test_ZODBStorage.py:12` call `ChinaStock('dummy')` — the
  constructor requires `(name, ticker, overview)`; these tests raise `TypeError`
  and are stale.
- `test/data_source/test_akshare.py` defines `test_get_shex_stock_overview`
  twice (lines 25 and 37) — pytest keeps the last definition.
- `test/utils/test_time_helper.py` calls the helper without asserting.

## Anti-Patterns

- Introducing pytest fixtures/mocking as "the new standard" — the house style is
  plain smoke tests; if a test cannot hit the live stack, prefer the
  `dummy_*`-seed pattern from `test_basic_graph.py`.
- Writing tests that mutate `database/china_stock_data.fs` in ways that break
  other tests — storage tests share the file.
- New test files outside `test/` mirroring the package path.
