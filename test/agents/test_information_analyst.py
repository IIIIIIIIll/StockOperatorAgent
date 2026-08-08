"""信息面分析师节点单测（08-08-billions-api-integration，Step 4，离线）。

覆盖（implement.md Step 4 清单 + 任务要求）：
- 确定性预抓：SEARCH 开 → 公告/研报/新闻各 1 次 search（count=5、
  search_mode=fast、time_range=past 3 months、查询含 ticker）；
  TWITTER 开 → 1 次 twitter_search（同参数形状）
- 开关过滤源：SEARCH 单独关 → 零 search；TWITTER 单独关 → 零 twitter
- 报告结构：LLM 查询含带来源的检索上下文（【公告检索结果】等分节 +
  title/link/date/institution/doc_id/浏览数）；响应进入
  information_analysis key；messages 通道完整（查询 + 响应）
- 单源失败（BillionsApiError）→ 仅该源跳过并在上下文注明，其余源
  不受影响、不 raise（AC4 降级风格）
- 全部源失败 / 全部源关闭 → 仍产出报告（上下文说明无可用信息），不崩溃
- 开关全关 → 零 client 调用（空操作；图接线保证该组合节点不入图）

house style 无 mock 框架——`_client` 注入（fake 记录调用，断言在测试
侧）+ _FakeLLM 记录查询（对齐 test_committee_enrichment._FakeLLM 模式）
+ env save/restore（对齐 test_billions_tools._with_env，跨运行确定性）。
"""

import os

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from agents.chinese_mainland.information_analyst import BillionsInformationAnalyst
from data_source.chinese_mainland.billions.client import BillionsApiError

# 本步涉及的 BILLIONS_* env——每次运行前全部清除/恢复（防开发者本机残留）
_ENV_KEYS = [
    "BILLIONS_API_KEY",
    "BILLIONS_DISABLED",
    "BILLIONS_SEARCH_DISABLED",
    "BILLIONS_TWITTER_DISABLED",
    "BILLIONS_ANALYST_DISABLED",
]


def _with_env(pairs, fn):
    """临时设置 env（None 值 = 清除），fn 执行后恢复原状（跨运行确定性）。

    先全量清空 _ENV_KEYS（显式置空串）再应用 pairs：空串为显式假值且
    load_dotenv 不覆盖已设键——防开发者 shell/.env 残留 BILLIONS_* 翻转用例。
    """
    saved = {key: os.environ.get(key) for key in _ENV_KEYS}
    try:
        for key in _ENV_KEYS:
            os.environ[key] = ""
        for key, value in pairs.items():
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


_REPORT = "【信息面分析报告】\n公告：半年报发布\n研报：目标价上调\n推特：市场热议"


class _FakeLLM(BaseChatModel):
    """记录格式化后的消息并返回固定 AIMessage——隔离节点与 live LLM。

    走真实构造路径（prompt|llm 链要求 llm 是 Runnable）；_generate 收到
    的末条消息即 agent 拼装的查询（含检索上下文，对齐
    test_committee_enrichment._FakeLLM 模式）。
    """

    last_messages: list | None = None

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.last_messages = messages
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=_REPORT))])

    @property
    def _llm_type(self):
        return "fake"


class _FakeClient:
    """记录 search/twitter_search 调用；按源预置异常或返回响应。

    断言不写在 fake 里（失败会先被节点降级为注明文本）——fake 只记录，
    断言在测试侧读 ``search_calls`` / ``twitter_calls``（house style）。
    """

    def __init__(self, search_data=None, twitter_data=None, search_errors=None, twitter_error=None):
        self.search_data = search_data if search_data is not None else _SEARCH_OK
        self.twitter_data = twitter_data if twitter_data is not None else _TWITTER_OK
        self.search_errors = search_errors or {}
        self.twitter_error = twitter_error
        self.search_calls = []
        self.twitter_calls = []

    def search(self, query, source="web", search_mode="fast", count=10, time_range=None, timeout=None):
        self.search_calls.append({
            "query": query, "source": source, "search_mode": search_mode,
            "count": count, "time_range": time_range,
        })
        if source in self.search_errors:
            raise self.search_errors[source]
        return self.search_data

    def twitter_search(self, query, search_mode="fast", count=10):
        self.twitter_calls.append({"query": query, "search_mode": search_mode, "count": count})
        if self.twitter_error is not None:
            raise self.twitter_error
        return self.twitter_data


_SEARCH_OK = {
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
                "title": "紫金矿业深度报告",
                "link": "https://example.com/zjky-report",
                "snippet": "目标价上调至 25 元",
                "date": "2026-07-10",
                "extra": {"institution": "国泰君安"},
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
        "source": "web",
    }],
}

_TWITTER_OK = {
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
            {"link": "https://x.com/empty/status/2"},  # 无正文条目（跳过）
        ],
        "status": "ok",
        "source": "twitter",
    }],
}


def _run_analyst(fake_llm, client, env):
    """开关 env 下运行分析师节点（_client 注入，零网络），返回节点结果。"""
    def _run():
        analyst = BillionsInformationAnalyst(
            fake_llm, {"configurable": {"thread_id": "1"}}, _client=client
        )
        return analyst.information_analyst({
            "target_stock_ticker": "000001",
            "stock_information": "dummy stock info",
        })

    return _with_env(env, _run)


class TestInformationAnalystNode:

    def _query_text(self, fake_llm):
        return fake_llm.last_messages[-1].content

    def test_prefetch_calls_all_sources_with_fixed_params(self):
        client = _FakeClient()
        fake_llm = _FakeLLM()
        result = _run_analyst(fake_llm, client, {"BILLIONS_API_KEY": "k"})
        # 确定性预抓：公告/研报/新闻各 1 次 + 推特 1 次（固定成本契约）
        assert [c["source"] for c in client.search_calls] == ["announcement", "report", "web"]
        for call in client.search_calls:
            assert call["search_mode"] == "fast"
            assert call["count"] == 5
            assert call["time_range"] == "past 3 months"
            assert "000001" in call["query"]
        assert len(client.twitter_calls) == 1
        assert client.twitter_calls[0]["search_mode"] == "fast"
        assert client.twitter_calls[0]["count"] == 5
        assert "000001" in client.twitter_calls[0]["query"]
        # State 契约：一次性写入 information_analysis + messages 通道完整
        assert result["information_analysis"] == _REPORT
        assert len(result["messages"]) == 2
        assert isinstance(result["messages"][1], AIMessage)

    def test_query_contains_sourced_context(self):
        client = _FakeClient()
        fake_llm = _FakeLLM()
        _run_analyst(fake_llm, client, {"BILLIONS_API_KEY": "k"})
        query = self._query_text(fake_llm)
        # 来源分节：公告/研报/新闻/推特
        for marker in ("【公告检索结果】", "【研报检索结果】", "【新闻检索结果】", "【推特检索结果】"):
            assert marker in query
        # 字段契约：title/link/date/institution/doc_id/浏览数
        assert "紫金矿业发布2026年半年报" in query
        assert "https://example.com/zjky-h1" in query
        assert "国泰君安" in query
        assert "doc_id: ANN20260725001" in query
        assert "12345 次浏览" in query
        assert "2026-08-08" in query
        # 股票信息透传（human = 检索上下文 + 股票信息）
        assert "dummy stock info" in query
        # 无正文的脏条目跳过
        assert "empty/status/2" not in query

    def test_search_switch_off_skips_search_sources(self):
        client = _FakeClient()
        fake_llm = _FakeLLM()
        _run_analyst(fake_llm, client, {"BILLIONS_API_KEY": "k", "BILLIONS_SEARCH_DISABLED": "1"})
        assert client.search_calls == []  # SEARCH 关 → 零 search
        assert len(client.twitter_calls) == 1  # TWITTER 不受影响

    def test_twitter_switch_off_skips_twitter(self):
        client = _FakeClient()
        fake_llm = _FakeLLM()
        _run_analyst(fake_llm, client, {"BILLIONS_API_KEY": "k", "BILLIONS_TWITTER_DISABLED": "1"})
        assert len(client.search_calls) == 3
        assert client.twitter_calls == []

    def test_single_source_failure_skipped_with_note(self):
        # 单源失败（BillionsApiError）：该源跳过并注明，其余源照常、不 raise
        client = _FakeClient(search_errors={
            "report": BillionsApiError("亿信 API 错误：HTTP 429", code="rate limit", status_code=429),
        })
        fake_llm = _FakeLLM()
        result = _run_analyst(fake_llm, client, {"BILLIONS_API_KEY": "k"})
        assert len(client.search_calls) == 3  # 三源都尝试（失败源也发了请求）
        query = self._query_text(fake_llm)
        assert "【研报检索失败】" in query
        assert "429" in query
        assert "【公告检索结果】" in query  # 其余源不受影响
        assert result["information_analysis"] == _REPORT

    def test_all_sources_fail_still_produces_report(self):
        # 全部源失败：上下文全为失败注明，仍单次 LLM 产出报告（不崩溃）
        err = BillionsApiError("亿信 API 请求失败：connection refused", status_code=None)
        client = _FakeClient(
            search_errors={"announcement": err, "report": err, "web": err},
            twitter_error=err,
        )
        fake_llm = _FakeLLM()
        result = _run_analyst(fake_llm, client, {"BILLIONS_API_KEY": "k"})
        query = self._query_text(fake_llm)
        for marker in ("【公告检索失败】", "【研报检索失败】", "【新闻检索失败】", "【推特检索失败】"):
            assert marker in query
        assert result["information_analysis"] == _REPORT

    def test_empty_results_noted_per_source(self):
        # 检索成功但无有效条目：分节注明"无返回结果"（不 raise）
        client = _FakeClient(
            search_data={"success": True, "result": []},
            twitter_data={"success": True, "result": []},
        )
        fake_llm = _FakeLLM()
        _run_analyst(fake_llm, client, {"BILLIONS_API_KEY": "k"})
        query = self._query_text(fake_llm)
        for marker in ("【公告无返回结果】", "【研报无返回结果】", "【新闻无返回结果】", "【推特无返回结果】"):
            assert marker in query

    def test_all_switches_off_is_noop_on_client(self):
        # 开关全关（无 key）：节点空操作——零 client 调用，仍产出占位式
        # 报告（该组合不入图由 committee 接线保证，此处为健壮性兜底）
        client = _FakeClient()
        fake_llm = _FakeLLM()
        result = _run_analyst(fake_llm, client, {"BILLIONS_API_KEY": None})
        assert client.search_calls == [] and client.twitter_calls == []
        query = self._query_text(fake_llm)
        assert "未检索到任何信息面素材" in query
        assert result["information_analysis"] == _REPORT
