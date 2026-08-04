# Design: 单轮对抗修订（critique-and-revise）+ 提示词级对称对抗

> 2026-08-04 · 前置研究：08-04-adversarial-debate-research（verdict + implementation-options §5 推荐 MVP）
> 口径：【代码事实】带 file:line，基于 master a37c472（研究基线）。

## 1. 目标形态

```
START → fundamental ∥ trend
      → bullish_trader ∥ bearish_trader          (阶段 2，各自出初稿，互不看对方)
      → bullish_revise ∥ bearish_revise          (阶段 3，各看对方初稿+自己初稿，修订一版)
      → investment_manager → END                 (阶段 4，manager 零改动)
```

5 节点 8 边 → **7 节点 12 边**（+2 节点 +6 边：各 revise 双入边 join 两份初稿，
各 revise → manager）。墙钟 3 阶段 → 4 阶段。

## 2. 关键设计决策与权衡

### 2.1 为什么 revise 是双入边 join（不是只挂自己）

`bullish_revise` 需要同时读 `bullish_opinions[-1]`（自己初稿）与
`bearish_opinions[-1]`（对方初稿）。若只挂 `bullish_trader → bullish_revise`
单入边，LangGraph 可能在 `bearish_trader` 完成前执行 revise → 对方初稿缺失。
双入边 = 隐式 join（复用现有 join 语义，`core/investment_committee.py:91-99`
先例），两 revise 节点互相独立 → 保持并行。

### 2.2 为什么修订版追加写原 key（State 零新 key）

`bullish_opinions` 是 `Annotated[list, add_messages]`（`utils/state.py:11`），
节点返回字符串由 reducer 包成消息追加。revise 返回 `{"bullish_opinions": 修订版}`
→ 追加到草稿之后；manager 读 `[-1].content`（`investment_manager.py:44-45`）
**零改动**拿到修订版。草稿保留在列表中（UI 展示对抗过程、评估信号 3 的
"修订保留率"依赖它）。

### 2.3 为什么 max_tool_rounds=3

`invoke_with_tools` 已有该参数（`core/llms/tool_loop.py:32-35`，默认 10）。
成本护栏（PRD R3）：最坏搜索上界 90 → 150（+67%，见研究 implementation-options
§3 表），revise 收紧到 3 后上界 ≈ 90 + 2×3×3 = 108 量级。初稿轮保持 10 不动
（2026-08-04 用户拍板放宽的语义不回归）。工具循环公共语义零改动——只传参。

### 2.4 为什么 display 用追加渲染 + (key, content) 去重

现状：`rendered` set 按 key 去重（`core/ui/display.py:177,184-186`）——同 key
只渲染第一次。改后：revise 的修订版会被跳过，UI 停留在初稿，与 manager 实际
消费的修订版不一致。改动（约 8 行）：

- 去重集合改为 `(key, content)` 对（防 superstep 兜底重复推送：节点 push +
  superstep update 同内容各来一遍，`core/ui/display.py:69-85` `_stream_graph_events`）；
- 首次渲染 key → header + 内容；再次渲染同 key → `---` 分隔 + 内容（追加）。

### 2.5 为什么 revise prompt 必须与初稿路由短语互斥

离线测试按 system 消息路由（`test/integration/test_graph_parallel.py:50-73`）：
`if "坚定看空的股票交易员" in system: return BEAR`。若 revise prompt 含相同
短语 → 路由歧义。设计：revise prompt 以独有角色短语开头（如"对抗修订轮"），
且**不含**初稿的独特短语（"坚定看多的股票交易员" / "坚定看空的股票交易员"）。
测试路由新短语与 prompt 同步实现。

### 2.6 为什么不做

- 收敛检测 / 多轮循环 / conditional edge：verdict 明确不推荐（10 轮不收敛
  前科、judge 被雄辩带偏风险、文献无多轮边际增益稳定证据）。本项目首次
  引入 conditional edge 的复杂度不付。
- manager 追问式（方案 2）：研究结论——实现面最大、引导性锚定风险，留到
  评估证明需要时。
- 方案 4 单独先落再评估：研究说"先落方案 4 并跑评估"是流程建议；产品上
  两方案同轮实现（prompt 与图改动独立、互不阻塞），评估脚本另行安排。

## 3. 数据流与契约

### 3.1 Revise 节点查询构建（bullish 侧，bearish 对称）

```python
def bullish_revise(self, state: State):
    own = state['bullish_opinions'][-1].content       # 自己初稿
    opponent = state['bearish_opinions'][-1].content  # 对方初稿
    query = f"空方交易员观点：\n{opponent}\n\n你的初稿多头观点：\n{own}\n\n请逐条检视空方论据并给出修订版完整多头观点。"
    response, messages = invoke_with_tools(self.llm, query, self.config,
        tools=self.tools, max_tool_rounds=3, progress_updater=self.progress_updater)
    push_report(self.progress_updater, "bullish_opinions", response.content)
    return {"messages": messages, "bullish_opinions": response.content}
```

注意：`state['bullish_opinions']` 在节点内恒为消息列表（reducer 行为，
agents spec State 契约段）；`[-1].content` 取最后一条（初稿）。

### 3.2 Revise 角色 prompt（`core/llms/prompt.py` 新增）

- 角色：对抗修订轮（独有短语，与初稿路由短语互斥）；
- 任务：逐条回应对方论据（承认成立项 / 反驳不成立项及原因）、保留自己 ≥80%
  核心论据、不得反转立场、给出**完整修订版观点**（不是只输出反驳——manager
  当完整观点消费）、可联网搜索验证；
- 风格：中文、禁编造、禁无出处数字（house style，`prompt.py:1-5` 系统壳 +
  角色消息）。

### 3.3 进度与报告

- `safe_progress(self.progress_updater, "开始多方观点修订。。。")` 等（与
  初稿节点同风格）；
- `push_report` 同 key（R5 的追加渲染消费它）。

## 4. 测试改动（test/integration/test_graph_parallel.py）

| 用例 | 现状断言 | 改后断言 |
|---|---|---|
| `test_join_supplies_both_reports_to_traders` | 不变 | 不变（初稿查询仍含两份专家报告） |
| `test_manager_receives_both_opinions` | `[-1].content == BULL/BEAR`；manager 查询含 BULL+BEAR | `[-1].content == BULL_REV/BEAR_REV`；manager 查询含修订版 marker；**新增**：revise 查询含对方 marker（join 语义） |
| `test_messages_channel_complete` | `len == 11` | `len == 15`（+2 节点 × 查询+响应） |
| `test_independent_pairs_run_parallel` | 3 阶段 <8.5s | 4 阶段：2s×4=8s，断言 `<9.5s`（仍能拦截 5 串行 10s） |
| `test_throwing_progress_updater_does_not_break_graph` | `len == 11` | `len == 15` |
| `test_bridge_collects_progress_and_all_five_reports` | 5 份报告、progress ≥10 | 7 份报告（同 key 后推值覆盖 dict——reports dict 里 opinions key 为修订版）、progress ≥14 |

新常量：`BULL_REV = "BULL_REV_MARKER 修订版多头：保留看多+回应空方"`、
`BEAR_REV = ...`；`_RoutedLlm` 新增两条路由（revise 独有短语）。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| revise 与初稿路由短语冲突 → 测试错乱 | 2.5 节互斥设计；测试先红后绿验证 |
| 修订版被 superstep 兜底重复推送 → UI 重复 | 2.4 节 (key, content) 去重 |
| revise 轮搜索成本失控 | max_tool_rounds=3（2.3 节）；评估跑批 WEB_SEARCH_DISABLED（既有开关） |
| manager 上下文变长（修订版更长） | 可接受：+1 份观点文本 token；评估信号 3 的保留率护栏盯 |
| 修订趋同/flip-flop | R4 prompt 硬约束（≥80% 保留、不反转立场）；离线测试钉修订版 marker |
| 全量回归时序断言 flaky | 4 阶段并行 ≈8s，阈值 9.5s 留 1.5s 余量（CI 负载保守） |

## 6. 回滚

- 无开关（verdict MVP 不含开关；WEB_SEARCH_DISABLED 只管搜索）。回滚 =
  撤销本任务 commit（+2 节点 -6 边、prompt 增补、display 渲染恢复按 key 去重、
  测试还原）——全部是本任务自含改动，无跨任务依赖。
- 若生产观察（评估信号 2/3）显示修订劣化 → 回滚到 5 节点图，保留 prompt 级
  方案 4（独立可留）。

## 7. 兼容性清单（不动的东西）

- `utils/state.py`（State 结构）零改动；
- `core/llms/tool_loop.py` 公共语义零改动（只传 max_tool_rounds）；
- `investment_manager.py` / fundamental / trend 零改动；
- `WEB_SEARCH_DISABLED` / `TDX_MCP_DISABLED` 开关语义不变；
- 非本任务测试（test/ 其余 220 用例）应零影响——revise 只影响 committee
  图装配路径（`make_investment_committee`）；其他单测不构造该图。待确认：
  `test/integration/test_basic_graph.py`（deprecated skip，单 agent 图）不受影响。
