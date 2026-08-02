---
description: Error handling conventions — boolean result protocol, single raise site, no exception hierarchy
paths:
  - core/data_acquisition.py
  - core/llms/tools/**
  - data_source/**
  - data_storage/**
---

# Error Handling

## The Two Local Patterns

The codebase has **no custom exception classes and no `try/except` in
production code**. Failures follow one of two patterns depending on layer:

### 1. Boolean result protocol (data layer)

`core/data_acquisition.py` methods return `True`/`False` and log the failure:

```python
stock = self.storage.get_stock(ticker)
if stock is None:
    logger.error(f"Stock {ticker} not found in database.")
    return False
```

Same shape in `add_performance_report_in_storage` (missing ticker → `False`)
and `acquire_historical_data`. Callers branch on the boolean
(`DataAcquisition.acquire_*` chain, and `get_stock_info` treats `None` results
as fatal). `data_storage/.../ZODBStorage.py` follows the sibling convention:
`get_stock` returns `None` for missing keys and never raises.

**Wrapper-source exception (TDX path)**: `acquire_historical_data_tdx` is the
data layer's only sanctioned catch site — vendored pytdx raises
`ValueError`/`ConnectionError` for invalid codes / server failures (not
"expected absence"). It catches at the acquisition boundary and converts to the
boolean protocol: daily fetch failure → `False` (caller falls back to akshare);
`fetch_finance_capital` / `fetch_xdxr` failure → `logger.warning` + degrade
(换手率 NaN / 未复权) without blocking the main path. Same shape in
`get_trend_indicators` / `get_market_intel` (LLM tools): failures return
placeholder text, never raise.

### 2. Raise at the boundary (LLM tool)

`core/llms/tools/get_company_info.py` is the **only raise site in the codebase**:

```python
stock = data_acquisition.get_stock_data(ticker)
if stock is None:
    raise Exception('Stock not found')
```

The raised error propagates through the agent graph call and surfaces in the
Streamlit UI / test output. Keep raising to this boundary — it is where a data
problem becomes a user-facing failure.

## LLM / API Errors

- Agent nodes do not catch LLM errors: `self.llm.invoke(...)` failures bubble to
  the graph stream and the caller (`display.py`, tests).
- The only `try/except` in the repo is test-side, `test/core/llms/qwen/test_qwen_api.py`,
  which catches API errors to print the DashScope error-code docs link.

## Rules of Thumb

- New data-layer methods: return `False` + `logger.error(...)` on "expected
  absence" (missing stock/ticker), return `True` on success.
- New boundary code that must abort a user-facing flow may raise
  `Exception("<short English message>")` — do not invent exception classes until
  there are callers that need to distinguish failure kinds.
- Log first, return/raise second — the log line identifies the ticker/operation.
- Guard the app against a missing API key at the UI layer
  (`display.py` checks `DASHSCOPE_API_KEY` in `os.environ` and shows a Chinese
  error banner) rather than in the data pipeline.

## Anti-Patterns

- `assert` for flow control — asserts exist only in tests.
- Swallowing exceptions in production modules (no `except: pass`).
- Returning `None` where the boolean protocol expects `True/False`
  (or vice versa) — keep each layer's contract uniform.
- Raising from `data_source/` or `data_storage/` — those layers return raw data
  or `None`/`False`; conversion to exceptions happens in `core/llms/tools/`.
