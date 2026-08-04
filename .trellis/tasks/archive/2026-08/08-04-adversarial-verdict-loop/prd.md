# 实现：多空交易员单轮对抗修订（critique-and-revise）+ 提示词级对称对抗

## Goal

按 08-04-adversarial-debate-research verdict 的 MVP 落实现：

1. **方案 4（提示词级对称对抗）**：bullish/bearish 初稿 prompt 增补"预想对方最可能提出的反驳并逐条回应"——零图改动，拿差分基线。
2. **方案 3（单轮 critique-and-revise）**：新增 `bullish_revise` / `bearish_revise` 两个节点——各看对方初稿与自己初稿，修订一版；manager 经 `[-1].content` 语义零改动读到修订版。

背景（研究 verdict，2026-08-04）：文献支持"让裁决者（manager）看到交叉质询信息"（Du 2023 / Khan 2024），不支持无约束多轮雄辩（2025 质疑）；本项目成本敏感（工具循环 10 轮不收敛前科），故 MVP = 单轮、固定轮数、无收敛检测、revise 轮收紧工具轮数。

## Requirements

- R1（方案 4）：`core/llms/prompt.py` 的 bullish/bearish 初稿文案增补：先自行预想对方最可能提出的 3-5 条反驳并逐条回应/自证，再给出完整观点。不改图。
- R2（方案 3）：`agents/chinese_mainland/bullish_trader.py` 与 `bearish_trader.py` 各新增 `bullish_revise` / `bearish_revise` 节点方法（house style：同现有节点方法形状，`invoke_with_tools` 驱动）；`core/investment_committee.py` 图装配 +2 节点 +6 边（各 revise 双入边 join 两份初稿 → manager）。**manager 零改动**（`[-1].content` 天然读修订版）；**State 零新 key**（修订版追加写原 opinions key，add_messages 累积）。
- R3（成本护栏）：revise 轮 `invoke_with_tools(max_tool_rounds=3)`；初稿轮保持默认 10。评估跑批仍可用 `WEB_SEARCH_DISABLED`（既有开关，本任务不新增）。
- R4（修订约束）：revise 角色 prompt 要求——保留自己 ≥80% 核心论据、可承认对方有效点但**不得反转立场**、逐条回应对方论据（哪些成立/不成立及原因）、输出**完整修订版观点**（manager 把 [-1] 当完整观点消费，不能只输出反驳）、可使用联网搜索验证（工具轮收紧由 R3 控制）。
- R5（UI）：`core/ui/display.py` 报告渲染改为同 key 追加（观点 tab 依次显示初稿 → 分隔 → 修订版），去重从"按 key"改为"按 (key, content)"（防 superstep 兜底重复推送）。
- R6（测试）：`test/integration/test_graph_parallel.py` 更新——revise 路由短语、消息数 11→15、manager 读到修订版、时序断言 3 阶段→4 阶段、bridge 断言 5→7 份报告 + progress ≥14；全量回归不新增失败。
- R7：不改专家节点（fundamental/trend）、不改 State 结构、不改 `invoke_with_tools` 公共签名（max_tool_rounds 参数已存在，只传参）、不引入 conditional edge / 收敛检测 / 多轮循环。

## Acceptance Criteria

- [ ] AC1: 图装配后 7 节点 12 边；单次分析 LLM 调用 5→7（典型，无工具轮时）；墙钟 3→4 阶段。
- [ ] AC2: revise 查询同时含自己初稿与对方初稿（离线测试断言）；修订版追加进 `bullish_opinions`/`bearish_opinions`，manager 读取为修订版（离线测试断言 `[-1].content == 修订版`）。
- [ ] AC3: revise 轮工具轮数上限 = 3（代码事实，review 时验证传参）；初稿轮仍 10。
- [ ] AC4: `display.py` 观点 tab 渲染初稿+修订版且无重复（superstep 兜底去重生效）；`test_bridge_collects...` 断言 7 份报告。
- [ ] AC5: 离线图测试全绿（路由、消息数、时序 4 阶段、bridge）；全量回归 `python -m pytest` 不新增失败（实现前基线 235P/20S/0F，实测）。
- [ ] AC6: 新增/修改 prompt 遵循 house style（中文、禁编造、含角色独有路由短语且与初稿短语互斥——测试路由不歧义）。
- [ ] AC7: spec 更新（agents/core index.md：7 节点图、revise 节点模板、max_tool_rounds=3 约定）并提交。

## Constraints

- 成本敏感：revise 轮禁止放开工具轮数；不做收敛检测、不做多轮循环（verdict 明确不推荐）。
- 文献结论 ≠ 本项目实测：本任务只实现研究推荐的 MVP 形态，不自行加"增强"发明。
- 000001 日K 数据污染（研究实测）不在本任务范围（单独清理任务）；测试只用假 LLM 离线跑，不受影响。
