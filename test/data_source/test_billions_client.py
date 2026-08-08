"""BillionsClient 单测（离线，注入 fake httpx 响应，不碰网络）。

house style 无 mock 框架——`_FakeHttp` 记录调用并返回预置响应/抛
预置异常（`_http` 注入点），断言请求构造（method/url/headers/body/
timeout）与错误归一化（BillionsApiError 的 code/status_code/message）。

覆盖（implement.md Step 1 清单）：
- 4 端点请求构造 + 超时档位映射（fin_db 120 / search·twitter 按档位
  +10s / fetch 90）+ 显式 timeout 优先 + 可选字段省略
- 字段提取 golden：响应 JSON dict 原样返回（薄包装，字段提取在调用方）
- 错误归一化：HTTP 401/429/504、非 JSON 响应体、HTTP 200 +
  success:false（上游超时语义）、网络异常 → BillionsApiError
- key 注入语义：`_key` 覆盖 env；无 key 时不带 X-API-KEY 头
"""

import os

import httpx
import pytest

from data_source.chinese_mainland.billions.client import BASE, BillionsApiError, BillionsClient

# 官方文档示例（research/billions-api.md）中的 fin-db 请求
_QUERY = "紫金矿业2024年12月20日当日的最高价(元)是多少？"


class _FakeResponse:
    """预置响应：status_code + JSON payload。"""

    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class _BrokenJsonResponse:
    """非 JSON 响应体（如网关 502 的 HTML 页）。"""

    status_code = 502

    def json(self):
        raise ValueError("no json body")


class _FakeHttp:
    """记录每次 post 调用；按预置返回响应或抛异常（house style 注入）。

    断言不写在 fake 里（失败会先被 client 归一化为 BillionsApiError，
    测试误报）——fake 只记录，断言在测试侧读 ``calls``。
    """

    def __init__(self, response=None, error=None):
        self._response = response
        self._error = error
        self.calls = []

    def post(self, url, headers=None, json=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        if self._error is not None:
            raise self._error
        return self._response


_OK = {"success": True, "result": []}


def _client(http=None, key="test-key"):
    return BillionsClient(_http=http, _key=key)


class TestFinDbEndpoint:

    def test_request_construction(self):
        http = _FakeHttp(_FakeResponse(_OK))
        _client(http).fin_db(_QUERY, data_sources=["A股财务行情数据库"])
        call = http.calls[0]
        assert call["url"] == BASE + "/v1/fin_db"
        assert call["headers"]["X-API-KEY"] == "test-key"
        assert call["json"] == {"query": _QUERY, "data_sources": ["A股财务行情数据库"]}
        assert call["timeout"] == 120

    def test_data_sources_default_auto(self):
        http = _FakeHttp(_FakeResponse(_OK))
        _client(http).fin_db("宁德时代2024年营收")
        assert http.calls[0]["json"] == {"query": "宁德时代2024年营收", "data_sources": "auto"}

    def test_field_extraction_golden(self):
        # 薄包装：响应 JSON dict 原样返回（result[].content 为 Markdown）
        payload = {
            "success": True,
            "result": [
                {
                    "query": _QUERY,
                    "content": "| 项目 | 值 |\n|---|---|\n| 最高价 | 18.88 |",
                    "status": "ok",
                    "source": "A股财务行情数据库",
                }
            ],
        }
        data = _client(_FakeHttp(_FakeResponse(payload))).fin_db(_QUERY)
        assert data is payload
        assert data["result"][0]["content"].startswith("| 项目")
        assert data["result"][0]["status"] == "ok"


class TestSearchEndpoint:

    def test_request_fast_default(self):
        http = _FakeHttp(_FakeResponse(_OK))
        _client(http).search("宁德时代 固态电池 进展")
        call = http.calls[0]
        assert call["url"] == BASE + "/v2/search"
        assert call["json"] == {
            "query": "宁德时代 固态电池 进展",
            "source": "web",
            "search_mode": "fast",
            "count": 10,
        }
        assert "time_range" not in call["json"]
        assert call["timeout"] == 25  # fast 15 + 10s 余量

    def test_timeout_by_search_mode(self):
        for mode, expected in (("fast", 25), ("advanced", 70), ("expert", 120)):
            http = _FakeHttp(_FakeResponse(_OK))
            _client(http).search("q", search_mode=mode)
            assert http.calls[0]["timeout"] == expected

    def test_explicit_timeout_wins(self):
        http = _FakeHttp(_FakeResponse(_OK))
        _client(http).search("q", search_mode="fast", timeout=10)
        assert http.calls[0]["timeout"] == 10

    def test_source_and_time_range_passed(self):
        http = _FakeHttp(_FakeResponse(_OK))
        _client(http).search("q", source="announcement", count=5, time_range="past 3 months")
        call = http.calls[0]
        assert call["json"]["source"] == "announcement"
        assert call["json"]["count"] == 5
        assert call["json"]["time_range"] == "past 3 months"

    def test_field_extraction_golden(self):
        # result[0].content[] 条目：title/link/snippet/date/extra（institution）
        payload = {
            "success": True,
            "result": [
                {
                    "content": [
                        {
                            "title": "宁德时代发布固态电池进展",
                            "link": "https://example.com/a",
                            "snippet": "公司称2027年量产",
                            "date": "2026-08-01",
                            "extra": {"institution": "国泰君安"},
                        }
                    ]
                }
            ],
        }
        data = _client(_FakeHttp(_FakeResponse(payload))).search("q", source="report")
        item = data["result"][0]["content"][0]
        assert item["title"] == "宁德时代发布固态电池进展"
        assert item["extra"]["institution"] == "国泰君安"


class TestTwitterEndpoint:

    def test_request_construction(self):
        http = _FakeHttp(_FakeResponse(_OK))
        _client(http).twitter_search("宁德时代", search_mode="advanced", count=5)
        call = http.calls[0]
        assert call["url"] == BASE + "/v2/twitter/search"
        assert call["json"] == {"query": "宁德时代", "search_mode": "advanced", "count": 5}
        assert call["timeout"] == 70  # advanced 60 + 10s 余量

    def test_timeout_by_mode(self):
        for mode, expected in (("fast", 25), ("advanced", 70), ("expert", 120)):
            http = _FakeHttp(_FakeResponse(_OK))
            _client(http).twitter_search("q", search_mode=mode)
            assert http.calls[0]["timeout"] == expected

    def test_field_extraction_golden(self):
        payload = {
            "success": True,
            "result": [
                {
                    "content": [
                        {
                            "title": "@user: 宁德时代固态电池进展",
                            "link": "https://x.com/user/status/1",
                            "snippet": "公司称2027年量产",
                            "date": "2026-08-01 10:00:00",
                            "extra": {"username": "user", "view_count": 1234},
                        }
                    ]
                }
            ],
        }
        data = _client(_FakeHttp(_FakeResponse(payload))).twitter_search("宁德时代")
        item = data["result"][0]["content"][0]
        assert item["title"].startswith("@user:")
        assert item["extra"]["view_count"] == 1234


class TestFetchEndpoint:

    def test_fetch_by_url(self):
        http = _FakeHttp(_FakeResponse(_OK))
        _client(http).fetch(url="https://example.com/page")
        call = http.calls[0]
        assert call["url"] == BASE + "/v2/fetch"
        assert call["json"] == {"url": "https://example.com/page"}
        assert call["timeout"] == 90

    def test_fetch_by_doc_id_with_page_max_chars(self):
        http = _FakeHttp(_FakeResponse(_OK))
        _client(http).fetch(doc_id="ann_123", page=2, max_chars=8000)
        call = http.calls[0]
        assert call["json"] == {"doc_id": "ann_123", "page": 2, "max_chars": 8000}
        assert "url" not in call["json"]

    def test_none_fields_omitted(self):
        http = _FakeHttp(_FakeResponse(_OK))
        _client(http).fetch(url="https://example.com", page=None, max_chars=None)
        assert http.calls[0]["json"] == {"url": "https://example.com"}

    def test_field_extraction_golden(self):
        payload = {
            "success": True,
            "type": "document",
            "id": "ann_123",
            "source": "announcement",
            "title": "某公司2026年半年度报告",
            "content": "[Page 1/2]\n\n正文…",
            "total_pages": 2,
            "total_chars": 8000,
            "truncated": False,
        }
        data = _client(_FakeHttp(_FakeResponse(payload))).fetch(doc_id="ann_123")
        assert data["source"] == "announcement"
        assert data["content"].startswith("[Page 1/2]")


class TestErrorNormalization:

    def test_http_401_raises_with_code(self):
        http = _FakeHttp(_FakeResponse({"success": False, "error": "invalid api key"}, status_code=401))
        with pytest.raises(BillionsApiError) as ei:
            _client(http).search("q")
        assert ei.value.status_code == 401
        assert ei.value.code == "invalid api key"
        assert "invalid api key" in ei.value.message

    def test_http_429_raises(self):
        # 配额超限（429 次日恢复）——归一化不重试
        http = _FakeHttp(_FakeResponse({"success": False, "error": "rate limit exceeded"}, status_code=429))
        with pytest.raises(BillionsApiError) as ei:
            _client(http).twitter_search("q")
        assert ei.value.status_code == 429
        assert ei.value.code == "rate limit exceeded"

    def test_http_504_raises(self):
        # 后端超时（可重试语义留给调用方，client 不做重试）
        http = _FakeHttp(_FakeResponse({"success": False, "error": "upstream timeout"}, status_code=504))
        with pytest.raises(BillionsApiError) as ei:
            _client(http).search("q")
        assert ei.value.status_code == 504

    def test_http_error_without_json_body(self):
        # 网关 502 无 JSON 体 → 归一化不因解析失败二次炸
        http = _FakeHttp(_BrokenJsonResponse())
        with pytest.raises(BillionsApiError) as ei:
            _client(http).search("q")
        assert ei.value.status_code == 502
        assert ei.value.code is None

    def test_success_false_on_http_200_raises(self):
        # HTTP 200 仅表示已处理；success:false = 业务失败（上游超时语义）
        http = _FakeHttp(_FakeResponse({"success": False, "error": "upstream timeout"}))
        with pytest.raises(BillionsApiError) as ei:
            _client(http).twitter_search("q")
        assert ei.value.status_code == 200
        assert ei.value.code == "upstream timeout"

    def test_success_false_without_error_field(self):
        http = _FakeHttp(_FakeResponse({"success": False}))
        with pytest.raises(BillionsApiError) as ei:
            _client(http).search("q")
        assert ei.value.code is None
        assert "success=false" in ei.value.message

    def test_network_error_raises(self):
        # 网络异常（连接失败）→ BillionsApiError，无 HTTP 状态码
        http = _FakeHttp(error=httpx.ConnectError("connection refused"))
        with pytest.raises(BillionsApiError) as ei:
            _client(http).search("q")
        assert ei.value.status_code is None
        assert "connection refused" in ei.value.message

    def test_error_is_exception_subclass(self):
        assert issubclass(BillionsApiError, Exception)


class TestKeyHandling:

    def test_injected_key_used(self):
        http = _FakeHttp(_FakeResponse(_OK))
        _client(http, key="custom-key").search("q")
        assert http.calls[0]["headers"]["X-API-KEY"] == "custom-key"

    def test_env_key_when_not_injected(self):
        # `_key` 缺省 → 从 BILLIONS_API_KEY 环境变量读（save/restore 防污染）
        saved = os.environ.pop("BILLIONS_API_KEY", None)
        try:
            os.environ["BILLIONS_API_KEY"] = "env-key"
            http = _FakeHttp(_FakeResponse(_OK))
            BillionsClient(_http=http).search("q")
            assert http.calls[0]["headers"]["X-API-KEY"] == "env-key"
        finally:
            if saved is None:
                os.environ.pop("BILLIONS_API_KEY", None)
            else:
                os.environ["BILLIONS_API_KEY"] = saved

    def test_no_key_omits_header(self):
        saved = os.environ.pop("BILLIONS_API_KEY", None)
        try:
            http = _FakeHttp(_FakeResponse(_OK))
            _client(http, key=None).search("q")
            assert "X-API-KEY" not in http.calls[0]["headers"]
        finally:
            if saved is None:
                os.environ.pop("BILLIONS_API_KEY", None)
            else:
                os.environ["BILLIONS_API_KEY"] = saved

    def test_client_lazy_construction(self):
        # 未注入 _http → 首次请求才自建 httpx.Client（懒加载，无模块级副作用）
        client = BillionsClient(_key="k")
        assert client._client is None
        assert client._http is None
