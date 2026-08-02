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
- `test_tdx_overview.py` / `test_tdx_reports.py` — 离线合成数据（golden
  values + 列序契约钉死）+ live 冒烟（TDX 可达执行，不可达跳过）。

## Deprecated Tests（2026-08-02，akshare/qwen 相关全部常规不跑）

主流程已纯 TDX（TDX 覆盖个股概览与业绩报告）+ DeepSeek 默认 LLM，akshare 与
Qwen 均为备用/可选项。其 live 测试在本网络受限环境连外部端点挂超时（曾把全量
回归拖到 20+ 分钟）。处理方式：**代码与方法全部保留**，测试加
`pytest.mark.skip`（模块级 `pytestmark` 或方法装饰器，reason 注明 deprecated
+ 恢复方式=删行）。清单：

- `test/data_source/test_akshare.py` — 整个文件（akshare live smoke）
- `test/core/data_acquisition/test_data_acquisition.py` — 6 个 akshare 方法
  （`update_*_overview` / `acquire_daily_overview` / `acquire_historical_data`
  / `acquire_performance_report`）；**`test_acquire_stock_data` 保留**——
  M3 后 `get_stock_data` 走纯 TDX 链路，需常态回归
- `test/core/llms/qwen/test_qwen_api.py` — 整个文件（Qwen 可选 LLM）
- `test/integration/test_basic_graph.py` — 整个文件（5 用例均实例化 QwenApi）
- `test/integration/test_investment_committee.py` — 整个文件（DeepSeek live
  E2E，本机 .env 有 key 但网络受限连 api.deepseek.com 挂起）

## 基线（本环境，2026-08-02 根治后实测）

- **全量：0F/67P/20S，约 2.5-3.5 分钟**。回归门槛 = 不新增失败。
- 2026-08-02 修复（8F → 0F，详情见对应 spec/PRD）：
  - `ZODBStorage.__del__` 锁泄漏根治：`transaction.abort()` + try/except
    （data_storage spec）——`test_exist_*` / `test_set_update_now` 的
    BlockingIOError/LockError 传染消失；
  - `test_ZODBStorage.py` 改用进程级单例 `get_zodb_storage()`（flock 不可
    重入：全量回归中 test/core 已创建单例，原"另开实例"写法必然 LockError）；
  - `ChinaStock('dummy')` TypeError 修复：三参数构造 + 完整 `ChinaStockData`
    字段（`date` 用递增 `datetime.date`，`datetime.datetime` 与 date 不可比）；
  - `test_exist_*` 断言语义改为按需构建契约：未构建 ticker → `None`，
    已构建 → `_seed_stock` 补种后返回数据（自包含，不依赖旧数据）；
  - `test_need_update` 基准改用 `get_last_business_day` 的 17:00（与实现
    完全一致，周末/工作日均成立）；`test_storage` 改专用 dummy ticker
    `999998` 测往返，不触碰真实 000001；
  - `test_akshare.py` 重复定义的 `test_get_shex_stock_overview` 删除；
    `test_time_helper.py` 补真实断言（固定日期 + `date` 对象）；
    `test_ChinaStock.py` 类名 `TestZODBStorage` → `TestChinaStock`。
- 新增 TDX 测试（overview/reports/data_acquisition_tdx）全绿。
- deprecated 20 个 skip 保持不变（akshare/qwen/DeepSeek live 零改动）。

## Anti-Patterns

- Introducing pytest fixtures/mocking as "the new standard" — the house style is
  plain smoke tests; if a test cannot hit the live stack, prefer the
  `dummy_*`-seed pattern from `test_basic_graph.py`.
- Writing tests that mutate `database/china_stock_data.fs` in ways that break
  other tests — storage tests share the file.
- New test files outside `test/` mirroring the package path.
