"""亿信 Fin 开放平台客户端（08-08-billions-api-integration，Step 1）。

4 端点薄包装（官方 schema 见 .trellis/tasks/08-08-billions-api-integration/
research/billions-api.md）：fin-db（v1 自然语言金融问数）、search（v2，
web/academic/image/video/announcement/report/expert）、twitter（v2/
twitter/search）、fetch（v2，url 或公告 doc_id）。全部 POST +
`X-API-KEY` 头，BASE `https://openapi.billionsintelligence.com/api`。

约定（对齐 data_source 薄包装 + error-handling 降级约定）：
- 返回响应 JSON dict 原样（字段提取由调用方做），**不做重试**
- 失败归一化：HTTP 非 2xx / 响应 `success:false`（HTTP 200 仅表示已
  处理，业务成败看 success）/ 网络异常 → 抛 `BillionsApiError`（带
  code/status_code/message），由调用方降级（工具层返回占位文本，
  不阻断 agent 流程）
- 超时参数化：fin_db 120s；search/twitter 按档位（服务端等待 fast 15 /
  advanced 60 / expert 110）+10s 余量；fetch 90s；显式 timeout 参数优先
- 密钥：`os.getenv("BILLIONS_API_KEY")`（`_key` 可注入覆盖），不写日志、
  不入库（R6 密钥纪律）
"""

from __future__ import annotations

import os

BASE = "https://openapi.billionsintelligence.com/api"

_FIN_DB_PATH = "/v1/fin_db"
_SEARCH_PATH = "/v2/search"
_TWITTER_PATH = "/v2/twitter/search"
_FETCH_PATH = "/v2/fetch"

# 客户端超时（秒）按档位：服务端等待（fast 15 / advanced 60 / expert 110）
# + 10s 余量（research 建议慢档位客户端超时 ≥120s）。twitter 三档同构。
_MODE_TIMEOUTS = {"fast": 25, "advanced": 70, "expert": 120}

FIN_DB_TIMEOUT = 120
FETCH_TIMEOUT = 90


class BillionsApiError(Exception):
    """亿信 API 调用失败（归一化错误，client 内唯一异常）。

    :param message: 人类可读错误信息
    :param code: 上游返回的业务错误码/错误信息（body 的 error 或
        fetch 的 code 枚举，如 INVALID_ARGUMENT/SOURCE_NOT_LICENSED），
        无 → None
    :param status_code: HTTP 状态码（网络异常无响应 → None）
    """

    def __init__(self, message: str, code: str | None = None, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


class BillionsClient:
    """亿信 4 端点薄包装（class per source、method per endpoint 形状）。

    ``_http`` 为测试注入点（house style 无 mock 框架）：传 httpx.Client
    或任何带 ``post(url, headers, json, timeout) -> {status_code, json()}``
    语义的对象；不传则懒加载自建 ``httpx.Client``（惰性 import，模块级
    无重依赖副作用）。``_key`` 注入覆盖 `BILLIONS_API_KEY` 环境变量。
    """

    def __init__(self, _http=None, _key: str | None = None):
        self._http = _http
        self._key = _key if _key is not None else os.getenv("BILLIONS_API_KEY")
        self._client = None  # 懒加载：首次请求才自建

    def _http_client(self):
        if self._http is not None:
            return self._http
        if self._client is None:
            import httpx  # 惰性 import（house style：避免模块级重依赖）

            self._client = httpx.Client()
        return self._client

    def _post(self, path: str, payload: dict, timeout: float) -> dict:
        """POST JSON 并归一化响应；失败 → 抛 BillionsApiError（不重试）。

        网络/连接/超时异常 → BillionsApiError(status_code=None)；
        HTTP 非 2xx → 取 body error/code 作 code；2xx 但 `success:false`
        （上游超时等业务失败语义）→ 同样归一化。
        """
        headers = {"Content-Type": "application/json"}
        if self._key:
            headers["X-API-KEY"] = self._key
        try:
            resp = self._http_client().post(
                BASE + path, headers=headers, json=payload, timeout=timeout
            )
        except Exception as exc:
            # 网络/连接/超时异常 → 归一化（client 不做重试，调用方降级）
            raise BillionsApiError(f"亿信 API 请求失败：{exc}") from exc
        try:
            data = resp.json()
        except ValueError:
            data = None
        if resp.status_code < 200 or resp.status_code >= 300:
            code = None
            if isinstance(data, dict):
                code = data.get("error") or data.get("code")
            raise BillionsApiError(
                f"亿信 API 错误：HTTP {resp.status_code}"
                + (f"（{code}）" if code else ""),
                code=code,
                status_code=resp.status_code,
            )
        if not isinstance(data, dict) or data.get("success") is False:
            # HTTP 200 仅表示已处理；业务成败看 success（twitter 上游超时
            # 即 HTTP 200 + success:false，research 语义）
            error = data.get("error") if isinstance(data, dict) else None
            raise BillionsApiError(
                f"亿信 API 业务失败：{error or 'success=false'}",
                code=error,
                status_code=resp.status_code,
            )
        return data

    def fin_db(self, query: str, data_sources: str | list[str] | None = None) -> dict:
        """fin-db 自然语言金融问数（v1，auto 路由）。

        :param query: 自然语言问题（1-2000 字符），如
            "紫金矿业2024年12月20日当日的最高价(元)是多少？"
        :param data_sources: 默认 "auto"；枚举 `A股财务行情数据库` /
            `海外财务行情数据库` / `宏观行业数据库`
        :return: 响应 JSON dict（``result[].content`` 为 Markdown 表格）
        :raises BillionsApiError: 失败归一化（调用方降级）
        """
        payload = {"query": query, "data_sources": data_sources or "auto"}
        return self._post(_FIN_DB_PATH, payload, timeout=FIN_DB_TIMEOUT)

    def search(
        self,
        query: str,
        source: str = "web",
        search_mode: str = "fast",
        count: int = 10,
        time_range: str | None = None,
        timeout: float | None = None,
    ) -> dict:
        """search 检索（v2；source 枚举 web/academic/image/video/
        announcement/report/expert）。

        :param search_mode: fast / advanced / expert（更慢档位后端等待更长）
        :param count: 1-50
        :param time_range: 如 "past 3 months"（缺省不传，结果量优先
            受 time_range 控制）
        :param timeout: 显式客户端超时（秒）优先；缺省按档位
            fast 25s / advanced 70s / expert 120s
        :return: 响应 JSON dict（``result[0].content[]`` 为
            title/link/snippet/date/extra 条目列表）
        :raises BillionsApiError: 失败归一化（调用方降级）
        """
        payload: dict = {
            "query": query,
            "source": source,
            "search_mode": search_mode,
            "count": count,
        }
        if time_range:
            payload["time_range"] = time_range
        if timeout is None:
            timeout = _MODE_TIMEOUTS.get(search_mode, _MODE_TIMEOUTS["fast"])
        return self._post(_SEARCH_PATH, payload, timeout=timeout)

    def twitter_search(
        self, query: str, search_mode: str = "fast", count: int = 10
    ) -> dict:
        """twitter 检索（v2/twitter/search，三档深度同 search）。

        :return: 响应 JSON dict（``result[0].content[]`` 为
            title("@user: " 前缀)/link/snippet/date/extra
            {username, view_count, ...} 条目列表）
        :raises BillionsApiError: 失败归一化（上游超时 → HTTP 200 +
            success:false，同样归一化）
        """
        payload = {"query": query, "search_mode": search_mode, "count": count}
        timeout = _MODE_TIMEOUTS.get(search_mode, _MODE_TIMEOUTS["fast"])
        return self._post(_TWITTER_PATH, payload, timeout=timeout)

    def fetch(
        self,
        url: str | None = None,
        doc_id: str | None = None,
        page: int | None = None,
        max_chars: int | None = None,
    ) -> dict:
        """fetch 网页全文 / 公告全文（v2；url 与 doc_id 互斥，二选一）。

        url 与 doc_id 都传/都不传 → 上游 422（INVALID_ARGUMENT），client
        不做本地校验（薄包装，归一化为 BillionsApiError）。
        已知限制：report/expert 的 doc_id 全文未开放（403
        SOURCE_NOT_LICENSED）；announcement 的 doc_id 全套餐可用。

        :param doc_id: search 结果 ``extra.doc_id``，原样传入
        :param page: ≥1，分页模式；超范围返回最后一页
        :param max_chars: 500-12000，默认 6000；显式传值进入分页模式
        :return: 响应 JSON dict（content 为 Markdown，分页前缀
            [Page N/M]；pages/total_pages/total_chars/truncated）
        :raises BillionsApiError: 失败归一化（调用方降级）
        """
        payload: dict = {}
        if url is not None:
            payload["url"] = url
        if doc_id is not None:
            payload["doc_id"] = doc_id
        if page is not None:
            payload["page"] = page
        if max_chars is not None:
            payload["max_chars"] = max_chars
        return self._post(_FETCH_PATH, payload, timeout=FETCH_TIMEOUT)
