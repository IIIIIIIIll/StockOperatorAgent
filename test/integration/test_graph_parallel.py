"""图并行化测试（review #4 + 08-04-adversarial-verdict-loop +
08-08-technical-indicator-analyst + 08-08-billions-api-integration）：
真实 wiring + 假 LLM，离线验证 join/并行语义。

用 make_investment_committee(_llm=FakeListChatModel) 注入假 LLM 跑真实图
装配（8 节点 15 边：+bullish_revise/bearish_revise 对抗修订轮 +
+technical_indicator_analyst 技术指标分析师；ANALYST 开关开 → 条件 +1
信息面分析师 = 9 节点）——不复制 wiring，图结构变化即测试失效。结构断言
钉 join 输入完整性与 reducer 行为（order-agnostic，串行/并行均成立）；
时序断言（慢 LLM 注入）证明专家 +两对并行：墙钟 4 阶段而非串行。revise
路由短语与初稿短语互斥、分析师短语与其余角色互斥（见 prompt.py），按
system 消息路由不歧义。

BILLIONS_* 开关由 _run_graph/_graph_node_names 统一隔离（默认全关——
键显式置空串防开发者 .env 残留翻转图形状，跨运行确定性）；信息面分析师
启用形态下经 client 模块工厂替换注入 fake（零网络，house style）。
"""

import os
import time

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.runnables import RunnableConfig

from core.investment_committee import InvestmentCommittee

FUNDAMENTAL = "FUNDAMENTAL_MARKER 基本面结论：低估"
TREND = "TREND_MARKER 趋势结论：上行"
INDICATOR = "INDICATOR_MARKER 指标信号：金叉"
INFO_ANALYST = "INFO_ANALYST_MARKER 信息面报告：公告利好+推特热议"
BULL = "BULL_MARKER 看多理由：共振"
BEAR = "BEAR_MARKER 看空理由：高估"
BULL_REV = "BULL_REV_MARKER 修订版多头：保留看多+回应空方"
BEAR_REV = "BEAR_REV_MARKER 修订版空头：保留看空+回应多方"
MANAGER = "MANAGER_MARKER 最终决策：持有"

# 本文件涉及的 BILLIONS_* 开关键——统一隔离（含 ANALYST 与 FINDB 能力闸）
_BILLIONS_ENV_KEYS = [
    "BILLIONS_API_KEY",
    "BILLIONS_DISABLED",
    "BILLIONS_FINDB_DISABLED",
    "BILLIONS_SEARCH_DISABLED",
    "BILLIONS_TWITTER_DISABLED",
    "BILLIONS_FETCH_DISABLED",
    "BILLIONS_ANALYST_DISABLED",
]


def _with_billions_env(env, fn):
    """临时设置 BILLIONS_* 开关（None → 全关），fn 执行后恢复原状。

    全关默认：键显式置空串（billions_enabled 判 falsy 即关；空串也是
    显式假值，load_dotenv 不覆盖已设键——防 .env 残留 BILLIONS_API_KEY
    翻转图形状）。env 中 None 值 = 清除（全关）、其他值 = 设置。
    """
    saved = {key: os.environ.get(key) for key in _BILLIONS_ENV_KEYS}
    try:
        for key in _BILLIONS_ENV_KEYS:
            os.environ[key] = ""
        if env:
            for key, value in env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        return fn()
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _run_graph(llm, progress_updater=None, env=None) -> dict:
    config: RunnableConfig = {"configurable": {"thread_id": "1"}}
    committee = InvestmentCommittee()

    def _run():
        graph = committee.make_investment_committee(config, progress_updater=progress_updater, _llm=llm)
        for _ in graph.stream({
            "messages": [{"role": "user", "content": "请帮我分析一下 000001"}],
            "target_stock_ticker": "000001",
            "stock_information": "dummy stock info",
        }, config=config):
            pass
        return list(graph.get_state_history(config))[0].values

    return _with_billions_env(env, _run)


def _graph_node_names(env=None) -> set:
    """构造图（不运行，零 LLM 调用）并返回节点名集合——图形状断言。"""
    config: RunnableConfig = {"configurable": {"thread_id": "1"}}
    committee = InvestmentCommittee()
    return _with_billions_env(
        env,
        lambda: set(committee.make_investment_committee(config, _llm=_RoutedLlm(responses=[])).get_graph().nodes),
    )


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
        # 技术指标分析师（08-08-technical-indicator-analyst）：独有短语
        # "精于技术指标信号解读与择时判断"——与其余角色子串互斥（分析师
        # 任务描述含"趋势分析师"字样，必须按此独有短语路由）
        if "精于技术指标信号解读与择时判断" in system:
            return self._response(INDICATOR)
        # 信息面分析师（08-08-billions-api-integration，Step 4）：独有短语
        # "精于整合公告、研报、新闻与推特等多源信息"——与其余角色子串互斥
        if "精于整合公告、研报、新闻与推特等多源信息" in system:
            return self._response(INFO_ANALYST)
        if "坚定看多的股票交易员" in system:
            return self._response(BULL)
        if "坚定看空的股票交易员" in system:
            return self._response(BEAR)
        # 对抗修订轮（08-04-adversarial-verdict-loop）：revise prompt 独有
        # 角色短语（含"对抗修订轮"、不含初稿的"坚定看多/看空"）——路由互斥，
        # 且排在初稿路由之后，歧义即 "UNROUTED" 暴露
        if "对抗修订轮的多方交易员" in system:
            return self._response(BULL_REV)
        if "对抗修订轮的空方交易员" in system:
            return self._response(BEAR_REV)
        if "精于价值与趋势结合的投资策略" in system:
            return self._response(MANAGER)
        return self._response("UNROUTED")

    def _response(self, content):
        from langchain_core.messages import AIMessage
        from langchain_core.outputs import ChatGeneration, ChatResult
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=content))])


class _SlowRoutedLlm(_RoutedLlm):
    """每节点 invoke 注入 2s 延迟——串行 8 阶段 ≥16s，并行 4 阶段 ≈8s。"""

    def _generate(self, *args, **kwargs):
        time.sleep(2.0)
        return super()._generate(*args, **kwargs)


class TestGraphParallel:

    def test_join_supplies_all_reports_to_traders(self):
        """join 语义：bullish/bearish 查询同时含三份专家报告（fundamental +
        trend + technical_indicator）——三入边 join 后输入完整。

        trader 查询不含观点 marker（revise/manager 才有），精确筛出恰好
        两条 trader 查询。
        """
        final = _run_graph(_RoutedLlm(responses=[]))
        contents = [m.content for m in final["messages"]]
        trader_queries = [
            c for c in contents
            if FUNDAMENTAL in c and TREND in c and INDICATOR in c
            and BULL_REV not in c and BEAR_REV not in c
        ]
        assert len(trader_queries) == 2, \
            "两条 trader 查询应各含三份专家报告（join 后输入完整）"

    def test_manager_receives_both_opinions(self):
        """manager 查询含 bullish 与 bearish 修订版正文（[-1].content 语义）。"""
        final = _run_graph(_RoutedLlm(responses=[]))
        contents = [m.content for m in final["messages"]]
        assert any(BULL_REV in c and BEAR_REV in c for c in contents), \
            "manager 查询应含两份修订版观点"
        # 修订版追加写原 opinions key（State 零新 key）：初稿保留在 [0]，
        # manager 经 [-1].content 零改动读到修订版（reducer 包装 1.2.10 已验证）
        assert final["bullish_opinions"][0].content == BULL
        assert final["bullish_opinions"][-1].content == BULL_REV
        assert final["bearish_opinions"][0].content == BEAR
        assert final["bearish_opinions"][-1].content == BEAR_REV

    def test_revise_receives_opponent_draft(self):
        """join 语义（08-04-adversarial-verdict-loop）：revise 双入边——
        各 revise 查询同时含对方初稿与自己初稿（[-1].content 取初稿）。

        manager 查询只含修订版 marker（BULL_REV/BEAR_REV，不含初稿
        BULL/BEAR），故含双初稿 marker 的查询必为 revise 轮——恰好两条。
        """
        final = _run_graph(_RoutedLlm(responses=[]))
        contents = [m.content for m in final["messages"]]
        both_drafts = [c for c in contents if BULL in c and BEAR in c]
        assert len(both_drafts) == 2, \
            "两条 revise 查询应各含对方初稿（bullish_revise 含空方初稿、bearish_revise 含多方初稿）"

    def test_messages_channel_complete(self):
        """messages 通道完整：初始 user 消息 + 8 组 query + response = 17 条。"""
        final = _run_graph(_RoutedLlm(responses=[]))
        assert final["messages"][0].content == "请帮我分析一下 000001"  # 初始消息保留
        assert len(final["messages"]) == 17
        assert final["fundamental_analysis"] == FUNDAMENTAL
        assert final["trend_analysis"] == TREND
        assert final["technical_indicator_analysis"] == INDICATOR
        assert final["final_decision"] == MANAGER

    def test_independent_pairs_run_parallel(self):
        """时序：三专家 + 两对并行 → 墙钟 ≈4 阶段（串行 8×2s≥16s，并行
        4×2s≈8s）。"""
        start = time.monotonic()
        _run_graph(_SlowRoutedLlm(responses=[]))
        elapsed = time.monotonic() - start
        assert elapsed < 9.5, f"expected parallel 4-stage wall clock, got {elapsed:.1f}s"

    def test_throwing_progress_updater_does_not_break_graph(self):
        """并行节点 + 抛错 updater（非脚本线程）：safe_progress 降级，分析完成。

        回归（2026-08-02）：并行化后 Streamlit DeltaGenerator 在工作线程
        info() 抛 NoSessionContext，整个分析崩溃——修复为安全调用后图形状
        与结果不受影响。
        """
        final = _run_graph(_RoutedLlm(responses=[]), progress_updater=_ThrowingUpdater())
        assert final["final_decision"] == MANAGER
        assert len(final["messages"]) == 17

    def test_bridge_collects_progress_and_all_eight_reports(self):
        """queue bridge（08-02-ui-live-progress-bridge）：真实图 + 假 LLM，
        八节点经 ProgressBridge 推送进度与报告——数据面验证节点级即时
        填充的输入完整（display 事件循环消费即可渲染）。

        agent 的 push_report 对非 bridge updater（_ThrowingUpdater）是
        no-op，此用例必须用真 bridge 才收集得到报告。对抗修订轮
        （08-04-adversarial-verdict-loop）：opinions key 推送两次（初稿 +
        修订版）→ 共 8 份报告事件；dict 同 key 后推覆盖 → opinions 为修订版。
        """
        import queue as queue_mod

        from core.llms.progress import ProgressBridge

        events = queue_mod.Queue()
        _run_graph(_RoutedLlm(responses=[]), progress_updater=ProgressBridge(events))
        events_list = list(events.queue)
        report_events = [ev for ev in events_list if ev[0] == "report"]
        assert len(report_events) == 8  # 8 节点 × 1 份（opinions 各推送初稿 + 修订版）
        reports = {ev[1]: ev[2] for ev in report_events}
        assert reports == {
            "fundamental_analysis": FUNDAMENTAL,
            "trend_analysis": TREND,
            "technical_indicator_analysis": INDICATOR,
            "bullish_opinions": BULL_REV,
            "bearish_opinions": BEAR_REV,
            "final_decision": MANAGER,
        }
        progress = [ev[1] for ev in events_list if ev[0] == "progress"]
        assert len(progress) >= 16  # 8 节点 × 开始 + 完成
        assert any("开始" in m for m in progress) and any("完成" in m for m in progress)


# --- 信息面分析师图形状（08-08-billions-api-integration，Step 4） ------------

_INFO_SEARCH_OK = {
    "success": True,
    "result": [{
        "query": "q",
        "content": [
            {
                "title": "紫金矿业发布2026年半年报",
                "link": "https://example.com/zjky-h1",
                "snippet": "上半年净利润同比增长 20%",
                "date": "2026-07-31",
            },
            {
                "title": "紫金矿业：关于收购的公告",
                "link": "https://example.com/zjky-ann",
                "snippet": "拟收购海外金矿",
                "date": "2026-07-25",
                "extra": {"doc_id": "ANN20260725001"},
            },
        ],
        "status": "ok",
        "source": "announcement",
    }],
}

_INFO_TWITTER_OK = {
    "success": True,
    "result": [{
        "query": "q",
        "content": [
            {
                "title": "@stockwatcher: 紫金矿业涨停了",
                "link": "https://x.com/stockwatcher/status/1",
                "snippet": "紫金矿业今日大涨 5%，突破前高",
                "date": "2026-08-08",
                "extra": {"username": "stockwatcher", "view_count": 12345},
            },
        ],
        "status": "ok",
        "source": "twitter",
    }],
}


class _InfoFakeClient:
    """记录亿信检索调用；返回预置响应（house style 注入，断言在测试侧读 calls）。"""

    def __init__(self, search_data=None, twitter_data=None, error=None):
        self.search_data = search_data if search_data is not None else _INFO_SEARCH_OK
        self.twitter_data = twitter_data if twitter_data is not None else _INFO_TWITTER_OK
        self.error = error
        self.search_calls = []
        self.twitter_calls = []

    def search(self, query, source="web", search_mode="fast", count=10, time_range=None, timeout=None):
        self.search_calls.append({
            "query": query, "source": source, "search_mode": search_mode,
            "count": count, "time_range": time_range,
        })
        if self.error is not None:
            raise self.error
        return self.search_data

    def twitter_search(self, query, search_mode="fast", count=10):
        self.twitter_calls.append({"query": query, "search_mode": search_mode, "count": count})
        if self.error is not None:
            raise self.error
        return self.twitter_data


def _with_fake_client(fake, fn):
    """把 client 模块的 BillionsClient 工厂替换为返回 fake 的工厂（零网络）。

    信息面分析师的 _get_client 在调用时 `from ...client import
    BillionsClient`——替换模块属性即让图内节点拿到 fake（house style
    模块全局替换，同 e2e mock 入口模式）。
    """
    import data_source.chinese_mainland.billions.client as client_mod

    saved = client_mod.BillionsClient
    client_mod.BillionsClient = lambda: fake
    try:
        return fn()
    finally:
        client_mod.BillionsClient = saved


class TestGraphAnalystShape:
    """信息面分析师条件接线（R2/AC1/AC3）：两种图形态。

    ANALYST 开 且（SEARCH 或 TWITTER 至少一者开）→ 9 节点 4 专家并行
    （messages = 初始 1 + 9 组查询/响应 = 19）；关 → 8 节点（messages
    17，与今日逐字节一致——既有用例已覆盖该形态）。
    """

    def test_graph_shapes(self):
        # 图形状：ANALYST 关 → 无分析师节点；开 → +1 节点
        # （get_graph().nodes 含 __start__/__end__，用相对计数断言）
        base = _graph_node_names()
        assert "information_analyst" not in base
        enabled = _graph_node_names({"BILLIONS_API_KEY": "k"})
        assert "information_analyst" in enabled
        assert len(enabled) == len(base) + 1

    def test_analyst_node_added_when_enabled(self):
        fake = _InfoFakeClient()
        final = _with_fake_client(
            fake,
            lambda: _run_graph(_RoutedLlm(responses=[]), env={"BILLIONS_API_KEY": "k"}),
        )
        # 9 节点形态：4 专家并行 → messages = 初始 1 条 + 9 组（查询 + 响应）
        assert len(final["messages"]) == 19
        assert final["information_analysis"] == INFO_ANALYST
        # 确定性预抓参数：公告/研报/新闻各 1 次 search + 1 次 twitter
        # （fast、count=5、time_range past 3 months——固定成本契约）
        assert [c["source"] for c in fake.search_calls] == ["announcement", "report", "web"]
        for call in fake.search_calls:
            assert call["search_mode"] == "fast"
            assert call["count"] == 5
            assert call["time_range"] == "past 3 months"
            assert "000001" in call["query"]
        assert len(fake.twitter_calls) == 1
        assert fake.twitter_calls[0]["search_mode"] == "fast"
        assert fake.twitter_calls[0]["count"] == 5
        # 预抓结果进入分析师 LLM 查询（检索到的标题出现在 messages 通道）
        assert any("紫金矿业发布2026年半年报" in m.content for m in final["messages"])
        # 补接线（Step 4）：信息面报告进入下游消费——多空交易员查询含
        # 四份专家报告（4 入边 join 后输入完整），manager 查询含信息面段
        contents = [m.content for m in final["messages"]]
        trader_queries = [
            c for c in contents
            if FUNDAMENTAL in c and TREND in c and INDICATOR in c
            and BULL_REV not in c and BEAR_REV not in c
        ]
        assert len(trader_queries) == 2
        assert all(INFO_ANALYST in q for q in trader_queries)
        assert any(INFO_ANALYST in c and BULL_REV in c and BEAR_REV in c for c in contents)

    def test_analyst_absent_without_key(self):
        # AC1：未配置 key → 分析师节点不入图（8 节点，与今日一致）
        final = _run_graph(_RoutedLlm(responses=[]))
        assert len(final["messages"]) == 17
        assert final.get("information_analysis") is None

    def test_analyst_unavailable_when_both_sources_off(self):
        # Out of Scope 组合：ANALYST 开但 SEARCH/TWITTER 均关 → 视为分析师
        # 不可用，节点不入图（8 节点）+ 零亿信调用
        fake = _InfoFakeClient()
        final = _with_fake_client(
            fake,
            lambda: _run_graph(_RoutedLlm(responses=[]), env={
                "BILLIONS_API_KEY": "k",
                "BILLIONS_SEARCH_DISABLED": "1",
                "BILLIONS_TWITTER_DISABLED": "1",
            }),
        )
        assert len(final["messages"]) == 17
        assert final.get("information_analysis") is None
        assert fake.search_calls == [] and fake.twitter_calls == []

    def test_analyst_filters_sources_by_switch(self):
        # AC3：SEARCH 单独关 → 仅 twitter 预抓（分析师仍在图：TWITTER 开）
        fake = _InfoFakeClient()
        final = _with_fake_client(
            fake,
            lambda: _run_graph(_RoutedLlm(responses=[]), env={
                "BILLIONS_API_KEY": "k",
                "BILLIONS_SEARCH_DISABLED": "1",
            }),
        )
        assert len(final["messages"]) == 19
        assert final["information_analysis"] == INFO_ANALYST
        assert fake.search_calls == []  # SEARCH 关 → 零 search 调用
        assert len(fake.twitter_calls) == 1
