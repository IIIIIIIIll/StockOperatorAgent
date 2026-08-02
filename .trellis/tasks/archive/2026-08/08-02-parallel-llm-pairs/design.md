# Design: 并行化独立 LLM 对（review #4）

## 1. 现状

`make_investment_committee`（core/investment_committee.py:61-66）8 行
add_edge 串行链。5 节点每次调用是串行等待：墙钟 ≈ Σ 单节点延迟。

依赖图（数据流）：
```
stock_information ──► fundamental ──┐
stock_information ──► trend ────────┼──► bullish ──┐
                                    ├──► bearish ──┼──► manager ──► END
```

## 2. 目标图

```
START ──► fundamental ──┐
        ► trend ────────┼──► bullish ──┐
                        ├──► bearish ──┼──► manager ──► END
```

装配（仅改 make_investment_committee）：

```python
graph_builder.add_edge(START, "fundamental_analysis_expert")
graph_builder.add_edge(START, "trend_analysis_expert")
graph_builder.add_edge("fundamental_analysis_expert", "bullish_trader")
graph_builder.add_edge("trend_analysis_expert", "bullish_trader")
graph_builder.add_edge("fundamental_analysis_expert", "bearish_trader")
graph_builder.add_edge("trend_analysis_expert", "bearish_trader")
graph_builder.add_edge("bullish_trader", "investment_manager")
graph_builder.add_edge("bearish_trader", "investment_manager")
graph_builder.add_edge("investment_manager", END)
```

LangGraph 语义（1.2.10，需测试钉死）：
- **隐式 join**：节点所有入边对应的上游全部完成才执行——bullish 等
  fundamental 与 trend 两者；manager 等两份观点。
- 并行分支并发执行（内部线程池）；不同 key 的 state 更新各自合并，无写冲突
  （fundamental_analysis / trend_analysis / bullish_opinions /
  bearish_opinions 四 key 独立；messages 由 add_messages reducer 合并）。
- 流式输出：`graph.stream` 每节点一次 yield——display 的 `responses.values()`
  循环与 `get_state_history[0]` 读取不受节点顺序影响（验收标准断言）。

## 3. 为什么不改节点方法

- 节点方法只读 `state[...]` 并返回 update dict（agents spec 模板）——并行
  化是纯图装配变化；改节点即破坏"模板不改"约定。
- bullish/bearish 的查询内容（fundamental + trend 报告）在 join 后与串行
  完全一致 → prompt 语义零变化。

## 4. 测试设计

### 4.1 离线图形状（新文件 test/integration/test_graph_parallel.py）

`FakeListChatModel(responses=[r1..r5])`（langchain_core 内置，无自定义假
LLM）喂 5 节点；种子 state 用 dummy 常量（test_basic_graph.py 的
`dummy_fundamental_analysis` 等风格）。断言：

1. **join 生效**：bullish 收到的查询文本包含 fundamental 与 trend 两份
   dummy 内容（节点查询是插值文本，直接断言子串）。
2. **manager 完整输入**：最终 state 的 `final_decision` 非空；manager
   查询含 bullish+bearish 观点。
3. **messages 完整性**：`state["messages"]` 含 10 条（5 组 query+response）。
4. **并行性可观测**：FakeListChatModel 加每节点延迟注入（sleep）→ 墙钟
   ≈ 2 阶段而非 5（宽松断言，如 < 4×单节点延迟；CI 抖动容差大）。
   —— 若延迟断言不稳，退化为纯结构断言（1-3）+ 手动实测。

### 4.2 回归

- display 流式路径：test/core/ui/test_display.py 现网（ZODB 真库）跑
  双节点 join 断言（若现有用例已覆盖 get_state_history 读取，则仅回归）。
- 全量 pytest 0 新增失败；被 skip 的 test_basic_graph /
  test_investment_committee 不复活。

## 5. 风险与权衡

- **限流**：两节点同时打到 DeepSeek → 瞬时 2× 并发。QPS 低（单用户本地
  应用），风险小；429 由 #6 重试兜底（本任务不实现）。
- **输出顺序**：并行分支的 `messages` 合并顺序不确定——display 不依赖
  messages 顺序（只读最终 state 各 key），日志顺序交错可接受（PRD R5）。
- **InMemorySaver + 并行**：checkpoint 写入在线程池执行，langgraph 1.2
  内部管理，不手工触碰。

## 6. 回滚

- 恢复 8 条串行边 = 一行 revert（图装配是唯一改动面）。节点/State/
  display 零改动 → 无其他回滚面。

## 7. spec 修订

- agents/index.md："The Graph Contract" / 图装配段更新为并行结构 +
  隐式 join 语义说明。
