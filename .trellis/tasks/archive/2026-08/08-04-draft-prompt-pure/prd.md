# prompt：撤初稿预想反驳增补 + 修订轮 strongest-rebuttal

## Goal

职责分离定稿（用户拍板，2026-08-04）：

1. **撤方案 4**：bullish/bearish **初稿** prompt 撤掉"先自行预想对方最可能提出的
   3-5 条反驳，逐条回应或自证"增补（08-04-adversarial-verdict-loop 加入）——
   第一轮只呈现完整多头/空头观点，不做假设性反驳。
2. **修订轮加强**：bullish_revise / bearish_revise prompt 增补
   **strongest-rebuttal**——先复述对方最强的一条论据，再逐条回应（文献认为
   比泛泛回应更有信息量，用户拍板）。
3. agents spec（"对抗修订轮"节）措辞同步：初稿纯观点 + 修订轮 strongest-rebuttal。

对抗只发生在第二轮（修订轮）：看到对方真实观点后逐条交锋 + 修订。

## Requirements

- R1: `core/llms/prompt.py` 撤 2 行（bullish/bearish 初稿"预想对方反驳"增补各 1 行）——
  初稿恢复为纯完整观点（08-04-adversarial-verdict-loop 之前的状态）。
- R2: `bullish_revise_message` / `bearish_revise_message` 决策要求加
  strongest-rebuttal：先复述对方最强的一条论据，再逐条回应（承认成立点/说明
  不成立点及原因）。其余要素不变（≥80% 论据保留、不得反转立场、完整修订版
  输出、可联网搜索验证、禁编造）。
- R3: 路由短语互斥不受影响（"对抗修订轮的多方/空方交易员"不动；初稿短语不动）——
  测试零改动预期。

## Acceptance Criteria

- [ ] AC1: `prompt.py` 初稿文案恢复纯完整观点（无"预想对方反驳"字样，grep 验证）；
      revise 文案含"复述对方最强的一条论据"语义（bullish/bearish 对称）。
- [ ] AC2: `test/integration/test_graph_parallel.py` 7 用例零改动仍全绿
      （路由短语与 marker 不受影响）。
- [ ] AC3: 定向验证通过：`test_graph_parallel.py` + `test_display.py`；
      **全量回归按需**——streamlit app 在跑（flock 互斥），本任务不杀 app 跑
      全量（改动仅 prompt 文案，风险面由离线图测试覆盖）；若用户允许停 app
      则补全量回归 236P/20S/0F。
- [ ] AC4: `.trellis/spec/agents/index.md"对抗修订轮"节与 prompt 段措辞同步
      （初稿纯观点 + strongest-rebuttal），提交。

## Constraints

- 只改 `core/llms/prompt.py` + agents spec；不动图/节点/State/测试断言。
- 中文 house style；不得改动角色短语（路由依赖）。
