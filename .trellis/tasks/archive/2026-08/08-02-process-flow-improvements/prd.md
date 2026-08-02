# fix: process-flow review 全量改进（12 findings）

## Goal

把 docs/process-flow-review-2026-08-02.md 记录的全部 12 项流程改进落地实现。
本任务是 parent：拥有源需求集与任务地图，不做实现（无直接工作）。

## Source Requirement Set

完整需求与理由见 `docs/process-flow-review-2026-08-02.md`（2026-08-02 全链路
review，逐项含 file:line、修复方案、工作量估计）。本 PRD 只做索引：

| Finding | 主题 | 严重度 |
|---------|------|--------|
| #1 | ensure_stock 概览永不刷新 → stale price 喂 LLM | High (correctness) |
| #2 | 重复网络拉取（daily/capital/F10 各 ×2） | High (latency) |
| #3 | 逐行 commit，首建数千事务 | High (latency/disk) |
| #4 | 5 次串行 LLM 调用，2 对可并行 | Medium-High (UX) |
| #5 | 单例 ZODB 连接非线程安全 vs Streamlit 多会话 | Medium (robustness) |
| #6 | LLM 调用无重试，一次 429 整体失败 | Medium (reliability) |
| #7 | 无端到端结果缓存，同日同股重付 5 次调用 | Medium (cost) |
| #8 | docstring/spec 声称 akshare 兜底，实际无 | Low-Med |
| #9 | 数据阶段零进度反馈 | Low (UX) |
| #10 | deprecated akshare ~200 行在主流程文件 | Low (maintainability) |
| #11 | API 路径 BJ 代码报错含糊 | Low |
| #12 | agent debug 日志整段 prompt/response | Low |

## Task Map

| Child | Findings | 依赖 |
|-------|----------|------|
| 08-02-stale-overview-gate | #1 | 无 |
| 08-02-data-onepass-bulk-commit | #2 + #3 | 无（#3 需 spec 修订） |
| 08-02-parallel-llm-pairs | #4 | 无 |
| 08-02-zodb-lock-llm-retry | #5 + #6 | 无 |
| 08-02-small-fixes-polish | #8-#11 | 无 |

**已排除（用户决定，2026-08-02，见 review 文档状态行）**：#7 分析结果缓存
（同日重跑 5 次 LLM 是预期产品行为）、#12 agent debug 日志截断（完整日志是
与 LangSmith 调试对齐的有意设计）。`08-02-analysis-result-cache` 已解链归档。

实现顺序遵循 review 文档"Suggested order of work"；子任务间无硬依赖（可独立
规划/实现/检查/归档）。

## Cross-Child Acceptance Criteria

- [x] 每个子任务独立可验证（各自的验收标准 + 测试）
- [x] 全量回归 0 新增失败（基线 0F/116P/20S → 完成时 0F/149P/20S，
      +33 新用例全绿；2026-08-02 langchain 1.x 升级后）
- [x] docs/process-flow-review-2026-08-02.md 的对应 checkbox 随子任务完成
      勾选（#1-#6、#8-#11 [x]；#7/#12 [~] 用户决定不实施）
- [x] 相关 .trellis/spec 同步修订（#3 mutator 批量规则、#2+#3 单遍拉取、
      #4 并行图、#5 读写锁、#6 重试约定、#8 措辞、#10 legacy 迁出）
- [x] 最终集成检查：UI → 数据 → 图 → 输出的全链路行为无回退（全量回归
      含 display / committee / data_acquisition 集成用例）

## Notes

- 每个子任务开工前确认无未归档的上一个子任务遗留。
- 子任务间依赖以各自 prd.md / implement.md 文字写明，不靠树位置隐含。
