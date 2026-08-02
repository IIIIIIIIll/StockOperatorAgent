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

The codebase has **no custom exception classes**; `try/except` exists only in
two sanctioned places (data-layer 降级捕获点 + UI 层守护，见下)。Failures
follow one of two patterns depending on layer:

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

**Wrapper-source exception (TDX path)**: vendored pytdx raises
`ValueError`/`ConnectionError` for invalid codes / server failures (not
"expected absence"). The sanctioned catch sites convert to the layer's
protocol:
- `acquire_historical_data_tdx` (acquisition boundary): daily fetch failure →
  `False`——**PRD 纯 TDX 无 akshare 兜底**（2026-08-02 措辞对齐：`get_stock_data`
  忽略返回值记日志不阻断，返回已构建的 stock；历史缺失由 trend 指标降级
  占位兜底）；
`fetch_finance_capital` / `fetch_xdxr` failure → `logger.warning` + degrade
(换手率 NaN / 未复权) without blocking the main path.
- `overview.py` / `reports.py` 构建层（data_source 内，2026-08-02 新增）：
  **逐源 catch** 是逐源降级设计（PRD：缺字段留 NaN 不整块失败）——每个源
  `_fetch_degraded` 单项失败 → `logger.warning` + 该源字段 NaN；snapshot 与
  日K 均无价格来源（overview）或 F10 不可用（reports）→ 返回 `None` 由调用方
  按失败处理（`ensure_stock` → `False`；`acquire_performance_report_tdx` →
  无报告不算失败返回 `True`）。
Same shape in `get_trend_indicators` / `get_market_intel` (LLM tools): failures
return placeholder text, never raise.

### 2. Raise at the boundary (LLM tool)

`core/llms/tools/get_company_info.py` is the **only raise site in the codebase**:

```python
if is_bj_ticker(ticker):          # BJ 显式提示（review #11，2026-08-02）
    raise Exception('北交所（BJ）股票暂不支持分析：...请使用沪深 A 股代码')
data_acquisition = DataAcquisition()
stock = data_acquisition.get_stock_data(ticker)
if stock is None:
    raise Exception('Stock not found')
```

BJ 检查在构造 `DataAcquisition`（打开 ZODB）之前——离线可直接断言异常；
报错文案与 UI 层 BJ 提示一致（中文，用户可见）。

The raised error propagates through the agent graph call and surfaces in the
Streamlit UI / test output. Keep raising to this boundary — it is where a data
problem becomes a user-facing failure.

## LLM / API Errors

- Agent nodes do not catch LLM errors: `invoke_with_retry(...)`（2026-08-02，
  review #6——可恢复错误重试 3 次，见 agents spec）耗尽后的失败照旧 bubble
  to the graph stream and the caller (`display.py`, tests)。
- **UI 层守护（2026-08-02 修复，合法例外）**：`core/ui/display.py` 对
  `build_stock_information`（数据问题如股票缺失 → `get_stock_info` raise）与
  `graph.stream`（LLM 失败）各包一层 `try/except`——`st.error` 中文提示 +
  `logger.exception`，不裸 traceback 红屏、不吞错误（错误仍记录到日志）。
  Agent 节点内部不 catch，失败照旧冒泡到这两个边界。
- Test-side `try/except`：`test/core/llms/qwen/test_qwen_api.py` 捕获 API
  错误打印 DashScope error-code 文档链接。

## Rules of Thumb

- New data-layer methods: return `False` + `logger.error(...)` on "expected
  absence" (missing stock/ticker), return `True` on success.
- New boundary code that must abort a user-facing flow may raise
  `Exception("<short English message>")` — do not invent exception classes until
  there are callers that need to distinguish failure kinds.
- Log first, return/raise second — the log line identifies the ticker/operation.
- Guard the app against a missing API key at the UI layer
  (`display.py` checks `DEEPSEEK_API_KEY` in `os.environ` and shows a Chinese
  error banner) rather than in the data pipeline. UI 层同样守护运行期错误
  （`build_stock_information` / `graph.stream` 的 try/except → `st.error`）。

## Anti-Patterns

- `assert` for flow control — asserts exist only in tests.
- Swallowing exceptions in production modules (no `except: pass`).
- Returning `None` where the boolean protocol expects `True/False`
  (or vice versa) — keep each layer's contract uniform.
- Raising from `data_source/` or `data_storage/` — those layers return raw data
  or `None`/`False`; conversion to exceptions happens in `core/llms/tools/`.
