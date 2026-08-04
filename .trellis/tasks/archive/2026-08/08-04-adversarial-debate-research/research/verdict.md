# Verdict：多空交易员对抗性会话增强——值得做，但只做"证据对齐的最便宜形态"

> 任务：08-04-adversarial-debate-research · 2026-08-04 · 综合 AC1（文献）+ AC2（实现形态）+ AC3（评估方案）
> 口径：文献证据（带出处）与本项目代码事实（带 file:line）分开标注；本项目无实测增益数据——下文结论是可执行的研究建议，不是已验证的改进。

## 一句话结论

**值得做。** 但做的不是"多轮雄辩"，而是 **单轮互看+修订（critique-and-revise）**：
bull/bear 各先看到对方第一稿、修订一版再交 manager——**+2 次 LLM 调用、+1 个阶段、零新 State key、无 conditional edge、manager 零改动**；并以"提示词级对称对抗"（0 调用）作差分基线，先跑评估再决定是否加深到多轮。

## 关键证据（文献 → 本项目映射）

| # | 文献事实 | 本项目含义 |
|---|---|---|
| 1 | "把对方回答喂回上下文"是辩论与多采样的唯一区别（Du et al. 2023 ICML, arXiv:2305.14325） | 本项目缺的**正是互看**（`bullish_trader.py:39-47` 只插值两份专家报告）；最便宜的增强就是让双方互看 |
| 2 | 同质代理辩论≈多数投票、会合谋强化；异质性是"万灵药"（Stop Overvaluing MAD 2025, arXiv:2502.08788 等） | bull/bear **对立人设本身即异质性来源**——本项目处于文献最有利的情形（虽同基座，靠人设+数据差异维持） |
| 3 | 辩论始终被裁决优于 consensus-gated（TradingAgents, arXiv:2412.20138）；交叉质询提升 **judge** 准确率，但更有说服力的 debater 会让 judge 更常采信（Khan et al. 2024 ICML, arXiv:2402.06782） | manager 即 judge：收益方是 manager 而非 trader；**多轮雄辩反而有带偏裁决的风险**——限轮是安全要求 |
| 4 | 单 agent 自我批判会退化：80.8% 重复同一失败类别（Illusions of Reflection 2025, arXiv:2510.18254）；LLM 自我纠错无显著增益（Huang et al. 2024 ICLR, arXiv:2310.01798） | **不做**"仅 prompt 级自我批判"当主方案；只当零成本对照基线 |
| 5 | 轻量对抗 1.8× 开销即有增益（IEEE SEAI 2025）；MAR ≈3× 调用；轮数翻倍≈成本翻倍（TradingAgents） | 本项目成本敏感（工具循环 10 轮不收敛前科，`tool_loop.py:29,43-47`）——MVP 必须固定小轮数 |
| 6 | 金融回测优越性多为偏差：FINSABER（arXiv:2505.07078）、知识截断泄漏（KTD-Fin）；LLM-judge 单独不可信（intra-rater α 0.27–0.79，arXiv:2510.27106） | 评估主判据用**配对 A/B 差分** + judge **多数决/平局选项/人审抽样**；不拿回测当金标 |

## 推荐 MVP（AC2 §5）

1. **先落方案 4**（提示词级对称对抗）：bull/bear prompt 各自"先预想对方 N 条反驳并逐条回应"，manager"逐条检视互驳"。零图/State 改动，唯一改动 `prompt.py` 文案——**零成本拿到差分基线**。
2. **同步落方案 3**（单轮 critique-and-revise）：+2 节点（`bullish_revise`/`bearish_revise`，仍可并行）+4 静态边；修订版追加写原 `bullish_opinions`/`bearish_opinions`（add_messages），manager `[-1].content`（`investment_manager.py:44-45`）**天然读修订版、零改动**；不需要 conditional edge。
3. **成本护栏**：revise 轮 `max_tool_rounds=3`（否则最坏搜索上界 90→150）；评估跑批 `WEB_SEARCH_DISABLED`。
4. **修订 prompt 约束**：保留 ≥80% 原论据、可承认对方有效点但**不得反转立场**（防趋同 sycophancy 与 flip-flop；Sharma 2023, arXiv:2310.13548）。
5. 测试面：FakeListChatModel 新增路由短语 + 消息数断言 11→15（`test_graph_parallel.py:111,131`）。

单次分析成本：基线 5 调用 → 7 调用（典型），墙钟 3→4 阶段（≈6s→8s）。

## 评估路径（AC3）

- **信号 2（LLM-judge 配对差分）**：首个上线（与实现同周出结果）。30 样本 ≈ **10–50 元**量级。抗偏差：换序呈现、按维度打分（防冗长偏差）、3 次多数决、固定 seed、可切 `deepseek-v4-pro` 当 judge 缓自偏好。阈值：开臂胜率 ≥60%（n≥20）或"回应强度/论据完整性"两维均分差 ≥+0.5。
- **信号 3（可解析护栏）**：零成本。论据条数不退化、修订保留率 ≥80%、引用抽查错误率 ≤10%。
- **信号 1（方向命中）**：中期信号。n≥50–100（统计口径），开−闭 ≥+5pp 且开臂绝对 ≥55%；800 次图运行 ≈**50–250 元** + 1.5–2.5h。回放须防三类坑：【实测】000001 bars 污染（4385 行仅 122 唯一日期，疑似测试播种残留，须按 date 去重）、库内仅 10 只有 bar（扩池走 TDX 无 LLM 成本）、选点勿用 `get_last_business_day`（纯 weekday 近似）——用 ZODB 实际 bar 日期。overview/财务指标/实时情报无历史 → **lookahead 无法消除，A/B 差分抵消，绝对命中率附上偏声明**。
- **决策规则**：信号 2+3 通过 → 保留形态、进入信号 1 积累期；否则砍掉回方案 4。

## 明确不做（AC2 §6）

- 收敛检测式循环（LLM 判定"达成一致"退出）——额外调用 + 判定不可靠，与 10 轮不收敛前科冲突；
- 无上界轮数 / R>2 互驳——成本墙钟失控，多轮对单轮 revise 的边际增益无稳定证据；
- 互驳轮放任每轮 10 轮 web_search（最坏 210 次搜索/分析，ddgs 反爬风险）；
- manager 追问式 verdict loop（方案 2）作首个改动——实现面最大、引导性锚定风险、收益与方案 3 重叠；仅当后续评估显示 manager 需主动质询再回看。

## 后续依赖

- 若方案 3 增益不足 → 方案 1（R=1→2 轮互驳 + 每轮工具轮上限 3 + 证据绑定互驳，AC2 方案 5）；
- 000001 数据污染建议单独开小任务清理（评估前提）；
- 本 verdict 可整体转 prd 供实现任务（TODO "Add verdict loop"）消费。

## Caveats

- 文献结论 ≠ 本项目实测——所有阈值/成本为量级假设（deepseek-v4-flash 单价未核实，AC3 §6 标注）；
- 本任务未改任何产品代码/测试（约束满足）。
