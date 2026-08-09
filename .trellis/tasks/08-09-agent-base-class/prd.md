# Agent 基类：7 个 agent 模板公共管道去重

## Goal

7 个 agent 文件复制同一模板：构造器（prompt 壳 + partials）、节点骨架
（safe_progress → invoke → push_report → state dict）、工具绑定
（bind_tools NotImplementedError 回退 ×3）、信息面条件段（×3）、结果
汇总循环（×4）。目标：**公共管道收敛到基类/helper，agent 文件只留
prompt 与查询构建**——每个 agent 仍完全显式，但不再复制。

## Background / Confirmed Facts

- 构造器样板逐字重复 7 份（fundamental_analysis_expert.py:17-28、
  trend_analysis_expert.py:16-27、technical_indicator_analyst.py:16-27、
  bullish_trader.py:16-46、bearish_trader.py:17-47、
  investment_manager.py:17-36、information_analyst.py:79-91）
- 节点骨架同构：`query = [("human", ...)]` → `logger.debug` →
  `safe_progress` → `invoke_with_retry(self.llm, {"query": query},
  config=self.config)`（工具角色走 `invoke_with_tools`）→
  `safe_progress` → `push_report` → `{"messages": [query[0], response],
  "<key>": response.content}`
- 结果汇总循环 `result[].content[]` 4 份：web_search.py:84-99、
  billions_search.py:70-82、billions_twitter.py:70-82、
  information_analyst.py:62-74；billions 工具工厂骨架 3 份
- spec（agents/index.md）现行约定是"copy the existing shape"——3 个
  agent 时合理，7 个时复制成本/漂移风险已超收益；**本任务把约定改成
  "继承基类 + 显式查询构建"**，同步更新 spec

## Requirements

- **R1 基类/helper**（建议 `agents/base.py` 或 `core/llms/agent_base.py`）：
  构造器（prompt 壳 + system_message/current_date partials）、
  `bind_tools` NotImplementedError 回退、节点骨架方法（progress/report/
  retry/state 返回）、结果汇总 helper、亿信信息面条件段 helper
- **R2 7 个 agent 逐个改造**：继承/调用基类，文件内保留：角色 prompt、
  查询构建、角色特有逻辑。**每个 agent 的 query 字符串与返回 state dict
  与现状逐字节一致**
- **R3 工具工厂去重**：3 个 make_billions_*_tool 与 web_search 工厂的
  共同骨架（开关判定 → 懒加载 client → 计数器 → try/except 占位）收敛
  为一个 capped-tool helper；各工具 docstring（= LLM 工具 schema）不变

## Acceptance Criteria

- [ ] 每个 agent 文件改造后行数显著下降且无行为差异——对同一 (state,
      llm) 输入，节点方法返回的 state update 与改造前逐字节一致（现
      有单测为证，无需修改或仅断言性修改）
- [ ] `test/agents/`、`test/core/llms/`（test_tool_loop、test_web_search、
      test_billions_tools）、`test/integration/` 全绿
- [ ] 工具 schema 零变化：`test_billions_tools.py` 钉死的工具名/参数/
      docstring 不变
- [ ] 全量回归绿（父任务 Cross-Child AC 1-4）
- [ ] spec 更新：agents/index.md「The Agent Class Template」节改写为
      基类约定；新增或更新 code-reuse thinking guide 相关条目

## Notes

- 边界：**查询构建与角色逻辑不抽象**——那是每个 agent 的差异化所在，
  保持显式（防止过度泛化）
- 若基类方案在个别 agent 上不适配（如 information_analyst 的确定性
  预抓流程），允许该 agent 保留独立实现并在 PRD 追加说明
