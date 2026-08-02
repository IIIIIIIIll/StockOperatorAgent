# fix: ZODB 读写锁 + LLM 调用重试（review #5+#6）

## Goal

review #5 与 #6 两个独立健壮性修复，一次任务落地：

- **#5 ZODB 线程安全**：`get_zodb_storage` 是进程级单例（FileStorage flock
  不可重入），但连接本身非线程安全；Streamlit 每个会话一个线程，多会话
  并发读写同一连接 → `POSKeyError` / `ConflictError` 风险。现有构造锁
  （`_instance_lock`）只防双构造，不防并发读写。
- **#6 LLM 重试**：5 个 agent 节点裸 `self.llm.invoke(...)`，429/超时/5xx
  一次失败整体终止——用户重付全部 5 次调用 + 数据拉取。

## Requirements

### R1（#5 锁语义）

- 锁放在 **ZODBStorageInstance**（连接的所有者）：新增 `self.lock =
  threading.RLock()`（读与写均须持锁；RLock 允许嵌套持有，避免
  get_stock → mutate → put_stock → commit 的多段持有碎化）。
- `DataAcquisition` 的数据访问（`ensure_stock` / 历史 / 业绩 / 构建）以
  方法级或操作级 `with storage.lock:` 包裹——**锁不跨 LLM 调用**（数据
  阶段才持锁；图阶段零 ZODB 访问，不串行化 LLM）。
- 锁持有粒度论证：Streamlit 会话并发粒度是"整次分析"（数据阶段秒级），
  锁只覆盖数据阶段 → 并发会话的数据访问串行化（可接受：数据阶段是本地
  TDX 拉取 + ZODB 写，秒级）；LLM 阶段（分钟级）不持锁 → 分析仍并行。
- 单例构造锁保留（`_instance_lock` 防双构造不变）；读写锁独立（防死锁：
  构造锁内不获取读写锁）。

### R2（#6 重试包装）

- 新增 `core/llms/retry.py`（或 utils 下小模块）：`invoke_with_retry(llm,
  payload, config, *, attempts=3, base_delay=1.0)`——对 429 / 5xx /
  连接类错误退避重试（`tenacity==9.1.4` 已依赖，直接用
  `tenacity.retry`；或手写循环——二选一，实现时定，倾向 tenacity 现有
  依赖）。
- 5 个 agent 节点的 `self.llm.invoke(...)` 统一走包装（单点改动，
  模板模式保持：每节点一行替换）。
- 不重试：业务类错误（400/认证失败）——只重试可恢复错误。
- 进度提示：重试间隔内 progress_updater 可选输出"重试中"（保留/简化由
  实现定）。

### R3（不改边界语义）

- 重试耗尽后仍抛错 → 冒泡到既有 UI 守护（display.py 的 try/except），
  行为不变。
- 锁不改变任何数据语义；只串行化并发访问。

## Acceptance Criteria

- [x] #5：test_concurrent_access_safe——两线程 ×10 次 get/mutate/commit
      同一 stock 无异常（真实 ZODB + threading）
- [x] #5：test_concurrent_data_phase_serializes——锁内慢 fetcher 时序断言
      串行化（0.4s × 2 线程 ≥0.6s；锁外预播种可并行）；4 次运行稳定
- [x] #5：锁不跨 LLM 调用（实现审查：锁作用域仅三个数据阶段方法；
      图节点零 ZODB 访问）
- [x] #6：test_retry.py 6 用例——429 恢复 / 耗尽 reraise / 5xx / 400 零
      重试 / config 透传 / 成功零开销（fake llm 注入，计数验证）
- [x] 既有 agent 模板行为不变：test_graph_parallel.py 4 用例仍绿
      （invoke_with_retry 包装兼容 FakeListChatModel）
- [x] 全量回归 0 新增失败（基线 0F/140P/20S，+8 新用例 → 0F/148P/20S）
- [x] spec 修订：#5 → data_storage 读写锁段；#6 → agents 重试约定 +
      error-handling LLM 错误段；review 文档 #5 #6 勾选

## Notes

- Complex task：design.md + implement.md 先行，评审后 `task.py start`。
- #4 与 #6 有软依赖（并行后限流概率升高，重试兜底）；实现顺序建议
  #4 → #6，或独立皆可（无硬依赖）。
- 不做：每线程独立 ZODB 连接（flock 不可重入，进程内不可能——spec 已
  论证）；不做事务级隔离/重试（ZODB ConflictError 重试机制超出本任务）。
