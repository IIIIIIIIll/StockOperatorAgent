# refactor: 架构债务清理（评审驱动）

## Goal

2026-08-09 架构评审（全层读码 + 双子代理）识别出 6 处可独立交付的架构债
务点。本父任务**只拥有需求集与任务图**，不做实现：每个子任务独立
计划/实现/检查/归档，验收标准各自可测。父任务负责最终集成复核——全量
测试回归 + 逐字节行为不变的交叉检查。

## Background / Confirmed Facts

- 架构整体健康：分层清晰（data_source → data_structure → data_storage →
  core → agents → UI）、注入点测试风格统一、freshness-first 数据获取、
  spec 系统钉死契约。问题全部是**功能高速落地（08-02 起几乎每日一特性）
  累积的重复与耦合**
- 六处债务点同源：都是"加新东西要改 N 处"的成长模式——下一个 agent /
  下一个数据段 / 下一个 Tab 的成本只会更贵（TODO 里还有 "Add my quant API"）
- 交叉验收的硬约束：**所有子任务不得改变对 LLM 的提示文本 / stock_information
  字符串 / 图结构 / State 语义**——重构只动内部结构，行为逐字节一致
- 测试基线：116+ passed（2026-08-02 记录），含 integration（图语义）与
  e2e（UI 契约）。每个子任务以全量回归绿为合并门槛

## Task Map

| # | 子任务 | 层级 | 复杂度 | 交付物 |
|---|--------|------|--------|--------|
| 1 | `08-09-role-registry` | core/agents/UI | 复杂 | 角色注册表：State key/节点名/Tab 标题单一事实源 |
| 2 | `08-09-agent-base-class` | agents/llms | 复杂 | 7× 复制的 agent 公共管道 → 基类 |
| 3 | `08-09-structured-enrichment-sections` | core/UI | 复杂 | enrichment 文本旁挂结构化 sections，UI 不再解析文本 |
| 4 | `08-09-named-row-constructors` | core/data_source | 中 | 位置构造 → 命名列映射构造（数据安全） |
| 5 | `08-09-unify-config-parsing` | utils/core | 中 | env 假值元组 5 处收敛 + 极性归一 |
| 6 | `08-09-tdx-singleton-and-transactions` | core/data_source | 轻 | TdxSource 单例 + ZODB 单事务 |

依赖顺序：1 与 2 相互独立但都触 agents/committee 装配——建议先做 1 再做 2
（注册表接管节点名后，基类可读注册表）；3 依赖 1 的 tab 契约部分；4/5/6
完全独立可并行。各子任务内部按 implement.md 执行。

## Cross-Child Acceptance Criteria（父任务拥有，最终集成复核时逐项验证）

- [ ] 全量回归 `pytest` 绿（unit + integration + e2e mock 模式），基线
      116+ 无回退
- [ ] LLM 上下文零变化：`build_stock_information` 产出的字符串对同一
      ticker 逐字节一致（除子任务自身声明的等价改写）
- [ ] 图结构/State key 语义零变化：8/9 节点、15/19 边、并行 join 语义
      与重构前一致（集成测试钉死）
- [ ] 配置语义零变化：env 开关族（`X_DISABLED` truthy 语义）、运行时
      覆盖层键表、`BILLIONS_*` 上限语义与现状一致（e2e settings 测试钉死）
- [ ] 无新增对外依赖；requirements.txt 无变化
- [ ] spec 更新：受影响的 `.trellis/spec/`（core/agents/architecture/
      data_source）反映新结构（trellis-update-spec 流程）

## Notes

- 父任务不做实现；最终集成复核 = 各子任务完成后跑一次全量回归 + 逐条
  过本文件 Cross-Child AC
- 子任务归档（archive）由复核通过后执行
- 刻意不做的债务（评审结论）：ProgressBridge/队列流式（工作正常且测试
  钉死，留待下次流式需求）、DeepSeek/Qwen 二合一工厂（一行切换是有意
  设计）、vendor 表面裁剪（单独立项）
