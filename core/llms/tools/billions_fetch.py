"""亿信 fetch 全文抓取工具（08-08-billions-api-integration，Step 3）。

多头/空头交易员与投资经理经 LLM 工具调用（bind_tools，节点内工具循环——
见 core/llms/tool_loop.py）精读网页/公告全文，正文以 ToolMessage 消息
回流参与生成。供应商：亿信 Fin 开放平台 `/api/v2/fetch`（官方 schema 见
research/billions-api.md）。

约定（对齐 error-handling spec 降级风格，与 web_search 同形状）：
- 开关关（utils.billions_config.billions_enabled("FETCH") False）→
  工厂返回 None——图装配不绑定，现有 agent 流程零行为变化（R2/AC1）
- 调用硬上限（R2/AC5）：闭包计数器，单次 run 内超过
  ``billions_max_calls("FETCH", 3)``（env `BILLIONS_FETCH_MAX_CALLS`
  可覆盖）→ 返回占位提示，**不再发真实请求**
- 抓取失败 / 无正文 → logger.warning + 占位文本，**不 raise**（模型
  拿到占位 ToolMessage 继续生成，图不中断）
- 返回：页面标题 + Markdown 正文（超长截断到 ``_MAX_CONTENT_CHARS``
  并注明截断）；url 与 doc_id 互斥（二选一，上游 422 归一化降级）
- 客户端在函数内懒加载（house style：无 key 环境不构造 client、不触发
  httpx 重依赖）
"""

from __future__ import annotations

from langchain_core.tools import BaseTool, tool

from core.llms.tools._capped import capped_call
from utils.billions_config import billions_enabled, billions_max_calls

# 返回给 LLM 的正文长度上限（字符）——全文常超 6000 字符，截断防上下文膨胀
_MAX_CONTENT_CHARS = 3000


def _format_fetch(data: dict) -> str:
    """fetch 响应 → 标题 + Markdown 正文；无正文 → 占位文本（不 raise）。

    响应契约（research）：content 为 Markdown（分页模式带 [Page N/M]
    前缀）；title 为页面标题；total_chars/truncated 字段允许缺失。
    """
    title = data.get("title", "")
    content = data.get("content", "")
    if not content:
        return "（亿信全文抓取失败：无返回内容）"
    if len(content) > _MAX_CONTENT_CHARS:
        content = content[:_MAX_CONTENT_CHARS] + f"\n（内容过长，已截断至前 {_MAX_CONTENT_CHARS} 字符）"
    header = f"【亿信网页全文】{title}" if title else "【亿信网页全文】"
    return header + "\n" + content


def make_billions_fetch_tool(_client=None, _max_calls: int | None = None) -> BaseTool | None:
    """构造亿信 fetch 全文抓取工具；开关关 → None（图装配跳过绑定，AC1/AC3）。

    :param _client: 测试注入点（house style 无 mock 框架）——带
        ``fetch(url=None, doc_id=None) -> dict`` 语义的对象（BillionsClient
        形状）；缺省 None → 首次调用时懒加载真实现
    :param _max_calls: 单次 run 调用硬上限（测试注入）；缺省 None →
        ``billions_max_calls("FETCH", 3)``（env `BILLIONS_FETCH_MAX_CALLS`
        可覆盖）
    :return: 名 "billions_fetch" 的 StructuredTool；开关关 → None
    """
    if not billions_enabled("FETCH"):
        return None
    max_calls = _max_calls if _max_calls is not None else billions_max_calls("FETCH", 3)
    client = _client
    calls = [0]  # 闭包计数器（capped_call 内可变，跨调用累计）

    def _get_client():
        nonlocal client
        if client is None:
            from data_source.chinese_mainland.billions.client import BillionsClient

            client = BillionsClient()
        return client

    @tool("billions_fetch")
    def billions_fetch(url: str | None = None, doc_id: str | None = None) -> str:
        """亿信网页/公告全文抓取，可精读公告、研报或新闻全文内容。

        url（网页地址）与 doc_id（来自 billions_search 检索结果附带的
        doc_id，仅公告全文开放）二选一——两者都传或都不传会失败。单次
        run 内调用有次数上限，超限返回占位提示。抓取失败时返回占位文本。"""
        return capped_call(
            calls, max_calls,
            cap_text="（已达本次运行全文抓取上限（{max_calls} 次），请聚焦最关键的内容再抓取）",
            fail_fmt="（亿信全文抓取失败：{exc}）",
            warn_msg="亿信 fetch 全文抓取失败: {}",
            fn=lambda: _format_fetch(_get_client().fetch(url=url, doc_id=doc_id)),
        )

    return billions_fetch
