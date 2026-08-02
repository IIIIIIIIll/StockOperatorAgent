---
description: ZODB storage patterns — FileStorage, OOBTree index, freshness gate, transaction commits
paths:
  - data_storage/**
  - database/**
---

# Data Storage (`data_storage/`, `database/`)

## ZODBStorageInstance (`data_storage/chinese_mainland/ZODBStorage.py`)

The only storage abstraction; `database/` holds the binary data file only
(`database/china_stock_data.fs`, gitignored via `*.fs` in `.gitignore`). Local
patterns:

- **Constructor**: opens a `ZODB.FileStorage.FileStorage` on
  `utils.constants.china_db_path`, opens the DB + connection, and seeds
  `root.overview_last_updated` (defaults to `constants.default_start`). On a
  fresh file it creates `root.stocks = BTrees.OOBTree.BTree()`.
- **Module-level singleton**: `ZODBStorageInstance()` is instantiated at import
  time in `ZODBStorage.py`; `DataAcquisition.__init__` grabs it via
  `ZODBStorageInstance()`. Keep this — do not add DI or a second storage class.
- **`__del__`** closes connection and DB with an info log.

## Key-Value Semantics

- `root.stocks` is an OOBTree keyed by ticker string: `put_stock(ticker, stock)`
  and `get_stock(ticker)` (returns `None` when missing — callers branch on that).
- Stored values are `ChinaStock` persistent objects whose collections
  (`datas`, `performance_reports`) are `PersistentList`s mutated in place, so a
  `put_stock` after mutation is what persists the change — mirror the pattern in
  `DataAcquisition` (get → mutate → `put_stock` → `transaction.commit()`).

## Transaction Rules

- **Every write ends with `transaction.commit()`** — in `ZODBStorageInstance`
  (`put_stock`, `set_overview_updated_now`) and in `ChinaStock` mutators
  (`add_data`, `add_performance_report`, `update_overview`, `add_info`).
- Reads never commit. If a method touches `root`/storage only for reading, no
  `transaction` import is needed.
- The `transaction` module is used directly (`import transaction`), not via ZODB
  helpers — match that.

## Freshness Gate

- `check_need_update_overview()` returns `False` when
  `root.overview_last_updated` is after 17:00 of the last business day
  (`datetime.time(17, 00)` + `utils.time_helper.get_last_business_day`), else
  `True` — i.e. the daily overview refreshes once per trading day.
- `set_overview_updated_now()` stamps the root and commits. `DataAcquisition`
  calls these around the exchange overview updates.

## Tests

`test/data_storage/test_ZODBStorage.py` runs against the real file database —
it asserts known tickers exist (`871263`, `002741`, `600188`) and that
`overview_last_updated` behaves. The file DB must already be populated (first
run of the app or `DataAcquisition` tests) before these pass.

## Anti-Patterns

- Importing `ZODB`/`transaction` outside `data_storage/` and `data_structure/`
  (where persistent classes live) — storage access goes through
  `ZODBStorageInstance`.
- Committing on the read path or wrapping reads in `transaction` blocks.
- Opening a second ZODB connection in core/agents code — the singleton is
  shared on purpose.
- Committing `database/china_stock_data.fs*` to git — `*.fs` is gitignored.
