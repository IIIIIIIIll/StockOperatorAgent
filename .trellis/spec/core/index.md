---
description: Core orchestration — layer navigation: DataAcquisition, committee, Streamlit UI sub-specs
paths:
  - core/stock_output_formatter.py
---
# Core Orchestration (`core/`)

`core/llms/` is covered by [agents/index.md](../agents/index.md). This spec covers
everything else in `core/`.

## Layer Specs

| Topic | Spec | When to read |
|-------|------|--------------|
| DataAcquisition (`core/data_acquisition.py`, `core/legacy_akshare.py`) | [data-acquisition.md](./data-acquisition.md) | Editing data freshness/ingestion, the TDX acquisition chain, or the akshare legacy path |
| InvestmentCommittee (`core/investment_committee.py`, `core/role_registry.py`) | [investment-committee.md](./investment-committee.md) | Editing graph assembly, the role registry, or `build_stock_information` |
| Streamlit UI rendering (`core/ui/display.py`, `core/llms/progress.py`) | [ui.md](./ui.md) | Editing tab rendering, the queue bridge, the settings panel, or display error guards |
| 采集数据 Tab (`core/ui/data_markdown.py`, `core/ui/charts.py`) | [ui-data-tab.md](./ui-data-tab.md) | Editing data-tab markdown tables, charts, or the parse-once contract |
| UI 主题 (`core/ui/theme.py`, `.streamlit/config.toml`) | [ui-theme.md](./ui-theme.md) | Editing dark/light palettes or injected CSS |
| UI E2E 测试 (`test/e2e/`) | [ui-e2e.md](./ui-e2e.md) | Running or extending the Playwright mock suite |

## StockOutputFormatter (`core/stock_output_formatter.py`)

- `format_stock_output(stock) -> str` builds the fixed report layout the LLM sees:
  overview line, last 60 daily bars, last 20 performance reports.
- It is a **pure string builder** — no I/O, no data acquisition. Never let it
  fetch or write data.
- **2026-08-02 修复（NaN 渲染）**：所有数值经 `utils.formatting.fmt_number`
  （与 `get_trend_indicators._fmt` 共用单点实现）渲染——NaN/None → "N/A"、
  数值保留两位小数。TDX 路径恒有 NaN 字段（量比/涨速/5分钟、盘中换手率与
  成交量、历史首行振幅/涨跌幅、F10 缺失指标），旧实现直接把 str(float) 拼进
  prompt（nan%/nanlots 字面）；golden 断言无字面 'nan'。
- Known quirk: line 1 imports `output` from `openpyxl.styles.builtins` and then
  shadows it with a local `output` variable — a dead import, leave it (see
  `architecture.md`).

## Layer Anti-Patterns

- Doing akshare calls directly outside `data_source/` — `DataAcquisition` is the
  only caller of `AKShareSource`.
- Reading/writing ZODB directly outside `data_storage/` — go through
  `ZODBStorageInstance` methods.
- Adding business logic into `display.py`; it should stay a thin render layer.
- Calling `get_stock_info` inside the graph build — it is invoked once by the
  caller and passed in `stock_information`.
