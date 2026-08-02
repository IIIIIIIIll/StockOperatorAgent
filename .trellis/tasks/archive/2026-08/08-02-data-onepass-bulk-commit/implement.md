# Implement: 数据链路单遍拉取 + 批量提交（review #2+#3）

## 执行顺序（每步后运行验证命令）

### Step 1 — 门 helper 提取（纯重构，先行可独立验证）

- `core/data_acquisition.py`：提取 `_overview_stale(stock)` /
  `_history_gap(stock)` / `_reports_stale(stock)` 三个私有 helper（逻辑取自
  #1 的 ensure_stock 门、acquire_historical_data_tdx 的 gap 判定、
  acquire_performance_report_tdx 的门判定）。
- 消费者方法改用 helper（行为零变化）。

**验证**：`python3 -m pytest test/core/data_acquisition/test_data_acquisition_tdx.py -q` → 全绿（18+3 用例）。

### Step 2 — FetchScope（DataAcquisition 内新私有类）

- `FetchScope(src)`：`daily`（大小感知复用）/ `snapshot` / `finance_capital` /
  `company_finance` / `xdxr`；`_failed` 集合（源失败标记，后续请求直接返回
  空 DataFrame）。
- 先写单元测试（离线，`_FakeSrc` 计数）验证复用规则（250 覆盖 gap、None
  重拉、同 key 复用）。

**验证**：新增用例全绿；既有用例不受影响。

### Step 3 — 消费者 `_scope` 透传

- `ensure_stock(ticker, _build_overview=None, _scope=None)`：_scope 给出时
  build_overview 请求走 scope（`_build_overview` 注入点优先级最高）。
- `overview.build_overview(ticker, _scope=None)` /
  `reports.build_reports(ticker, _scope=None)`：内部拉取改走
  `scope or 新 TdxSource()`。
- `acquire_historical_data_tdx(ticker, _scope=None)` /
  `acquire_performance_report_tdx(ticker, _fetch_reports=None, _scope=None)`。

**验证**：`test_data_acquisition_tdx.py` + `test_tdx_overview.py` +
`test_tdx_reports.py` 全绿（无 scope 路径 = 现状）。

### Step 4 — 批量 mutator（ChinaStock）

- `add_datas(list) -> int` / `add_performance_reports(list) -> int`（单次
  commit，0 = 不 commit）。
- 单行版委托批量版（行为逐行等价）。
- 消费者主路径改批量（先收集后一次提交）。
- `test_ChinaStock.py` 新增批量用例 + 单行委托回归。

**验证**：`python3 -m pytest test/data_structure/test_ChinaStock.py
test/core/data_acquisition/test_data_acquisition_tdx.py -q` → 全绿。

### Step 5 — 协调器预播种

- `get_stock_data(ticker, _scope=None)`：建 scope（或注入）→ ensure_stock →
  预播种 daily（尺寸论证见 design.md 2.2）→ 两消费者 → 返回。
- 预播种 daily 失败 → warning + scope 标记 failed（保首建不阻断语义；
  验证 test_get_stock_data_pure_tdx_full_chain 既有断言）。
- 新增主链路单遍用例（注入计数 scope + 合成数据，见 design.md 3.2）。

**验证**：新增用例全绿；`test_data_acquisition_tdx.py` 全绿。

### Step 6 — spec 修订 + review 文档 + 全量回归

- `data_structure/index.md`：mutator commit 规则批量例外。
- `core/index.md`：`get_stock_data` 条目（FetchScope、预播种、`_scope`、
  门 helper）；三消费者条目补 `_scope`。
- `docs/process-flow-review-2026-08-02.md`：#2 #3 checkbox 勾选。
- `check.jsonl` 补 check 清单（见下）。

**验证**：
1. `python3 -m pytest -q` → 0F（基线 119P/20S）
2. spec 校验：`grep -rni "to be filled\|tbd" .trellis/spec` 无命中；
   frontmatter parse（spec-system.md §6 脚本）
3. 停止的 Streamlit 应用保持停止（flock）；跑完可重启

## 评审门

- Step 1-4 完成后：局部验证绿 → 继续。
- Step 5 完成（协调器接入）后：**review gate**——跑主链路单遍用例 +
  全文件回归，向用户展示 fetch 计数对比（旧 7 → 新 4）与事务数变化。
- 全量回归绿 → commit + finish。

## 回滚点

- Step 3/5 的任何 `_scope` 参数默认 None → 撤协调器预播种 + 恢复直拉即回滚
  （FetchScope/批量 mutator 可独立保留）。
- Step 4 单行版委托层即兼容回滚点（行为不变的既有 API）。
- 每 step 一个 commit（或至少 Step 4 与 Step 5 分开 commit），便于定点回滚。

## 验证命令速查

```bash
python3 -m pytest test/core/data_acquisition/test_data_acquisition_tdx.py -q
python3 -m pytest test/data_structure/test_ChinaStock.py test/data_source/test_tdx_overview.py test/data_source/test_tdx_reports.py -q
python3 -m pytest -q   # 全量（需停 Streamlit）
```
