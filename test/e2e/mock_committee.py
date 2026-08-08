"""Playwright UI 测试的假投资委员会（08-07-playwright-ui-test-framework）。

`MockCommittee.make_investment_committee` 返回 `FakeGraph`——`stream()`
迭代吐固定 State（6 个报告 key），零 LLM 构造、零网络。模块级
`CALL_COUNT` 供测试断言「mock 路径被调用、零真实 LLM 调用」。

契约（与 core/ui/display.py 对照，见 design.md 已验证契约表）：
- `committee.make_investment_committee(config, progress_updater=bridge)`
  → 返回 FakeGraph（构造零 LLM）
- `graph.stream(inputs, config)` 迭代 `{node: update}`；迭代结束自然停止
  （display 的 _stream_graph_events finally 推 done）
- 6 个报告 key：fundamental_analysis / trend_analysis /
  technical_indicator_analysis / bullish_opinions / bearish_opinions /
  final_decision（REPORT_TABS）
- 观点 key（bullish/bearish，OPINION_REPORT_KEYS）各吐两条不同内容 →
  display 按 (key, content) 去重后**追加渲染**「第 1 次观点」+「第 2 次
  观点」expander（对齐 08-04-adversarial-verdict-loop 初稿+修订版语义）
- 报告文本带 `#` 标题 + 列表——触发 st.write markdown 渲染，DOM 节点
  可断言（结构断言为主，像素断言仅必要处）
"""

# 6 个报告 key 的 mock 报告内容：固定 markdown 字符串（# 标题 + 列表 +
# 关键词），断言其渲染后的 DOM 文本。内容与真实 LLM 输出无关——测试只
# 关心「mock 内容原样渲染进对应 Tab」。
MOCK_REPORTS = {
    "fundamental_analysis": (
        "# 基本面分析（mock）\n\n"
        "- 营业收入: 增长\n"
        "- 净利润: 增长\n"
        "> mock 基本面结论"
    ),
    "trend_analysis": (
        "# 趋势分析（mock）\n\n"
        "- MA5 上穿 MA10\n"
        "- 量能放大\n"
        "> mock 趋势结论"
    ),
    "technical_indicator_analysis": (
        "# 技术指标分析（mock）\n\n"
        "- MACD 金叉\n"
        "- RSI 中性\n"
        "> mock 指标结论"
    ),
    "bullish_opinions": [
        "# 看涨观点（mock 初稿）\n\n- 多头信号\n- 支撑位有效\n> mock 看涨初稿",
        "# 看涨观点（mock 修订版）\n\n- 修订后看涨理由\n> mock 看涨修订",
    ],
    "bearish_opinions": [
        "# 看跌观点（mock 初稿）\n\n- 空头信号\n- 压力位压制\n> mock 看跌初稿",
        "# 看跌观点（mock 修订版）\n\n- 修订后看跌理由\n> mock 看跌修订",
    ],
    "final_decision": (
        "# 最终结论（mock）\n\n"
        "- 综合评级: 持有\n"
        "> mock 最终结论"
    ),
}

# 真实调用计数器：make_investment_committee 每次被调 +1。测试断言
# CALL_COUNT > 0（mock 路径确实被使用）；「零真实 LLM/网络」由
# conftest 的服务器日志检查 + 本模块无任何真实构造保证。
CALL_COUNT = 0


class FakeGraph:
    """假 LangGraph：stream() 迭代吐固定 State，结束自然停止。

    模拟真实图的两批 superstep（初稿 → 修订版）再收尾：
    1. fundamental + trend + 两份观点初稿（并行阶段）
    2. 两份观点修订版（对抗修订轮）
    3. final_decision（投资经理收尾）
    """

    def stream(self, inputs, config=None):
        yield {
            "mock_node": {
                "fundamental_analysis": MOCK_REPORTS["fundamental_analysis"],
                "trend_analysis": MOCK_REPORTS["trend_analysis"],
                "technical_indicator_analysis": MOCK_REPORTS["technical_indicator_analysis"],
                "bullish_opinions": MOCK_REPORTS["bullish_opinions"][0],
                "bearish_opinions": MOCK_REPORTS["bearish_opinions"][0],
            }
        }
        yield {
            "mock_node": {
                "bullish_opinions": MOCK_REPORTS["bullish_opinions"][1],
                "bearish_opinions": MOCK_REPORTS["bearish_opinions"][1],
            }
        }
        yield {
            "mock_node": {
                "final_decision": MOCK_REPORTS["final_decision"],
            }
        }


class MockCommittee:
    """假 InvestmentCommittee：make_investment_committee 返回 FakeGraph。

    与真实 InvestmentCommittee 相同的调用形状（config, progress_updater）
    ——display.write_ui 的调用点零改动（display.py:173）。progress_updater
    不消费：FakeGraph 无真实 agent，进度消息由 display 自身的
    updatable_container.info 输出（mock_app 的 progress 回调）。
    """

    def make_investment_committee(self, config, progress_updater=None):
        global CALL_COUNT
        CALL_COUNT += 1
        return FakeGraph()
