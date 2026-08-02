"""图并行化测试（review #4）：真实 wiring + 假 LLM，离线验证 join/并行语义。

用 make_investment_committee(_llm=FakeListChatModel) 注入假 LLM 跑真实图
装配（5 节点 8 边）——不复制 wiring，图结构变化即测试失效。结构断言钉
join 输入完整性与 reducer 行为（order-agnostic，串行/并行均成立）；时序
断言（慢 LLM 注入）证明两对并行：墙钟 3 阶段而非 5 串行。
"""

import time

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.runnables import RunnableConfig

from core.investment_committee import InvestmentCommittee

FUNDAMENTAL = "FUNDAMENTAL_MARKER 基本面结论：低估"
TREND = "TREND_MARKER 趋势结论：上行"
BULL = "BULL_MARKER 看多理由：共振"
BEAR = "BEAR_MARKER 看空理由：高估"
MANAGER = "MANAGER_MARKER 最终决策：持有"

_RESPONSES = [FUNDAMENTAL, TREND, BULL, BEAR, MANAGER]


def _run_graph(llm, progress_updater=None) -> dict:
    config: RunnableConfig = {"configurable": {"thread_id": "1"}}
    committee = InvestmentCommittee()
    graph = committee.make_investment_committee(config, progress_updater=progress_updater, _llm=llm)
    for _ in graph.stream({
        "messages": [{"role": "user", "content": "请帮我分析一下 000001"}],
        "target_stock_ticker": "000001",
        "stock_information": "dummy stock info",
    }, config=config):
        pass
    return list(graph.get_state_history(config))[0].values


class _ThrowingUpdater:
    """模拟 Streamlit DeltaGenerator 在非脚本线程的行为：info 抛错。

    并行节点运行在 LangGraph 工作线程——真实 Streamlit 抛
    NoSessionContext（2026-08-02 实测 002027 分析崩溃）。safe_progress
    必须把它降级为日志，分析不受影响。
    """

    def info(self, message):
        raise RuntimeError("not a script-run thread")


class _RoutedLlm(FakeListChatModel):
    """按系统消息路由响应——并行下调用顺序不定，不能依赖共享响应计数器。

    FakeListChatModel 按调用次序循环 responses，串行时顺序确定；并行化后
    fundamental/trend 与 bull/bear 的调用顺序非确定，按计数器路由会把
    bear 的响应发给 bull。真实 LLM 的响应由查询内容决定——路由即模拟该
    语义（system 消息含角色定义，bull/bear 的查询文本完全相同，只能按
    system 区分）。"""

    def _generate(self, messages, *args, **kwargs):
        system = next((m.content for m in messages if m.type == "system"), "")
        # 注意：角色文案自身含"基本面分析师/趋势分析师"字样（任务描述），
        # 必须用角色独有的短语路由
        if "精于计算公司的基本面数据" in system:
            return self._response(FUNDAMENTAL)
        if "精于根据股票走势给出高准确度的客观趋势分析" in system:
            return self._response(TREND)
        if "坚定看多的股票交易员" in system:
            return self._response(BULL)
        if "坚定看空的股票交易员" in system:
            return self._response(BEAR)
        if "精于价值与趋势结合的投资策略" in system:
            return self._response(MANAGER)
        return self._response("UNROUTED")

    def _response(self, content):
        from langchain_core.messages import AIMessage
        from langchain_core.outputs import ChatGeneration, ChatResult
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=content))])


class _SlowRoutedLlm(_RoutedLlm):
    """每节点 invoke 注入 2s 延迟——串行 5 阶段 ≥10s，并行 3 阶段 ≈6s。"""

    def _generate(self, *args, **kwargs):
        time.sleep(2.0)
        return super()._generate(*args, **kwargs)


class TestGraphParallel:

    def test_join_supplies_both_reports_to_traders(self):
        """join 语义：bullish/bearish 查询同时含 fundamental 与 trend 两份报告。"""
        final = _run_graph(_RoutedLlm(responses=[]))
        contents = [m.content for m in final["messages"]]
        assert any(FUNDAMENTAL in c and TREND in c for c in contents), \
            "trader 查询应插值两份报告（join 后输入完整）"

    def test_manager_receives_both_opinions(self):
        """manager 查询含 bullish 与 bearish 观点正文（[-1].content 语义）。"""
        final = _run_graph(_RoutedLlm(responses=[]))
        contents = [m.content for m in final["messages"]]
        assert any(BULL in c and BEAR in c for c in contents), "manager 查询应含两份观点"
        # reducer 包装行为（1.2.10 已验证）：agent 返回字符串 → 消息列表
        assert final["bullish_opinions"][-1].content == BULL
        assert final["bearish_opinions"][-1].content == BEAR

    def test_messages_channel_complete(self):
        """messages 通道完整：初始 user 消息 + 5 组 query + response = 11 条。"""
        final = _run_graph(_RoutedLlm(responses=[]))
        assert final["messages"][0].content == "请帮我分析一下 000001"  # 初始消息保留
        assert len(final["messages"]) == 11
        assert final["fundamental_analysis"] == FUNDAMENTAL
        assert final["trend_analysis"] == TREND
        assert final["final_decision"] == MANAGER

    def test_independent_pairs_run_parallel(self):
        """时序：两对并行 → 墙钟 ≈3 阶段（串行 5×2s≥10s，并行 3×2s≈6s）。"""
        start = time.monotonic()
        _run_graph(_SlowRoutedLlm(responses=[]))
        elapsed = time.monotonic() - start
        assert elapsed < 8.5, f"expected parallel 3-stage wall clock, got {elapsed:.1f}s"

    def test_throwing_progress_updater_does_not_break_graph(self):
        """并行节点 + 抛错 updater（非脚本线程）：safe_progress 降级，分析完成。

        回归（2026-08-02）：并行化后 Streamlit DeltaGenerator 在工作线程
        info() 抛 NoSessionContext，整个分析崩溃——修复为安全调用后图形状
        与结果不受影响。
        """
        final = _run_graph(_RoutedLlm(responses=[]), progress_updater=_ThrowingUpdater())
        assert final["final_decision"] == MANAGER
        assert len(final["messages"]) == 11
