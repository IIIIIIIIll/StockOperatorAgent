# 进度实时上屏 + 报告节点级即时填充（queue bridge）

## Goal

两个 UI 时效问题，一个 queue bridge 解决：

1. **进度消息丢失**：四个并行节点（fundamental/trend/bullish/bearish）运行在
   LangGraph 工作线程，Streamlit DeltaGenerator 只能在脚本线程 enqueue——
   `safe_progress` 的 info() 抛 `NoSessionContext` 被捕获降级为 debug 日志
   （实测 43 次 "Progress update skipped"）。用户看不到"开始/完成 XX 生成"
   的中间进度。
2. **报告 2-2-1 填充**：`graph.stream` 按 superstep yield——同 superstep 的
   并行节点（fundamental∥trend、bullish∥bearish）的更新一起到达，Tab 只能
   成对填充（等到同一 superstep 里较慢的节点）。用户期望每个报告在其
   节点单独完成时立即填充（1-1-1-1-1）。

## Requirements

### R1（queue bridge——线程安全的事件通道）

- 新增 `core/llms/progress.py` 的 `ProgressBridge`（或等价结构）：`info(msg)`
  与 `push_report(key, content)` 都是 `queue.Queue.put`（线程安全，永不抛
  异常——工作线程调用无副作用）。display 以 bridge 作为 `progress_updater`
  传给图；agent 的 `safe_progress(self.progress_updater, ...)` 行为不变
  （bridge 的 info 入队，不再走降级路径，不再产生 skip 日志）。
- `safe_progress` 保持防御性 try/except 不变（非 bridge 的 updater 路径
  不受影响，如离线测试的 `_ThrowingUpdater`）。

### R2（图跑在后台线程，脚本线程消费队列）

- display 的 stream 循环移到后台 `threading.Thread`（daemon）驱动
  `graph.stream(...)`：superstep 更新里的报告 key 也入队（兜底路径，与
  agent push 同事件类型）；异常入队 `("error", e)`；结束入队 sentinel。
- 脚本线程 `events.get()` 循环分发：progress → `updatable_container.info`；
  report → 对应 Tab `st.header` + `st.write`（`REPORT_TABS` 查标题）；
  error → raise（落入既有 try/except → 中文 `st.error`，守护不变）；
  sentinel → 退出。
- 图阶段零 ZODB 访问、工具调用在 stream 前（脚本线程）——后台线程安全，
  与并行节点既有线程模型一致。

### R3（节点级即时填充——agent 完成即推送）

- 每个 agent 节点在 `invoke_with_retry` 返回后、return state update 前，
  调 `push_report(self.progress_updater, <state_key>, response.content)`
  （5 个 agent 各一行；key 与各自返回的 State key 一致）。工作线程
  `queue.put` 立即可达——脚本线程消费时即渲染该报告，**不等同一
  superstep 的慢节点**。
- 兜底去重：脚本线程按 state key 记录已渲染集合；superstep update 路径
  与 agent push 路径同 key 只渲染一次（agent push 先到 → 渲染；update
  后到 → 跳过）。
- `push_report` helper（core/llms/progress.py）：updater 为 None 或非
  bridge → no-op（离线图测试的 `_ThrowingUpdater` / None 路径不受影响）。

### R4（既有行为不变）

- 采集数据 Tab、边算边渲染的标题/顺序契约（`REPORT_TABS`）不变。
- UI 错误守护（try/except → `st.error` 中文提示 + `logger.exception`）
  不变；bridge 路径的 error 事件仍落入同一守护。
- 图/State/LLM 调用零改动；`safe_progress` 的降级语义保留为最后防线。

## Acceptance Criteria

- [ ] 四并行节点的进度消息（"开始/完成 XX 生成"）在 UI 实时显示，日志不再
      出现新的 "Progress update skipped"
- [ ] 报告按节点完成顺序逐个填充（1-1-1-1-1）：fundamental 在其 LLM 返回
      时即填充，不等 trend（同一 superstep）
- [ ] 同 key 报告只渲染一次（agent push 与 superstep update 兜底路径
      去重）；`REPORT_TABS` 顺序/标题契约不变
- [ ] 图失败：error 事件经队列回抛 → 既有 st.error 守护路径（不裸
      traceback，不吞错误）
- [ ] 离线测试：bridge 的 info/push_report 入队行为；push_report 对
      None / 非 bridge updater no-op；已渲染 key 去重逻辑；`_ThrowingUpdater`
      图测试仍绿（safe_progress 降级不变）
- [ ] 全量回归 0 新增失败

## Notes

- Lightweight task：PRD-only。
- 设计取舍：agent 侧 push（R3）是**节点级**时效的务实解法——langgraph
  sync stream 的 superstep 是屏障，调用方拿不到单节点完成事件；token
  streaming（stream_mode="messages"）虽能打字机式渲染，但要动 agent
  调用链 + retry 包装，超出本任务（Notes 记录为后续可选项）。
- 不做：token 打字机式渲染；改图拓扑（串行化以换取单节点 superstep 会
  丢并行墙钟收益，review #4 的 3 阶段语义要保）。
