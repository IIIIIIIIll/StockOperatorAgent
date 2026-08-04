# Research: 多空交易员对抗性会话增强的可行性

## Goal

研究 bullish/bearish trader 是否可通过**对抗性会话**（multi-agent debate /
verdict loop：多空互看对方观点、多轮反驳与回应，再由投资经理裁决）增强观点
质量与最终决策。本任务是**研究任务**——交付研究报告与建议，不实现；结论
直接喂给 TODO 第一项 "Add verdict loop for bearish and bullish"。

## Background（代码现状，2026-08-04 检查）

- 5 节点 LangGraph（`core/investment_committee.py:62-101`）：fundamental ∥
  trend → bullish ∥ bearish → investment_manager → END。**多空交易员并行各出
  一次观点，互不看到对方论据**；manager 读 `bullish_opinions[-1].content` /
  `bearish_opinions[-1].content` 裁决（`agents/index.md` State 契约段）。
- 两对并行边 = LangGraph 隐式 join；`State.messages` 为 add_messages 通道，
  工具消息（web_search, 08-03）已可回流——多轮会话消息落 State 无需新机制。
- 工具角色已有 `invoke_with_tools` 驱动至多 10 轮工具调用循环
  （`core/llms/tool_loop.py`），2026-08-04 实测 DeepSeek 2 轮内不收敛、用户
  拍板放宽轮数——**成本敏感是项目现状**（最坏 3 agent × 10 轮 = 30+ 次搜索）。
- 默认 DeepSeek（deepseek-v4-flash），离线图测试靠 FakeListChatModel +
  bind_tools NotImplementedError 回退保持全绿（house style：无 mock 框架，
  测试注入点 `_llm`）。
- TODO 第一项即 "Add verdict loop for bearish and bullish"——本研究的直接
  消费方。

## Research Questions

- RQ1（证据）：多智能体对抗性辩论对 LLM 推理/事实性/决策质量的提升，文献
  里有哪些支持与反证（含 2025-2026 年对 debate 收益的质疑研究）？哪些场景
  增益大、哪些无差异？
- RQ2（实现形态）：在本项目 LangGraph 里对抗性会话有哪几种落地形态
  （多轮互驳循环、manager 追问式 verdict loop、critique-and-revise、
  两智能体 self-chat 等），各自的 State 改动、图拓扑改动、退出条件、
  轮数上界、成本与墙钟延迟影响（当前 5 串行 → 3 阶段并行）？
- RQ3（评估）：如何衡量"增强了没有"——无金标场景下的评估信号（最终决策
  对后续行情方向的命中、LLM-as-judge 观点质量评分、观点覆盖度/论据数），
  哪些在本项目数据与架构下可落地、成本几何？

## Deliverables / Acceptance Criteria

- AC1: `research/adversarial-debate-literature.md`——文献综述（含来源链接），
  明确"辩论对多空观点增强"的支持/反证证据与适用条件。
- AC2: `research/implementation-options.md`——≥3 种落地形态的对比表：
  图拓扑/State 改动、轮数与退出条件、成本墙钟影响、风险；给出推荐形态
  与理由（结合本项目并行结构、成本敏感、降级风格）。
- AC3: `research/evaluation-plan.md`——可落地的评估方案（信号、数据、
  成本、判定阈值），并说明哪些信号依赖未来数据积累。
- AC4: `research/verdict.md`——最终结论：是否值得做、推荐范围（MVP 边界）、
  明确列出**不**建议做的事（如有）与原因；结论可直接转 prd 供实现任务消费。
- AC5: 结论在会话中汇报，研究工件全部持久化到任务 research/ 目录。

## Constraints

- 纯研究，不改产品代码；如需验证性小实验，只许在 research/ 内留脚本与
  记录，不落 agents/core 代码。
- 成本敏感：方案必须量化额外 LLM 调用/搜索次数对单次分析的成本影响。
- 结论须区分"文献证据"与"本项目推断"，不得把文献结论当本项目实测。
