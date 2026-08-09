# 角色注册表：State key/图节点/Tab 单一事实源

## Goal

agent 名册现在被编码在 4 处且手工同步：`utils/state.py`（State key）、
`core/investment_committee.py`（节点注册 + 4× 条件边）、`core/ui/display.py`
（`report_tabs()` 标题 + tab 映射 + 观点 key）、spec 文档。加一个
`information_analyst` 就要动 6 处。目标：**单一角色注册表**驱动图装配与
UI Tab 渲染，下一个 agent 只需一条注册项 + 一个 prompt。

## Background / Confirmed Facts

- 8/9 节点 15/19 边的装配是固定 4 阶段形状：`START → 专家∥（3-4 个）→
  多空 trader∥（N 入边 join）→ revise∥（双入边 join）→ manager → END`
  （investment_committee.py:171-192）——专家数变化时条件边以 4 份
  `if information_analyst_enabled:` 重复（:141-147, :174-175, :179-180, :184-185）
- `display.py` 有平行契约：`_BASE_REPORT_TABS`/`report_tabs()`（:41-57）、
  `OPINION_REPORT_KEYS`（:62）、`report_tabs_map` 渲染 dispatch（:468-524）
- 观点 key 走 `add_messages` reducer（`bullish_opinions`/`bearish_opinions`），
  渲染有轮次计数语义（display.py:494-524）——注册表必须携带这些属性
- spec 明言 "Node names in the graph and the State keys must stay in sync"
  （agents/index.md）——本文档是把这个警告变成结构性保证

## Requirements

- **R1 注册表模块**（建议 `core/role_registry.py` 或 `utils/roles.py`）：
  每条角色 = 节点名 / State key / Tab 标题 / 角色类（expert | trader |
  manager）/ 是否观点 key / 条件启用谓词（如 information analyst 的
  ANALYST && (SEARCH||TWITTER)）
- **R2 图装配改由注册表生成**：`make_investment_committee` 从注册表构建
  专家集合、边集合（保持 4 阶段固定形状）；**图结构/并行 join 语义逐
  字节不变**（现有集成测试钉死）
- **R3 UI 渲染改由注册表驱动**：`report_tabs()` 与 tab 容器 dispatch 读
  同一注册表；`iter_report_items` 契约不变（离线单测保留）
- **R4 State 定义与注册表一致**：State key 从注册表校验（新增 key 需先
  注册；不引入动态 TypedDict——静态 key 仍手写在 state.py，但注册表是
  key 的权威列举，二者一致性由单测断言）

## Acceptance Criteria

- [ ] 注册表新增一条专家角色 = 节点注册 + START 边 + trader join 边 +
      Tab 标题 + 观点属性全部生效，无需再改 committee/display 装配代码
- [ ] `test/integration/test_graph_parallel.py`（join/并行语义）与
      `test_basic_graph.py` 全绿，无需修改或仅断言性修改
- [ ] `test/core/ui/test_display.py`（iter_report_items/report_tabs 契约）
      全绿，tab 标题与顺序与现状一致（含 ANALYST 开关两种形态）
- [ ] 全量回归绿（父任务 Cross-Child AC 1-4）
- [ ] spec 更新：agents/index.md「The State Contract」节与 core/index.md
      「InvestmentCommittee」节指向注册表

## Notes

- 条件接线的 Out of Scope 组合（ANALYST 开但 SEARCH/TWITTER 均关 =
  分析师不注册）语义保留——谓词进注册表，不进装配代码
- 本任务不引入动态 State 或元编程——注册表是**装配与渲染**的驱动，
  State TypedDict 保持显式
