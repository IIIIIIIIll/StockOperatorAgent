# Implement: 单轮对抗修订（critique-and-revise）+ 提示词级对称对抗

> 2026-08-04 · 依赖：prd.md（需求/AC）、design.md（技术设计）· 前置研究：
> 08-04-adversarial-debate-research
> 执行形态：派 trellis-implement 子代理（主会话驱动）；每步 review gate 后推进。

## 0. 前置验证（改代码前）

- [ ] `git status` 干净、`git log -1` 在 a37c472（研究基线）。
- [ ] 无 `streamlit run main.py` 在跑（ZODB flock 互斥，testing spec）。
- [ ] 全量回归基线记录：`python -m pytest`（实现前基线 235P/20S，0F——trellis-check 于 2026-08-04 stash 实测）。

## 1. 实现清单（顺序执行）

### 1.1 prompt（core/llms/prompt.py）
- [ ] bullish/bearish 初稿文案增补（R1）：决策要求加"先自行预想对方最可能提出的
      3-5 条反驳，逐条回应/自证，再给出完整观点"。
- [ ] 新增 `bullish_revise_message` / `bearish_revise_message`（R2/R4）：
      独有角色短语（含"对抗修订轮"，**不含**初稿的"坚定看多/看空的股票交易员"）
      + 逐条回应对方 + ≥80% 论据保留 + 不得反转立场 + 完整修订版输出 + 可搜索验证。

### 1.2 agent 节点（agents/chinese_mainland/bullish_trader.py、bearish_trader.py）
- [ ] 新增 `bullish_revise(self, state)` / `bearish_revise(self, state)` 节点方法
      （design §3.1 查询构建）：读自己初稿 `[-1].content` + 对方初稿 `[-1].content`；
      `invoke_with_tools(..., max_tool_rounds=3)`；safe_progress 开始/完成；
      push_report 同 key；返回 `{"messages": messages, "<key>": response.content}`。

### 1.3 图装配（core/investment_committee.py）
- [ ] +2 节点注册（`bullish_revise` / `bearish_revise`）；+6 边：
      `bullish_trader→bullish_revise`、`bearish_trader→bullish_revise`（join）、
      `bullish_trader→bearish_revise`、`bearish_trader→bearish_revise`（join）、
      `bullish_revise→investment_manager`、`bearish_revise→investment_manager`。
- [ ] 注释同步（"两对并行"段 → 三对并行/4 阶段语义）。

### 1.4 UI（core/ui/display.py）
- [ ] 报告渲染：去重 `rendered` set 改存 `(key, content)` 对；首次渲染 key →
      header+内容，后续同 key → `---` 分隔 + 追加内容（design §2.4）。

### 1.5 测试（test/integration/test_graph_parallel.py）
- [ ] 新常量 `BULL_REV` / `BEAR_REV`（修订版 marker）；`_RoutedLlm` 加两条
      revise 路由（独有短语，且排在初稿路由之后——互斥保证不歧义）。
- [ ] `test_manager_receives_both_opinions`：`[-1].content == BULL_REV/BEAR_REV`；
      manager 查询含修订版 marker；**新增** `test_revise_receives_opponent_draft`：
      revise 查询含对方 marker（join 语义钉死）。
- [ ] `test_messages_channel_complete` / `test_throwing_progress_updater...`：
      `len == 15`。
- [ ] `test_independent_pairs_run_parallel`：断言 `< 9.5`（4 阶段 ≈8s）。
- [ ] `test_bridge_collects_progress_and_all_five_reports`：7 份报告（opinions
      key 为修订版——同 key 后推覆盖 dict）、progress ≥14；方法名/注释同步。

## 2. 验证命令

- [ ] `python -m pytest test/integration/test_graph_parallel.py -v`（本次改动用例全绿）
- [ ] `python -m pytest test/integration/ -v`（integration 全绿）
- [ ] `python -m pytest` 全量回归：**0 新增失败**（基线 235P/20S；重跑一遍确认
      共享 DB 脏状态不影响——testing spec"连续两遍"约定）
- [ ] `grep -rn "坚定看多\|坚定看空\|对抗修订轮" agents/ core/llms/prompt.py`
      ——路由短语互斥抽查
- [ ] `git diff --stat` 核对改动面（预期 ≤7 文件：prompt.py、两 trader、
      investment_committee.py、display.py、test_graph_parallel.py）

## 3. Review Gates

- G1（1.2 完成后）：revise 节点方法形状与 house style 一致（对照
  `bullish_trader` 方法逐行核对）；max_tool_rounds=3 传参到位。
- G2（1.3 完成后）：图拓扑 7 节点 12 边；manager/State/tool_loop 零改动
  （`git diff` 核对该三文件无 diff）。
- G3（1.5 完成后）：离线图测试全绿 + 全量回归 0 新增失败；时序断言非 flaky
  （同文件连跑两遍）。

## 4. 完成后（Phase 3）

- [ ] spec 更新（AC7）：agents/index.md（7 节点图、revise 节点模板、
      max_tool_rounds=3 约定）、core/index.md（InvestmentCommittee 段图拓扑）；
      research/verdict-loop 评估信号 2/3 跑批留作独立任务（本任务不含评估）。
- [ ] 提交（conventional commit，含 Co-Authored-By: Claude）。
- [ ] `/trellis:finish-work` 收尾。
