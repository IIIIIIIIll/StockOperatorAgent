# UI 报告边算边渲染：报告完成后立即填充对应 Tab

## Goal

当前 `core/ui/display.py` 在 `graph.stream()` 期间只输出进度与日志，五个报告
Tab（基本面/趋势/看涨/看跌/最终结论）要等**整次分析完成**后，才用
`graph.get_state_history()` 的最终 state 一次性填充——用户要等最慢的报告
（最终结论）走完才看到任何报告，尽管基本面/趋势在第一个并行阶段就绪。

改为**流式渲染**：每个报告在其对应节点完成、其 state key 出现在 stream
update 时，立即填充对应 Tab。图/agents/State 零改动，只改 display.py 的
渲染时序。

## Requirements

### R1（边算边渲染）

- 在 `graph.stream` 循环内，对每个节点的 update dict 检查五个报告 key
  （`fundamental_analysis` / `trend_analysis` / `bullish_opinions` /
  `bearish_opinions` / `final_decision`），出现即渲染到对应 Tab。
- 渲染顺序 = 图完成顺序（实测：stage1 双报告并行 → stage2 双观点 →
  stage3 最终结论），用户墙钟等待从"最慢节点"缩短到各报告自身完成点。
- Tab 容器（`st.tabs` 返回的 DeltaGenerator）在 stream 前已创建；循环体
  运行于脚本线程（LangGraph sync stream 在调用线程 yield，并行节点才在
  工作线程——`safe_progress` 已兜住 agent 内部的工作线程调用），
  `st.write` 安全，不新增线程守护。

### R2（值形态消化）

- 实测 stream update 中报告值为**原始字符串**（节点返回即写，reducer 未
  应用）；而最终 state（`get_state_history`）里 `bullish_opinions` /
  `bearish_opinions` 被 `add_messages` reducer 包装成消息列表（旧代码
  `[-1].content` 语义）。新增 `_report_content(value)` 消化两种形态：
  list[消息] → `[-1].content`，其余 → 原样。展示语义与旧实现一致。

### R3（渲染映射可离线测试）

- 提取模块级纯函数/常量：`REPORT_TABS`（key → 标题 五元组，顺序=Tab
  创建顺序）+ `iter_report_items(update)` 产出 `(key, title, content)`
  渲染项（无报告 key 的 update → 空）。UI 循环只做 dispatch（Tab 容器
  dict 查表 + `st.header`/`st.write`），与 Streamlit 解耦——离线测试
  喂合成 update dict 验证映射，不 mock Streamlit（house style）。

### R4（stream 结束后的全量渲染删除）

- 删除 `states = list(graph.get_state_history(config))` 与末尾五段
  一次性渲染——五个 key 各自只写一次、stream update 全覆盖，流式渲染
  无遗漏；保留 `get_state_history` 会重复渲染（st.write 双份）。

### R5（既有行为不变）

- 日志 `logger.debug("Assistant: {}", ...)` 保持（update 的 messages
  通道，与现状同语义）。
- 错误守护不变：`graph.stream` try/except → 中文 `st.error` +
  `logger.exception`，不裸 traceback。
- `progress_updater`（status 容器）使用不变；图/State/agents 零改动。

## Acceptance Criteria

- [ ] fundamental/trend 在其节点完成即填充对应 Tab（不等 final_decision）
- [ ] bullish/bearish 在其节点完成即填充；final_decision 最后填充
- [ ] 每个 Tab 恰好渲染一次（header + 内容，无重复无缺失）
- [ ] `_report_content`：原始字符串原样；消息列表取 `[-1].content`
- [ ] `iter_report_items`：五 key 映射与标题正确、顺序与 Tab 创建一致；
      仅 messages 的 update → 空；bullish/bearish 两种形态（str / 列表）
      均产出正确 content
- [ ] 删除 get_state_history 全量渲染路径（grep 确认 display.py 不再
      调用）
- [ ] 既有 display 测试（key 检查 / enrichment 接线）仍绿
- [ ] 全量回归 0 新增失败（基线 0F/112P/20S，+新用例）

## Notes

- Lightweight task：PRD-only。
- 实测 stream 形态（2026-08-02，假 LLM 真实图）：每个节点 update =
  `{node: {messages: [query, AIMessage], <state_key>: str}}`；两对并行
  节点在同一 superstep 各自 yield（fundamental 与 trend 各一条、bull 与
  bear 各一条、manager 一条）。
- 不做：进度条细化、Tab 内 spinner、失败节点部分结果的占位提示（超出
  本任务范围）。
