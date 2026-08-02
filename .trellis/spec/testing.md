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

## TDX Tests (`test/data_source/test_tdx_*.py`, `test/core/llms/tools/`)

- `test_tdx_mapping.py` — 离线：12 列序契约（`AKSHARE_HIST_COLUMNS`）、首行
  NaN、换手率、qfq golden values（每10股单位、先累乘后应用、事件日前后行为）。
- `test_tdx_source.py` / `test_tdx_screener.py` — live smoke（TDX 服务器可达）：
  真实拉取、12 列全链路、`screen()` 的 `RESULT_COLUMNS` 结构。
- `test_data_acquisition_tdx.py` — 布尔协议 + 新鲜度跳过；`_seed_stock` 补种
  `stocks` BTree 使测试自包含（不依赖 akshare 填充）。
- `test_get_trend_indicators.py` / `test_get_market_intel.py` — 指标输出结构
  + 无 key 降级文本（显式清 `TDX_API_KEY` 环境变量，与开发者本机 key 解耦）。
- `test/core/llms/deepseek/test_deepseek_api.py` — 离线：默认模型
  `deepseek-v4-flash` / `DEEPSEEK_MODEL` 覆盖 / 无 key 构造抛错（与 QwenApi
  同构，UI 层负责提示）/ 不传 DashScope 私有参数。
- 基线（本环境无 .env/网络受限）：既有套件 29F/3P，失败均为环境性（缺
  `DASHSCOPE_API_KEY`/`DEEPSEEK_API_KEY`、akshare 网络、`ChinaStock('dummy')`
  已知损坏）。回归门槛 = 不新增失败。

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
