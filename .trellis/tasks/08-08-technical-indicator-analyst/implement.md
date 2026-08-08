# 实施计划：技术指标分析师

## 执行清单（有序）

0. **新指标模块**：`core/llms/tools/extra_indicators.py`（`calc_macd_vh` + `calc_liu_bias`，vendor 零改动，复用 vendor calc_ema/calc_atr）；`get_trend_indicators.py` 输出追加 2 行（MACD-VH 含柱态+动量区、刘晨明乖离率）——公式见 research/indicators-macd-vh-liu-bias.md
1. **prompt.py**：新增 `technical_indicator_analyst_message`（含路由独有短语"精于技术指标信号解读与择时判断" + MACD-VH 柱态/动量区 + 刘晨明乖离率阈值解读）；同步更新 bullish/bearish/investment_manager 三处 prompt 文案（设计.md §5）
2. **utils/state.py**：新增 `technical_indicator_analysis: Optional[str]`
3. **新 agent**：`agents/chinese_mainland/technical_indicator_analyst.py`（复制 trend_analysis_expert 形状，专家层不传 tools）
4. **investment_committee.py**：import + 注册节点 + 3 条边（START→、→bullish、→bearish）
5. **下游节点 query**：bullish_trader.py / bearish_trader.py / investment_manager.py 追加第三份报告插值
6. **display.py**：REPORT_KEYS + tab「技术指标分析」（两处同步）
7. **test_extra_indicators.py**（新）：小样本 df 手算断言公式 + 柱态四态
8. **test_get_trend_indicators.py**：marker 断言加 "MACD-VH" / "刘晨明乖离率"
9. **test_graph_parallel.py**：路由表加新短语分支；join/bridge/manager 测试同步（7→8 报告）
10. **e2e**：mock_committee.py MOCK_REPORTS + FakeGraph；test_smoke.py:46 tab 标签；test_interaction.py 报告断言
11. **test_basic_graph.py**：检查 dummy 夹具是否需同步（单 agent 图则零改动）

## 验证命令

```bash
# 指标模块单测（步骤 0/7 后）
python3 -m pytest test/core/llms/tools/test_extra_indicators.py test/core/llms/tools/test_get_trend_indicators.py -x -q

# 每次关键步骤后跑离线图测试（路由/join/bridge 全绿）
python3 -m pytest test/integration/test_graph_parallel.py -x -q

# 全量回归（现状 116 passed，新增后 ≥ 116 且全绿）
python3 -m pytest -q

# E2E（Playwright，若环境可跑）
python3 -m pytest test/e2e -q
```

## 风险文件 / 回滚点

- `core/investment_committee.py`（图装配，第 4 步）——回滚点：git revert，纯增量边无持久化影响
- `core/llms/prompt.py`（路由短语歧义风险）——测试钉死 UNROUTED
- `core/ui/display.py` + `test/e2e/*`（UI 与 e2e 断言必须同提交锁步）
- `core/llms/tools/extra_indicators.py` + `get_trend_indicators.py`（新指标模块）——**不得碰 vendor/**（VENDOR.md 严禁分叉）；输出格式变化影响 stock_information 全文（所有 agent 共享）与既有指标测试，锁步更新

## `task.py start` 前检查

- [ ] prd.md / design.md / implement.md 齐备且评审通过
- [ ] 无阻塞 Open Question
