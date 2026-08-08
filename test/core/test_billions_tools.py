"""亿信 LLM 工具三件套单测（08-08-billions-api-integration，Step 3，离线）。

覆盖（implement.md Step 3 清单 + 任务要求）：
- 三工厂：开关关（无 key / 能力闸 / 总闸）→ None（图不绑定，AC1/AC3）
- 注入 fake client → 输出格式 golden（search：title/link/date/
  institution/doc_id；twitter：@username/浏览数/日期/正文；fetch：
  标题+正文+截断）
- client 抛 BillionsApiError / 一般异常 / 无返回结果 → 占位文本不
  raise（AC4，模型拿到占位 ToolMessage 继续生成）
- 计数上限：超过 _max_calls 后返回占位提示且 fake client 调用次数
  不再增长（AC5）；env 覆盖 BILLIONS_{SEARCH,TWITTER,FETCH}_MAX_CALLS
- committee 绑定：开关组合下 tools 列表内容断言（_RecordingLlm 记录
  bind_tools 收到的工具名；tools=None 时 agent 不 bind_tools）

house style 无 mock 框架——fake 对象注入 + env save/restore（对齐
test_billions_config._with_env 模式，跨运行确定性）。注意：committee
构造内部调用 load_dotenv()（不覆盖已设 env）——本仓库 .env 无
BILLIONS_*/WEB_SEARCH_DISABLED，测试设置的 env 不会被 .env 覆盖。
"""

import os

from langchain_core.language_models.fake_chat_models import FakeListChatModel

from core.investment_committee import InvestmentCommittee
from core.llms.tools.billions_search import make_billions_search_tool
from core.llms.tools.billions_twitter import make_billions_twitter_tool
from core.llms.tools.billions_fetch import make_billions_fetch_tool
from data_source.chinese_mainland.billions.client import BillionsApiError

# 本步涉及的全部 env——每次运行前全部清除/恢复（防开发者本机残留，
# 含 MAX_CALLS 与 WEB_SEARCH_DISABLED）
_ENV_KEYS = [
    "BILLIONS_API_KEY",
    "BILLIONS_DISABLED",
    "BILLIONS_SEARCH_DISABLED",
    "BILLIONS_TWITTER_DISABLED",
    "BILLIONS_FETCH_DISABLED",
    "BILLIONS_SEARCH_MAX_CALLS",
    "BILLIONS_TWITTER_MAX_CALLS",
    "BILLIONS_FETCH_MAX_CALLS",
    "WEB_SEARCH_DISABLED",
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


class _FakeClient:
    """记录 search/twitter_search/fetch 调用；按预置返回响应或抛异常。

    断言不写在 fake 里（失败会先被工具降级为占位文本）——fake 只记录，
    断言在测试侧读 ``calls``（house style 注入）。
    """

    def __init__(self, search_data=None, twitter_data=None, fetch_data=None, error=None):
        self.search_data = search_data
        self.twitter_data = twitter_data
        self.fetch_data = fetch_data
        self.error = error
        self.search_calls = []
        self.twitter_calls = []
        self.fetch_calls = []

    def search(self, query, source="web", search_mode="fast", count=10, time_range=None, timeout=None):
        self.search_calls.append({
            "query": query, "source": source, "search_mode": search_mode,
            "count": count, "time_range": time_range,
        })
        if self.error is not None:
            raise self.error
        return self.search_data or {}

    def twitter_search(self, query, search_mode="fast", count=10):
        self.twitter_calls.append({"query": query, "search_mode": search_mode, "count": count})
        if self.error is not None:
            raise self.error
        return self.twitter_data or {}

    def fetch(self, url=None, doc_id=None, page=None, max_chars=None):
        self.fetch_calls.append({"url": url, "doc_id": doc_id})
        if self.error is not None:
            raise self.error
        return self.fetch_data or {}


_SEARCH_OK = {
    "success": True,
    "result": [{
        "query": "q",
        "content": [
            {
                "title": "紫金矿业发布2026年半年报",
                "link": "https://example.com/zjky-2026-h1",
                "snippet": "上半年净利润同比增长 20%",
                "date": "2026-07-31",
            },
            {
                "title": "紫金矿业：关于收购的公告",
                "link": "https://example.com/zjky-announce",
                "snippet": "拟收购海外金矿",
                "date": "2026-07-25",
                "extra": {"doc_id": "ANN20260725001"},
            },
            {
                "title": "紫金矿业深度报告",
                "link": "https://example.com/zjky-report",
                "snippet": "目标价 25 元",
                "date": "2026-07-10",
                "extra": {"institution": "国泰君安"},
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
            {
                "title": "无正文的条目",
                "link": "https://x.com/xxx/status/2",
                "extra": {"username": "empty"},
            },
        ],
        "status": "ok",
        "source": "twitter",
    }],
}

_FETCH_OK = {
    "success": True,
    "type": "document",
    "id": "123",
    "source": "announcement",
    "title": "紫金矿业集团股份有限公司2026年半年度报告",
    "content": "| 项目 | 数值 |\n|---|---|\n| 营业收入 | 1500亿 |\n| 净利润 | 200亿 |",
}


def _make(factory, **kwargs):
    """在开关开 env 下构造工具（注入点透传）。"""
    return _with_env({"BILLIONS_API_KEY": "k"}, lambda: factory(**kwargs))


class TestMakeBillionsSearchTool:

    def test_no_key_returns_none(self):
        assert _with_env({"BILLIONS_API_KEY": None}, make_billions_search_tool) is None

    def test_switch_off_returns_none_even_with_client(self):
        # 开关关 → None（即使注入 fake，也不触发任何 client 构造/调用）
        assert _with_env(
            {"BILLIONS_API_KEY": None},
            lambda: make_billions_search_tool(_client=_FakeClient(_SEARCH_OK)),
        ) is None

    def test_capability_switch_disables(self):
        assert _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_SEARCH_DISABLED": "1"},
            make_billions_search_tool,
        ) is None

    def test_master_switch_disables(self):
        assert _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_DISABLED": "true"},
            make_billions_search_tool,
        ) is None

    def test_twitter_and_fetch_unaffected_by_search_switch(self):
        # AC3：SEARCH 单独关 → 仅 search 工厂 None，其余能力不受影响
        def check():
            assert make_billions_search_tool() is None
            assert make_billions_twitter_tool(_client=_FakeClient(twitter_data=_TWITTER_OK)) is not None
            assert make_billions_fetch_tool(_client=_FakeClient(fetch_data=_FETCH_OK)) is not None

        _with_env({"BILLIONS_API_KEY": "k", "BILLIONS_SEARCH_DISABLED": "1"}, check)

    def test_success_returns_markdown_list(self):
        fake = _FakeClient(_SEARCH_OK)
        tool = _make(make_billions_search_tool, _client=fake)
        text = tool.invoke({"query": "紫金矿业 最新公告"})
        assert "【亿信检索结果】" in text
        # 基本条目：- [title](link) — date(snippet)
        assert "- [紫金矿业发布2026年半年报](https://example.com/zjky-2026-h1) — 2026-07-31(上半年净利润同比增长 20%)" in text
        # 公告条目：extra.doc_id 透出（billions_fetch 精读入口）
        assert "doc_id: ANN20260725001" in text
        # 研报条目：extra.institution 机构名（上游无作者字段）
        assert "国泰君安" in text
        # 客户端收到工具参数（默认 web/fast/count=5、time_range 透传）
        assert fake.search_calls[0] == {
            "query": "紫金矿业 最新公告", "source": "web", "search_mode": "fast",
            "count": 5, "time_range": None,
        }

    def test_args_forwarded(self):
        fake = _FakeClient(_SEARCH_OK)
        tool = _make(make_billions_search_tool, _client=fake)
        tool.invoke({
            "query": "宁德时代 固态电池",
            "source": "report",
            "count": 10,
            "time_range": "past 2 weeks",
            "search_mode": "advanced",
        })
        assert fake.search_calls[0]["source"] == "report"
        assert fake.search_calls[0]["count"] == 10
        assert fake.search_calls[0]["time_range"] == "past 2 weeks"
        assert fake.search_calls[0]["search_mode"] == "advanced"

    def test_billions_api_error_returns_placeholder(self):
        fake = _FakeClient(
            _SEARCH_OK,
            error=BillionsApiError("亿信 API 错误：HTTP 429", code="rate limit", status_code=429),
        )
        tool = _make(make_billions_search_tool, _client=fake)
        text = tool.invoke({"query": "q"})
        assert text.startswith("（亿信检索失败：")  # 不 raise（断言本身已隐含）
        assert "429" in text

    def test_generic_exception_returns_placeholder(self):
        # 非 BillionsApiError 的意外异常同样降级（不 raise 打断 agent 流程）
        fake = _FakeClient(_SEARCH_OK, error=RuntimeError("网络中断"))
        tool = _make(make_billions_search_tool, _client=fake)
        assert "网络中断" in tool.invoke({"query": "q"})

    def test_empty_results_returns_placeholder(self):
        fake = _FakeClient({"success": True, "result": []})
        tool = _make(make_billions_search_tool, _client=fake)
        assert tool.invoke({"query": "q"}) == "（亿信检索失败：无返回结果）"

    def test_dirty_entries_skipped(self):
        # 无标题且无链接的脏条目跳过；有链接条目不丢弃（字段缺失容错）
        fake = _FakeClient({
            "success": True,
            "result": [{"content": [{}, {"link": "https://example.com/x"}]}],
        })
        tool = _make(make_billions_search_tool, _client=fake)
        assert "- https://example.com/x" in tool.invoke({"query": "q"})

    def test_call_limit_enforced(self):
        # AC5：超过 _max_calls 后返回占位提示，不再发真实请求
        fake = _FakeClient(_SEARCH_OK)
        tool = _make(make_billions_search_tool, _client=fake, _max_calls=2)
        assert "已达本次运行检索上限" not in tool.invoke({"query": "q1"})
        assert "已达本次运行检索上限" not in tool.invoke({"query": "q2"})
        text = tool.invoke({"query": "q3"})
        assert "已达本次运行检索上限（2 次）" in text
        assert "请聚焦最关键的问题再检索" in text
        assert len(fake.search_calls) == 2  # 第 3 次未发真实请求

    def test_max_calls_env_override(self):
        fake = _FakeClient(_SEARCH_OK)
        tool = _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_SEARCH_MAX_CALLS": "4"},
            lambda: make_billions_search_tool(_client=fake),
        )
        for i in range(4):
            tool.invoke({"query": f"q{i}"})
        assert "（4 次）" in tool.invoke({"query": "q4"})
        assert len(fake.search_calls) == 4

    def test_tool_shape_bindable(self):
        tool = _make(make_billions_search_tool, _client=_FakeClient(_SEARCH_OK))
        assert tool.name == "billions_search"
        schema = tool.args_schema.model_json_schema()
        assert "query" in schema["required"]
        props = schema["properties"]
        assert "source" in props and "count" in props
        assert "time_range" in props and "search_mode" in props


class TestMakeBillionsTwitterTool:

    def test_no_key_returns_none(self):
        assert _with_env({"BILLIONS_API_KEY": None}, make_billions_twitter_tool) is None

    def test_capability_switch_disables(self):
        assert _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_TWITTER_DISABLED": "1"},
            make_billions_twitter_tool,
        ) is None

    def test_success_returns_markdown_list(self):
        fake = _FakeClient(twitter_data=_TWITTER_OK)
        tool = _make(make_billions_twitter_tool, _client=fake)
        text = tool.invoke({"query": "紫金矿业"})
        assert "【亿信推特结果】" in text
        assert "- @stockwatcher — 12345 次浏览 — 2026-08-08 — 紫金矿业今日大涨 5%，突破前高 [https://x.com/stockwatcher/status/1]" in text
        # 无正文条目跳过；客户端收到默认参数
        assert "无正文的条目" not in text
        assert fake.twitter_calls[0] == {"query": "紫金矿业", "search_mode": "fast", "count": 5}

    def test_username_fallback_from_title(self):
        # extra.username 缺失 → 取 title 的 "@user" 前缀兜底
        fake = _FakeClient(twitter_data={
            "success": True,
            "result": [{"content": [
                {"title": "@someone: 利好", "snippet": "正文", "date": "2026-08-01"},
            ]}],
        })
        tool = _make(make_billions_twitter_tool, _client=fake)
        assert "@someone" in tool.invoke({"query": "q"})

    def test_billions_api_error_returns_placeholder(self):
        fake = _FakeClient(
            _TWITTER_OK,
            error=BillionsApiError("亿信 API 业务失败：upstream timeout", code="timeout", status_code=200),
        )
        tool = _make(make_billions_twitter_tool, _client=fake)
        assert tool.invoke({"query": "q"}).startswith("（亿信推特检索失败：")

    def test_empty_results_returns_placeholder(self):
        fake = _FakeClient(twitter_data={"success": True, "result": []})
        tool = _make(make_billions_twitter_tool, _client=fake)
        assert tool.invoke({"query": "q"}) == "（亿信推特检索失败：无返回结果）"

    def test_call_limit_enforced(self):
        fake = _FakeClient(twitter_data=_TWITTER_OK)
        tool = _make(make_billions_twitter_tool, _client=fake, _max_calls=2)
        tool.invoke({"query": "q1"})
        tool.invoke({"query": "q2"})
        assert "已达本次运行推特检索上限（2 次）" in tool.invoke({"query": "q3"})
        assert len(fake.twitter_calls) == 2

    def test_max_calls_env_override(self):
        fake = _FakeClient(twitter_data=_TWITTER_OK)
        tool = _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_TWITTER_MAX_CALLS": "1"},
            lambda: make_billions_twitter_tool(_client=fake),
        )
        tool.invoke({"query": "q1"})
        assert "（1 次）" in tool.invoke({"query": "q2"})
        assert len(fake.twitter_calls) == 1

    def test_tool_shape_bindable(self):
        tool = _make(make_billions_twitter_tool, _client=_FakeClient(twitter_data=_TWITTER_OK))
        assert tool.name == "billions_twitter"
        schema = tool.args_schema.model_json_schema()
        assert "query" in schema["required"]
        assert "count" in schema["properties"] and "search_mode" in schema["properties"]


class TestMakeBillionsFetchTool:

    def test_no_key_returns_none(self):
        assert _with_env({"BILLIONS_API_KEY": None}, make_billions_fetch_tool) is None

    def test_capability_switch_disables(self):
        assert _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_FETCH_DISABLED": "1"},
            make_billions_fetch_tool,
        ) is None

    def test_success_returns_title_and_content(self):
        fake = _FakeClient(fetch_data=_FETCH_OK)
        tool = _make(make_billions_fetch_tool, _client=fake)
        text = tool.invoke({"doc_id": "ANN20260725001"})
        assert "【亿信网页全文】紫金矿业集团股份有限公司2026年半年度报告" in text
        assert "| 营业收入 | 1500亿 |" in text
        # doc_id 原样透传（url 与 doc_id 二选一，互斥语义在描述中说明）
        assert fake.fetch_calls[0] == {"url": None, "doc_id": "ANN20260725001"}

    def test_url_forwarded(self):
        fake = _FakeClient(fetch_data=_FETCH_OK)
        tool = _make(make_billions_fetch_tool, _client=fake)
        tool.invoke({"url": "https://example.com/news/1"})
        assert fake.fetch_calls[0] == {"url": "https://example.com/news/1", "doc_id": None}

    def test_long_content_truncated(self):
        fake = _FakeClient(fetch_data={
            "success": True,
            "title": "长文",
            "content": "段落" * 2000,  # 6000 字符 > 3000 截断阈值
        })
        tool = _make(make_billions_fetch_tool, _client=fake)
        text = tool.invoke({"url": "https://example.com/long"})
        assert "已截断至前 3000 字符" in text
        assert len(text) < 3200

    def test_billions_api_error_returns_placeholder(self):
        fake = _FakeClient(
            _FETCH_OK,
            error=BillionsApiError("亿信 API 错误：HTTP 403", code="SOURCE_NOT_LICENSED", status_code=403),
        )
        tool = _make(make_billions_fetch_tool, _client=fake)
        text = tool.invoke({"doc_id": "report-1"})
        assert text.startswith("（亿信全文抓取失败：")
        assert "403" in text  # 归一化错误信息透出（doc_id 未授权等可诊断）

    def test_no_content_returns_placeholder(self):
        fake = _FakeClient({"success": True, "title": "无正文"})
        tool = _make(make_billions_fetch_tool, _client=fake)
        assert tool.invoke({"url": "https://example.com/empty"}) == "（亿信全文抓取失败：无返回内容）"

    def test_call_limit_enforced(self):
        fake = _FakeClient(fetch_data=_FETCH_OK)
        tool = _make(make_billions_fetch_tool, _client=fake, _max_calls=3)
        for i in range(3):
            tool.invoke({"url": f"https://example.com/{i}"})
        assert "已达本次运行全文抓取上限（3 次）" in tool.invoke({"url": "https://example.com/3"})
        assert len(fake.fetch_calls) == 3

    def test_max_calls_env_override(self):
        fake = _FakeClient(fetch_data=_FETCH_OK)
        tool = _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_FETCH_MAX_CALLS": "2"},
            lambda: make_billions_fetch_tool(_client=fake),
        )
        tool.invoke({"url": "https://example.com/1"})
        tool.invoke({"url": "https://example.com/2"})
        assert "（2 次）" in tool.invoke({"url": "https://example.com/3"})
        assert len(fake.fetch_calls) == 2

    def test_tool_shape_bindable(self):
        tool = _make(make_billions_fetch_tool, _client=_FakeClient(fetch_data=_FETCH_OK))
        assert tool.name == "billions_fetch"
        schema = tool.args_schema.model_json_schema()
        props = schema["properties"]
        assert "url" in props and "doc_id" in props
        # url/doc_id 均可选（互斥语义在描述中，不在 schema 强制）
        assert "url" not in schema.get("required", []) and "doc_id" not in schema.get("required", [])


# --- committee 绑定（开关组合下 tools 列表内容断言） -------------------------

_BOUND = {"calls": 0, "tools": None}


class _RecordingLlm(FakeListChatModel):
    """bind_tools 记录到模块级 holder（pydantic 模型不宜加实例属性）——
    断言 committee 按开关组合绑定工具（house style 注入，无 mock 框架）。

    agent 构造器对非 None 的 tools 调 ``llm.bind_tools(tools)``（工具角色
    三处），记录最后一次绑定的工具名列表即可（三处列表相同）。
    """

    def bind_tools(self, tools, **kwargs):
        _BOUND["calls"] += 1
        _BOUND["tools"] = [t.name for t in tools]
        return self


def _bound_tool_names(env: dict):
    """构造 committee（注入 _RecordingLlm）并返回绑定工具名列表（None = 未绑定）。

    两个隔离点（跨运行/跨文件确定性）：
    1. 未提及的开关键一律强制未设置（WEB_SEARCH_DISABLED 默认 None）——
       test_web_search 曾实测残留 WEB_SEARCH_DISABLED=anything（其 restore
       对初始未设置的 key 不 pop，属既有泄漏），不显式控制会翻转绑定断言；
    2. make_investment_committee 内部调用 load_dotenv()（不覆盖已设 env，
       但会把 .env 里 os.environ 缺的 key 填进来，如 TDX_API_KEY /
       TDX_MCP_DISABLED / 开发者后续添加的 BILLIONS_API_KEY）——完整快照
       恢复整个 os.environ，防 load_dotenv 副作用泄漏给后续测试
       （test_committee_enrichment 依赖干净 env，实测被 TDX_MCP_DISABLED
       翻转降级分支）。
    """
    _BOUND["calls"] = 0
    _BOUND["tools"] = None
    full_env = {"WEB_SEARCH_DISABLED": None, **env}
    if full_env.get("BILLIONS_API_KEY") is None:
        # 永不为缺席态：显式置空串（假值）——make_investment_committee 内部
        # load_dotenv() 会把 .env 里 os.environ 缺失的 BILLIONS_API_KEY 填进来，
        # 开发者按指引配置 .env 后 "无 key" 绑定断言会被翻转
        full_env["BILLIONS_API_KEY"] = ""
    committee = InvestmentCommittee()
    saved_env = os.environ.copy()
    try:
        _with_env(full_env, lambda: committee.make_investment_committee(
            {"configurable": {"thread_id": "1"}}, _llm=_RecordingLlm(responses=[])
        ))
    finally:
        os.environ.clear()
        os.environ.update(saved_env)
    return _BOUND["tools"]


class TestCommitteeToolsBinding:

    def test_no_billions_key_binds_web_search_only(self):
        # AC1：未配置 BILLIONS_API_KEY → 亿信工具不绑定，tools 与今日一致
        assert _bound_tool_names({"BILLIONS_API_KEY": None}) == ["web_search"]

    def test_key_enables_all_billions_tools(self):
        assert _bound_tool_names({"BILLIONS_API_KEY": "k"}) == [
            "web_search", "billions_search", "billions_twitter", "billions_fetch",
        ]

    def test_capability_switch_removes_only_that_tool(self):
        # AC3：SEARCH 单独关 → 仅 billions_search 不绑定，其余不受影响
        assert _bound_tool_names(
            {"BILLIONS_API_KEY": "k", "BILLIONS_SEARCH_DISABLED": "1"}
        ) == ["web_search", "billions_twitter", "billions_fetch"]

    def test_master_switch_disables_all_billions_tools(self):
        assert _bound_tool_names(
            {"BILLIONS_API_KEY": "k", "BILLIONS_DISABLED": "true"}
        ) == ["web_search"]

    def test_web_search_disabled_billions_still_bound(self):
        # 两个开关互相独立：WEB_SEARCH_DISABLED 只摘 web_search
        assert _bound_tool_names(
            {"BILLIONS_API_KEY": "k", "WEB_SEARCH_DISABLED": "1"}
        ) == ["billions_search", "billions_twitter", "billions_fetch"]

    def test_all_disabled_binds_nothing(self):
        # AC1：全关 → tools=None，agent 不 bind_tools（行为与今日一致）
        names = _bound_tool_names({"BILLIONS_API_KEY": None, "WEB_SEARCH_DISABLED": "1"})
        assert names is None
        assert _BOUND["calls"] == 0  # 无任何 bind_tools 调用
