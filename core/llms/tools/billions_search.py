"""亿信 search 检索工具（08-08-billions-api-integration，Step 3）。

多头/空头交易员与投资经理经 LLM 工具调用（bind_tools，节点内工具循环——
见 core/llms/tool_loop.py）按需检索公告/研报/新闻/专家观点，结果以
ToolMessage 消息回流参与生成。供应商：亿信 Fin 开放平台 `/api/v2/search`
（X-API-KEY 鉴权，官方 schema 见 research/billions-api.md；source 枚举
web/academic/image/video/announcement/report/expert）。

约定（对齐 error-handling spec 降级风格，与 web_search 同形状）：
- 开关关（utils.billions_config.billions_enabled("SEARCH") False）→
  工厂返回 None——图装配不绑定，现有 agent 流程零行为变化（R2/AC1）
- 调用硬上限（R2/AC5）：闭包计数器，单次 run 内超过
  ``billions_max_calls("SEARCH", 3)``（env `BILLIONS_SEARCH_MAX_CALLS`
  可覆盖）→ 返回占位提示，**不再发真实请求**
- 查询失败 / 无返回结果 → logger.warning + 占位文本，**不 raise**（模型
  拿到占位 ToolMessage 继续生成，图不中断）
- 结果 → 带来源的 Markdown 列表（title/link/date/institution；公告额外
  带 doc_id 供 billions_fetch 精读全文）
- 客户端在函数内懒加载（house style：无 key 环境不构造 client、不触发
  httpx 重依赖）
"""

from __future__ import annotations

from typing import Literal

from langchain_core.tools import BaseTool, tool

from core.llms.tools._capped import capped_call
from core.llms.tools._items import collect_content_items
from utils.billions_config import billions_enabled, billions_max_calls


def _format_item(item: dict) -> str | None:
    """单条检索结果 → Markdown 行；无有效字段（无标题且无链接）→ None。

    字段契约（research）：title/link/snippet(≤500)/date(YYYY-MM-DD 可空)/
    extra{institution(仅 report)/doc_id(仅 announcement)}；字段允许缺失，
    调用方容错（脏条目跳过）。
    """
    title = item.get("title", "")
    link = item.get("link", "")
    if not (title or link):
        return None
    extra = item.get("extra") if isinstance(item.get("extra"), dict) else {}
    parts = []
    if title and link:
        parts.append(f"[{title}]({link})")
    elif link:
        parts.append(link)
    else:
        parts.append(title)
    if item.get("date"):
        parts.append(str(item["date"]))
    if extra.get("institution"):  # 研报机构名（上游无作者字段，research 语义）
        parts.append(str(extra["institution"]))
    if extra.get("doc_id"):  # 公告全文 id——billions_fetch 精读入口
        parts.append(f"doc_id: {extra['doc_id']}")
    line = " — ".join(parts)
    if item.get("snippet"):
        line += f"({item['snippet']})"
    return "- " + line


def _summarize_results(data: dict) -> str:
    """search 响应 → 带标题的 Markdown 列表；无有效条目 → 占位文本（不 raise）。

    响应契约（research）：``result[].content[]`` 为条目列表（status 失败
    已被 client 归一化为 BillionsApiError，此处 result 恒为成功条目）。
    """
    lines = []
    for item in collect_content_items(data):
        line = _format_item(item)
        if line is not None:
            lines.append(line)
    if not lines:
        return "（亿信检索失败：无返回结果）"
    return "【亿信检索结果】\n" + "\n".join(lines)


def make_billions_search_tool(_client=None, _max_calls: int | None = None) -> BaseTool | None:
    """构造亿信 search 检索工具；开关关 → None（图装配跳过绑定，AC1/AC3）。

    :param _client: 测试注入点（house style 无 mock 框架）——带
        ``search(query, source, search_mode, count, time_range) -> dict``
        语义的对象（BillionsClient 形状）；缺省 None → 首次调用时懒加载
        真实现
    :param _max_calls: 单次 run 调用硬上限（测试注入）；缺省 None →
        ``billions_max_calls("SEARCH", 3)``（env `BILLIONS_SEARCH_MAX_CALLS`
        可覆盖）
    :return: 名 "billions_search" 的 StructuredTool；开关关 → None
    """
    if not billions_enabled("SEARCH"):
        return None
    max_calls = _max_calls if _max_calls is not None else billions_max_calls("SEARCH", 3)
    client = _client
    calls = [0]  # 闭包计数器（capped_call 内可变，跨调用累计）

    def _get_client():
        nonlocal client
        if client is None:
            from data_source.chinese_mainland.billions.client import BillionsClient

            client = BillionsClient()
        return client

    @tool("billions_search")
    def billions_search(
        query: str,
        source: Literal["web", "academic", "image", "video", "announcement", "report", "expert"] = "web",
        count: int = 5,
        time_range: str | None = None,
        search_mode: Literal["fast", "advanced", "expert"] = "fast",
    ) -> str:
        """亿信检索（公告/研报/新闻/专家观点等），可验证行业与市场的最新论据。

        source 语义：web 新闻网页（默认）、announcement 上市公司公告（结果带
        doc_id，可配合 billions_fetch 精读全文）、report 券商研报（结果带机构
        名）、expert 专家观点、academic 学术、image/video 图片视频。time_range
        限定时间范围（如 "past 3 months"、"past 2 weeks"）。search_mode 深度：
        fast 快（默认）、advanced / expert 更慢但结果更全。单次 run 内调用有
        次数上限，超限返回占位提示。查询失败时返回占位文本。"""
        return capped_call(
            calls, max_calls,
            cap_text="（已达本次运行检索上限（{max_calls} 次），请聚焦最关键的问题再检索）",
            fail_fmt="（亿信检索失败：{exc}）",
            warn_msg="亿信 search 检索失败: {}",
            fn=lambda: _summarize_results(_get_client().search(
                query, source=source, search_mode=search_mode, count=count, time_range=time_range
            )),
        )

    return billions_search
