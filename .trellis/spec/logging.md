---
description: Logging conventions — loguru, placeholder style, handler config, level usage
paths:
  - main.py
  - core/**
  - agents/**
---

# Logging (loguru)

## Handler Configuration

`main.py` installs the app's file handler at startup:

```python
logger.add(str(LOG_DIR / "stock_operator_agent.log"), enqueue=True, rotation="50 MB", retention=10)
```

- App logs go to `logs/` (gitignored). Keep the setup in `main.py` — do not add
  per-module handlers; modules just use the default logger.
- `LOG_DIR`（`utils.constants`，锚定仓库 `logs/`）是日志路径唯一来源——不要在
  main.py 或任何模块里写相对路径（2026-08-02 修复：原 `./logs/...` 随 CWD
  漂移，日志落别处）。
- Tests and `core/investment_committee.py` also call `load_dotenv()` before use;
  `main.py` loads the handler + dotenv before `write_ui()`.

## Call Style

- **Always `{}` placeholders, never f-strings or `%`**:

  ```python
  logger.info("Updating stock overview data...")                    # no args
  logger.debug(f"Stock {ticker} found")                             # WRONG
  logger.debug("Stock {} found, last data date is {}", ticker, stock.last_data_update)  # RIGHT
  ```

  Examples: `core/data_acquisition.py:58`, `data_storage/.../ZODBStorage.py:24`.

- Log the subject being operated on: every acquisition/storage method logs the
  ticker or row it processed (`logger.info(stock_overview)` after storing,
  `logger.debug("Add data on {} to stock {}", data.date, self.ticker)`).

## Level Conventions

- `debug` — detailed flow: per-row processing, cache hits, query/response bodies
  (`logger.debug("Fundamental Analysis Expert Query: {}", ...)` in agents).
- `info` — meaningful state transitions: updates performed, successful fetches,
  start-up, storage open/close (`ZODBStorageInstance.__init__` / `__del__`).
- `error` — failures: missing stock, failed lookups
  (`logger.error(f"Stock {ticker} not found in database.")` — note: this is the
  one f-string in the codebase, keep `{}` style in new code).
- `warning` — unused so far; don't invent new conventions, but warning is
  available for recoverable issues if ever needed.

## Anti-Patterns

- `logger.debug("\nAssistant:", value["messages"][-1].content)` in
  `core/ui/display.py:49` — loguru takes a format string + bound args, so the
  message is dropped and only the arg prints. Use `logger.debug("Assistant: {}", ...)`.
- `print()` for diagnostics in tests is tolerated (existing tests do it), but
  production modules must use loguru.
- Mixing stdlib `logging` into new modules — the project standardizes on loguru.
- Logging secrets or full API keys (`.env` values are `os.environ`/`getenv`-only).
