# Research: 对抗性会话落地形态对比（AC2）

- **Query**: RQ2（PRD 08-04-adversarial-debate-research）——在本项目 LangGraph 里对抗性会话有哪几种落地形态（多轮互驳循环、manager 追问式 verdict loop、单轮 critique-and-revise、提示词级对称对抗等），各自 State/图拓扑改动、退出条件、轮数上界、成本与墙钟延迟影响；给出推荐形态与 MVP 边界。
- **Scope**: internal（代码事实，带 file:line）+ 文献立场（ddgs 检索，2026-08-04，未精读全文）
- **Date**: 2026-08-04

## 0. 证据口径

- 【代码事实】= 本项目文件可直接验证（带 file:line）。
- 【文献】= 检索到的论文结论，按常识性主张转述（细目见 AC1 adversarial-debate-literature.md）；本会话经 ddgs 确认标题/链接，未精读全文。
- 【实测】= 2026-08-04 本会话直接运行得出的数据（ZODB 查询等）。

## 1. 现状基线（代码事实）

- 5 节点 8 边图，两对并行 + 隐式 join：`START→fundamental∥trend` → `→bullish∥bearish` → `→investment_manager→END`（`core/investment_committee.py:91-99`）。墙钟 5 串行 → 3 阶段（`core/investment_committee.py:88-90`；测试钉死 ≈6s/10s，`test/integration/test_graph_parallel.py:116-121`）。
- **多空交易员互不看到对方论据**：bullish 查询只插值两份专家报告（`agents/chinese_mainland/bullish_trader.py:39-47`），bearish 同构；manager 读 `bullish_opinions[-1].content` / `bearish_opinions[-1].content`（`agents/chinese_mainland/investment_manager.py:44-45`）。
- 工具循环嵌套在**每个**节点调用内：`invoke_with_tools` 至多 `_MAX_TOOL_ROUNDS = 10` 轮（`core/llms/tool_loop.py:29`），轮数耗尽追加 1 轮"收尾"调用（`core/llms/tool_loop.py:85-93`）；最坏 3 agent × 10 轮 × 每轮多调用（实测 3 个/轮）= 90 次搜索/分析（`core/llms/tool_loop.py:44-47`）。**每个新增的 trader/manager 节点调用 = 一个可再烧 10 轮搜索的窗口**。
- 2026-08-04 实测 DeepSeek 2 轮内不收敛、用户拍板放宽轮数（`core/llms/tool_loop.py:43-47` 注释 + PRD）——**成本敏感、不收敛有前科**是方案取舍的第一约束。
- 现有 prompt 禁止交易员质疑对方：bullish"不允许否定与质疑基本面与趋势分析报告""不允许给出空方观点"（`core/llms/prompt.py:85-86`），bearish 对称（`:109-110`）；manager 被提示"已知空头绝对看空多头绝对看多，需要你进行理性的权衡"（`core/llms/prompt.py:121`）。
- 项目从未用过 conditional edge（grep `add_conditional_edges` 零命中）；State 为 TypedDict 8 键（`utils/state.py:5-13`），无计数器类 key。
- 离线测试：FakeListChatModel + `_RoutedLlm` 按 **system 消息内容**路由（并行下调用顺序不定，`test/integration/test_graph_parallel.py:50-78`）；`test_messages_channel_complete` 断言 `len(final["messages"]) == 11`（`:111`），`test_throwing_progress_updater...` 同样（`:131`）——**任何新增节点调用都会打破消息数断言，测试面 churn 必付**。

## 2. 方案对比

### 方案 4：提示词级对称对抗（非迭代基线，零图改动）

bullish/bearish prompt 内各自加"先自行列出对方最可能提出的 N 条反驳并逐一回应/自证"的要求；manager prompt 加"逐条检视双方对彼此核心论据的回应"。零 State/图改动。

| 维度 | 量化 |
|---|---|
| 额外 LLM 调用 | **0**（每次分析仍 5 节点调用，工具轮数上限不变） |
| 额外 web_search 风险 | 0（不新增调用窗口） |
| 墙钟 | 不变（3 阶段） |
| State 改动 | 无 |
| 图拓扑改动 | 无（唯一改动 = `core/llms/prompt.py` 文案） |
| 退出条件/轮数上界 | 不适用（单轮内自辩，无循环） |
| 离线测试 | 零新增；**注意**：路由短语（"坚定看多的股票交易员"等，`test_graph_parallel.py:67-70`）必须保留或同步改测试 |
| 风险 | 自问自答是同一模型同一先验，属"self-critique"——文献对其单轮增益评价弱（Huang et al. 2024 ICLR：LLM 自我纠错无显著提升，arxiv 2310.01798）；单次生成中的"预想反方"更接近 divergent thinking，有正证据（Liang et al. 2023）但强度低于真交叉质询。**这是成本最低的对照基线**，也是后续所有形态的"差分对象" |

### 方案 3：单轮 critique-and-revise（推荐 MVP 候选）

第一稿照旧并行（互不看对方）；随后新增 `bullish_revise` / `bearish_revise` 两个节点，各自拿到**对方第一稿** + 自己第一稿，修订一版；manager 只读修订版。

| 维度 | 量化 |
|---|---|
| 额外 LLM 调用 | **+2 次/分析**（固定上界，无循环）：bull_revise + bear_revise。两 revise 节点互相独立（各自只依赖对方草稿+自己草稿），可保持并行 |
| 额外 web_search 风险 | +2 个工具调用窗口；若不禁用搜索，最坏搜索轮数从 3×10 增至 5×10（+67%）。缓解：revise 轮收紧 `max_tool_rounds`（如 3）或 eval 时 `WEB_SEARCH_DISABLED` |
| 墙钟 | 3 阶段 → **4 阶段**（draft 阶段与 revise 阶段各自内部并行；以 2s/节点计 ≈6s→8s） |
| State 改动 | **零新 key**：revise 节点把修订版追加写入原 `bullish_opinions`/`bearish_opinions`（add_messages 累积，`utils/state.py:11-12`），manager 的 `[-1].content` 语义（`investment_manager.py:44-45`）**天然读到修订版，manager 零改动**。草稿仅被对方用于 critique，不进 manager 上下文（也可选择 manager 读全列表，需改 query 插值——MVP 不必） |
| 图拓扑改动 | +2 节点 +4 静态边（`bullish_trader→bullish_revise`、`bearish_trader→bearish_revise`、各→manager），**不需要 conditional edge**（revise 恒执行一次） |
| 退出条件/轮数上界 | 固定 1 轮，无收敛检测——与"10 轮不收敛"前科（`tool_loop.py:29,43-47`）不冲突；确定性利于离线测试 |
| 离线测试 | FakeListChatModel 可覆盖：revise 节点用修订版角色 system 文案（新短语路由，`test_graph_parallel.py:50-78` 模式扩展）；消息数断言 11→15 需更新（+2 节点 × 查询+响应 2 条消息，`:111,:131`） |
| 风险 | ① 修订趋同（sycophancy，Sharma et al. 2023 arxiv 2310.13548）——prompt 须约束"保留自己核心论据 ≥80%，可承认对方有效点但不得反转立场"；② flip-flop 删论据——由评估信号 3 的"修订保留率"护栏盯；③ 修订版变长 → manager 上下文 +1 份观点（token 成本小幅上升） |

### 方案 1：多轮互驳循环（bullish ↔ bearish N 轮后交 manager）

第一稿并行；之后 bull 第 k 轮回应 bear 第 k-1 轮、bear 第 k 轮回应 bull 第 k-1 轮（每轮内两节点仍可并行）；轮数计数器到达 N 后路由到 manager。

| 维度 | 量化 |
|---|---|
| 额外 LLM 调用 | **+2R 次/分析**（R=互驳轮数；建议 R≤2 → +2~+4 次，固定上界） |
| 额外 web_search 风险 | +2R 个工具窗口；R=2 时最坏搜索上界 3×10→7×10（+133%）。**必配**每轮 `max_tool_rounds` 收紧（如 3），否则成本失控风险真实存在 |
| 墙钟 | 3+R 阶段（每轮串行等待对方上一轮；R=2 → 5 阶段 ≈10s） |
| State 改动 | +1 个计数器 key（`debate_round`）。LangGraph 1.2.10 并行写同 key 是 last-write-wins——两 trader 并行写同值 n+1 恰好安全，但更稳的是加一个专用 `bump_round` 节点串行递增；观点追加仍走原 opinions key（add_messages） |
| 图拓扑改动 | 最大：draft 后改 conditional edge（`add_conditional_edges` + 按 `debate_round` 路由，项目首次使用）+ 计数器节点 + 终态路由到 manager；或改 `bullish_trader`/`bearish_trader` 节点为"phase 感知"（state 里读轮数决定 query 含对方上一轮） |
| 退出条件/轮数上界 | 建议**固定 N=1~2**，不做收敛检测（LLM 判定收敛 = 额外调用 + 不可靠；项目已有 10 轮不收敛前科） |
| 离线测试 | 可覆盖但 churn 最大：路由仍按 system 消息（`test_graph_parallel.py:50-78`），计数器确定性使响应序列可预测；需更新消息数断言并新增循环路径测试（N 轮后必达 manager） |
| 风险 | ① 分歧发散（论点漂移离数据越来越远）；② 从众趋同（sycophancy，Sharma 2023）；③ **judge 被雄辩带偏**——文献：更有说服力的 LLM 会让 judge 更常采信（Khan et al. 2024 ICML，arxiv 2402.06782），本项目 manager 即 judge，多轮雄辩可能反而伤害裁决；④ flip-flop；⑤ 成本与墙钟翻倍风险。收益侧文献支持"交叉质询提升 judge 准确率"（Khan 2024），但 2025 年后有研究质疑 debate 增益不稳定（如 arxiv 2601.19921 "Demystifying Multi-Agent Debate" 综述化工作）——多轮收益相对单轮 revise 的**边际增益没有稳定证据** |

### 方案 2：manager 追问式 verdict loop

manager 拆为"初看双方草稿 → 向双方各提针对性追问（或一轮追问循环）→ 双方回应 → 终裁"。

| 维度 | 量化 |
|---|---|
| 额外 LLM 调用 | +3（1 轮追问：manager_pre + bull_resp + bear_resp + manager_final 拆 4 节点）或 +3+2Q（Q 追问轮数） |
| 额外 web_search 风险 | +3 个工具窗口（manager 两次 + 两 trader 回应各一次；manager_pre/manager_final 都走 `invoke_with_tools`，`investment_manager.py:65-68`） |
| 墙钟 | 3+2 阶段（1 轮追问）≈10s；追问循环更多 |
| State 改动 | +1 个 `manager_questions` key（追问文本），观点回应走原 opinions key |
| 图拓扑改动 | manager 节点拆分 + 新边（或 conditional loop），改动面与方案 1 同级 |
| 退出条件/轮数上界 | 追问轮数固定（建议 1）；或 manager 判定"无需追问"直接终裁（需收敛检测，不推荐） |
| 风险 | ① **引导性问题**：manager 提问措辞即锚定，trader 对提问者 sycophancy 比互驳更严重（Sharma 2023）；② manager 上下文最长（两草稿+自己提问+两回应），token 成本最高；③ 实现面最大但收益与方案 3 高度重叠（都是给 manager 提供交叉质询信息）——**单独落地不划算**；除非后续评估显示 manager 需要主动质询（如反复引用同一疑点）再回看 |

### 方案 5：轮内证据绑定互驳（扩展变体，可叠加 1/3）

每轮反驳必须至少发起 1 次 `web_search` 验证对方论据（"你声称 X，请搜索验证"），且该轮 `max_tool_rounds` 收紧到 3。

| 维度 | 量化 |
|---|---|
| 额外 LLM 调用 | +0（搜索在工具轮内，不新增调用窗口；但每轮至少 1 次搜索 → 墙钟 +DDG 往返） |
| web_search 风险 | 强制搜索 → DDG 免费但 ddgs 反爬频率约束（`tool_loop.py:46-47`）；高频批量评估时需注意 |
| 墙钟 | +搜索延迟/轮（DDG 每次 1-5s 量级，未见本项目记录） |
| 其余 | State/拓扑改动 = 所叠加方案（3 或 1）；价值：把"论据真实性"从 prompt 软约束变成硬证据链，回应文献中"assertion 越强 judge 越易信"的担忧（Khan 2024） |

## 3. 量化对比汇总

| | 方案 4（基线） | 方案 3（单轮 revise） | 方案 1（R=2 互驳） | 方案 2（1 轮追问） |
|---|---|---|---|---|
| 额外 LLM 调用/分析 | 0 | **+2（固定）** | +4（固定，建议 R≤2） | +3（固定） |
| 单次分析 LLM 调用总量（典型/最坏） | 5 / 35 | 7 / 57 | 9 / 79 | 8 / 68 |
| 最坏搜索上界（×3 并行调用/轮） | 90 | 150 | 210 | 180 |
| 墙钟阶段数（2s/节点） | 3（≈6s） | 4（≈8s） | 5（≈10s） | 5（≈10s） |
| State 改动 | 无 | **无新 key** | +计数器 key | +questions key |
| 图拓扑改动 | 无 | +2 节点 4 静态边 | conditional edge + counter（首次引入） | manager 拆 3+ 节点 |
| 轮数上界 | — | 1 | 2（建议） | 1（建议） |
| 离线测试 churn | 无 | 消息数断言 + 新路由短语 | 同上 + 循环路径测试 | 同上 + 拆节点测试 |
| 主要风险 | 自辩弱增益 | 趋同、flip-flop | 发散、从众、judge 被带偏、成本 | 引导性锚定、上下文最贵 |

（典型/最坏口径：【代码事实】每节点调用 = 1 次基础 LLM 调用，工具轮 ≤10 + 收尾 1 = 11/节点最坏（`tool_loop.py:29,85-93`）；专家节点无工具 = 1（`core/investment_committee.py:73-77` 不传 tools）。最坏搜索数 = 工具角色数 × 10 轮 × 3 并行调用（`tool_loop.py:44-47` 口径）。）

## 4. 文献立场（简表）

- **支持**：多智能体辩论提升 factuality/reasoning（Du et al. 2023，arxiv 2305.14325）；交叉质询让 **judge** 更准确，说服力更强的 debater 反而提升 judge 准确率（Khan et al. 2024 ICML，arxiv 2402.06782）——对本项目最相关：收益方是 manager（judge），而非 trader 本身。
- **质疑/边界**：LLM 自我纠错无显著增益（Huang et al. 2024 ICLR，arxiv 2310.01798）；2025+ 综述与实证对 debate 的增益稳定性提出质疑（arxiv 2601.19921、2607.26212）；sycophancy 使模型倾向迎合（Sharma et al. 2023，arxiv 2310.13548）——互驳循环里"谁更雄辩"可能胜过"谁更正确"。
- **对方案取舍的含义**：文献支持的是"让 judge 看到交叉质询信息"（方案 3 已覆盖、成本最低），**不支持**无约束多轮雄辩（方案 1 必须限轮 + 限工具轮 + 限立场翻转）。

## 5. 推荐形态（MVP 边界）

**MVP = 方案 4（提示词级对称对抗，零成本基线）+ 方案 3（单轮 critique-and-revise）**：

1. 先落方案 4 并跑评估信号 2/3（见 AC3）——零改动拿到差分基线；
2. 同次或紧随落方案 3：+2 LLM 调用、+1 阶段、无新 State key、无 conditional edge、manager 零改动（`[-1]` 语义保持）、FakeListChatModel 可测——**改动面与成本都压到最小，且把"交叉质询信息"真正送到 manager**；
3. revise 轮工具轮数收紧（`max_tool_rounds=3`）或评估时 `WEB_SEARCH_DISABLED`；
4. 修订 prompt 约束：保留 ≥80% 原论据、不得反转立场、可承认对方有效点——防趋同与 flip-flop。

**留到以后**（方案 3 经 AC3 证明增益后再做）：
- 方案 1（R=1→2 轮互驳 + 每轮工具轮数上限 3 + 证据绑定（方案 5））——若评估显示单轮 revise 增益不足；
- 方案 2（manager 主动追问）——仅当评估显示 manager 需要主动质询（如多次引用同一疑点）时，且必须做"非引导性提问"prompt 设计。

## 6. 明确不推荐

- 收敛检测式循环（LLM 判定"已达成一致"再退出）：额外调用 + 判定不可靠，与"10 轮不收敛"前科直接冲突；
- 无上界轮数 / R>2 的互驳：成本与墙钟失控，文献边际增益无稳定证据；
- 多轮互驳中放任每轮 10 轮 web_search：最坏 210 次搜索/分析（上表），ddgs 反爬风险（`tool_loop.py:46-47`）；
- 方案 2 作为首个改动单独落地（实现面最大、收益与方案 3 重叠、引导性锚定风险）。

## Caveats / Not Found

- 【未验证】deepseek-v4-flash 单价未在本会话核实（成本量级见 AC3，标注为假设）。
- 【未验证】文献链接经 ddgs 于 2026-08-04 检索确认存在，未精读全文；细目以 AC1 为准。
- 【代码事实】所有 file:line 基于当前 master（a37c472）。
