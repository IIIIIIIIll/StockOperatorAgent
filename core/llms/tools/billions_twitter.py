"""亿信 twitter 检索工具（08-08-billions-api-integration，Step 3）。

多头/空头交易员与投资经理经 LLM 工具调用（bind_tools，节点内工具循环——
见 core/llms/tool_loop.py）按需检索 X/推特上的财经讨论与市场舆论，结果以
ToolMessage 消息回流参与生成。供应商：亿信 Fin 开放平台
`/api/v2/twitter/search`（官方 schema 见 research/billions-api.md）。

约定（对齐 error-handling spec 降级风格，与 web_search 同形状）：
- 开关关（utils.billions_config.billions_enabled("TWITTER") False）→
  工厂返回 None——图装配不绑定，现有 agent 流程零行为变化（R2/AC1）
- 调用硬上限（R2/AC5）：闭包计数器，单次 run 内超过
  ``billions_max_calls("TWITTER", 2)``（env `BILLIONS_TWITTER_MAX_CALLS`
  可覆盖）→ 返回占位提示，**不再发真实请求**
- 查询失败 / 无返回结果 → logger.warning + 占位文本，**不 raise**（模型
  拿到占位 ToolMessage 继续生成，图不中断）
- 结果 → 带来源的 Markdown 列表（@username/浏览数/日期/正文/链接）
- 客户端在函数内懒加载（house style：无 key 环境不构造 client、不触发
  httpx 重依赖）
"""

from __future__ import annotations

from typing import Literal

from langchain_core.tools import BaseTool, tool
from loguru import logger

from utils.billions_config import billions_enabled, billions_max_calls


def _format_tweet(item: dict) -> str | None:
    """单条推文 → Markdown 行；无正文 → None（跳过）。

    字段契约（research）：title("@user: 前缀")/link(x.com/...)/snippet
    (正文)/date(北京时间)/extra{username/view_count/post_id/...}；字段
    允许缺失，调用方容错。
    """
    snippet = item.get("snippet", "")
    if not snippet:
        return None
    extra = item.get("extra") if isinstance(item.get("extra"), dict) else {}
    username = extra.get("username")
    if not username:
        # title 形如 "@user: 正文预览"——取 @ 前缀兜底
        title = item.get("title", "")
        if title.startswith("@"):
            username = title.split(":", 1)[0]
    if username and not str(username).startswith("@"):
        username = "@" + str(username)
    parts = []
    if username:
        parts.append(str(username))
    if extra.get("view_count") is not None:
        parts.append(f"{extra['view_count']} 次浏览")
    if item.get("date"):
        parts.append(str(item["date"]))
    line = " — ".join(parts) + f" — {snippet}"
    if item.get("link"):
        line += f" [{item['link']}]"
    return "- " + line


def _summarize_tweets(data: dict) -> str:
    """twitter 响应 → 带标题的 Markdown 列表；无有效条目 → 占位文本。

    响应契约（research）：``result[].content[]`` 为推文条目列表（上游
    超时 → HTTP 200 + success:false，已被 client 归一化为 BillionsApiError，
    此处 result 恒为成功条目）。
    """
    lines = []
    for entry in data.get("result") or []:
        if not isinstance(entry, dict):
            continue
        content = entry.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            line = _format_tweet(item)
            if line is not None:
                lines.append(line)
    if not lines:
        return "（亿信推特检索失败：无返回结果）"
    return "【亿信推特结果】\n" + "\n".join(lines)


def make_billions_twitter_tool(_client=None, _max_calls: int | None = None) -> BaseTool | None:
    """构造亿信 twitter 检索工具；开关关 → None（图装配跳过绑定，AC1/AC3）。

    :param _client: 测试注入点（house style 无 mock 框架）——带
        ``twitter_search(query, search_mode, count) -> dict`` 语义的对象
        （BillionsClient 形状）；缺省 None → 首次调用时懒加载真实现
    :param _max_calls: 单次 run 调用硬上限（测试注入）；缺省 None →
        ``billions_max_calls("TWITTER", 2)``（env
        `BILLIONS_TWITTER_MAX_CALLS` 可覆盖）
    :return: 名 "billions_twitter" 的 StructuredTool；开关关 → None
    """
    if not billions_enabled("TWITTER"):
        return None
    max_calls = _max_calls if _max_calls is not None else billions_max_calls("TWITTER", 2)
    client = _client
    calls = 0

    def _get_client():
        nonlocal client
        if client is None:
            from data_source.chinese_mainland.billions.client import BillionsClient

            client = BillionsClient()
        return client

    @tool("billions_twitter")
    def billions_twitter(
        query: str,
        count: int = 5,
        search_mode: Literal["fast", "advanced", "expert"] = "fast",
    ) -> str:
        """亿信推特检索（X/推特财经讨论），可了解该股票的市场舆论与实时动态。

        search_mode 深度：fast 快（默认）、advanced / expert 更慢但结果更全。
        单次 run 内调用有次数上限，超限返回占位提示。查询失败时返回占位文本。"""
        nonlocal calls
        if calls >= max_calls:
            return f"（已达本次运行推特检索上限（{max_calls} 次），请聚焦最关键的问题再检索）"
        calls += 1
        try:
            data = _get_client().twitter_search(query, search_mode=search_mode, count=count)
        except Exception as exc:
            logger.warning("亿信 twitter 检索失败: {}", exc)
            return f"（亿信推特检索失败：{exc}）"
        return _summarize_tweets(data)

    return billions_twitter
