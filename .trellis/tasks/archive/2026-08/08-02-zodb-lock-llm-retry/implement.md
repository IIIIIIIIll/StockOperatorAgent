# Implement: ZODB 读写锁 + LLM 调用重试（review #5+#6）

## 执行顺序

### Step 1 — #5 读写锁（ZODBStorage + DataAcquisition）

- `ZODBStorageInstance.__init__` 增 `self.lock = threading.RLock()`（import
  threading 已有）。
- DataAcquisition 数据访问段加 `with self.storage.lock:`：
  - `acquire_historical_data_tdx`（取 stock 后到 put_stock）
  - `acquire_performance_report_tdx`（同段）
  - `ensure_stock`（构建/刷新分支）
  - `get_stock_data` 不额外包（方法内已各自持锁；嵌套 RLock 无害）
- 新增 `test_concurrent_access_safe`（design A3，dummy ticker 999997）。

**验证**：`python3 -m pytest test/data_storage/test_ZODBStorage.py
test/core/data_acquisition/test_data_acquisition_tdx.py -q` 全绿。

### Step 2 — #6 重试包装

- `core/llms/retry.py`：`invoke_with_retry` + `_is_retryable`（tenacity，
  已依赖）。
- 5 个 agent 节点 invoke 一行替换。
- 新增 `test/core/llms/test_retry.py`：_FlakyLlm 注入（429 恢复/耗尽/
  业务错误不重试/成功路径零开销）。

**验证**：新用例全绿；`test/integration/test_graph_parallel.py`（#4 的图
测试，若已存在）仍绿。

### Step 3 — 回归 + spec + review 文档

- 全量 `python3 -m pytest -q` → 0F（基线 119P/20S；需停 Streamlit）。
- data_storage/index.md 线程安全段补读写锁（RLock、作用域、跨 LLM 不
  持锁）。
- agents/index.md 补 invoke 重试约定（retry.py、可恢复错误清单）。
- docs/process-flow-review-2026-08-02.md #5 #6 checkbox 勾选。

## 评审门

- Step 1 完成后 review gate（锁作用域实现审查）；Step 2 完成后 commit +
  finish。

## 回滚点

- #5：删除 `with self.storage.lock:` 段（锁字段保留无害）——每方法独立
  可撤。
- #6：agent 节点恢复裸 invoke（5 行）+ retry.py 保留无害。

## 验证命令速查

```bash
python3 -m pytest test/core/llms/test_retry.py -q
python3 -m pytest test/data_storage test/core/data_acquisition -q
python3 -m pytest -q   # 全量（需停 Streamlit）
```
