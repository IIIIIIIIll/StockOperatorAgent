# fix(agents): 并行化独立 LLM 对（review #4）

## Goal

review #4。图目前是严格串行链（`investment_committee.py:61-66`）：fundamental
→ trend → bullish → bearish → manager（5 次串行 LLM 调用，每次 10-60s）。
但依赖关系只有两级：fundamental 与 trend 都只依赖 `stock_information`；
bullish 与 bearish 都只依赖两份报告。改为两对并行，墙钟从 5 串行降为
3 阶段。

## Requirements

- R1（图结构）：`make_investment_committee` 加边：
  `START→fundamental`、`START→trend`、`fundamental→bullish`、
  `trend→bullish`、`fundamental→bearish`、`trend→bearish`、
  `bullish→manager`、`bearish→manager`。LangGraph 多入边 = 隐式 join：
  bullish/bearish 等两上游都完成才执行（1.2.10 语义，测试钉死）。
- R2（State 并发安全）：并行分支写不同 key（`fundamental_analysis` vs
  `trend_analysis`；`bullish_opinions` vs `bearish_opinions`），`messages`
  通道由 `add_messages` reducer 合并——**不新增共享可变状态**，节点方法
  零改动。
- R3（读取语义不变）：`investment_manager` 的 `[-1].content` 读取不变
  （reducer 包装行为在 1.2.10 已验证，agents spec）。
- R4（限流权衡）：并行 = 瞬时双倍并发请求。DeepSeek 限流时退避重试由
  #6（zodb-lock-llm-retry 子任务）兜底——本任务不实现重试，仅注明依赖。
- R5（进度提示不变）：progress_updater 消息逐节点输出，并行阶段两条
  "开始/完成"可能交错——接受（Streamlit 容器顺序渲染文本，无结构依赖）。
- R6（确定性）：`deepseek` seed=114514 固定 → 并行结果与串行不同（真实
  并发时序），但**不承诺跨时序一致性**；golden 断言只钉图形状与 state
  内容非空。

## Acceptance Criteria

- [x] 图边装配：8 条并行边 + 隐式 join（fundamental∥trend → bullish∥bearish
      → manager）——test_graph_parallel.py 4 用例钉死（join 输入完整 /
      manager 双观点 / messages 通道 11 条 / 时序 3 阶段）
- [x] 时序：墙钟 5 串行 → 3 阶段——慢 LLM 注入（每节点 2s）实测 ≈6.8s
      （串行 ≥10s），6 次运行全绿无 flake
- [x] 行为回归：`build_stock_information` / 节点方法 / State 契约零改动
      （仅图装配 + `_llm` 注入点）；display 流式渲染不依赖节点顺序
- [x] 假 LLM 路由修复（并行下 FakeListChatModel 共享计数器非确定）：
      按 system 消息角色独有短语路由（角色文案含"基本面分析师"字样陷阱
      已入 spec）
- [x] 全量回归 0 新增失败（基线 0F/136P/20S，+4 新用例 → 0F/140P/20S）
- [x] review 文档 #4 checkbox 勾选；core spec 图装配条目更新（并行结构 +
      隐式 join + _llm 注入点 + 假 LLM 路由注意）

## Notes

- Complex task：design.md + implement.md 先行，评审后 `task.py start`。
- 依赖：#6 的 LLM 重试（不在本任务实现）；并行后如遇限流是预期成本。
- 不扩面：不做条件分支（conditional edges）、不做节流/信号量控制并发
  上限——两对并行已是上限，不需要。
