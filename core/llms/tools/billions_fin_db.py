"""亿信 fin-db 自然语言金融问数工具（08-08-billions-api-integration，Step 2）。

接入点：build_stock_information 图前预取，追加为 stock_information 第 5 段
（R3——开关开时拼接；display 与 make_investment_decision 共用组装点）。

约定（对齐 error-handling spec 降级风格，与 get_market_intel 同风格）：
- 开关关（utils.billions_config.billions_enabled("FINDB") False）→ 返回
  空串 ""——该段自然不出现，现有 agent 流程零行为变化（AC1）
- 失败（BillionsApiError/任何异常/无有效结果）→ logger.warning + 占位
  文本，**绝不 raise、绝不写污染 stock_information 的语义内容**（AC4）
- 客户端在函数内懒加载（house style：无 key 环境不构造 client、不触发
  httpx 重依赖）
"""

from __future__ import annotations

from loguru import logger

from utils.billions_config import billions_enabled

# 段落标题（含来源标注「亿信金融数据库」；与 data_markdown 指标节 marker
# 同形态——注意：iter_sections 尚不识别该 marker，UI 独立成节属 Step 5）
_SECTION_TITLE = "【亿信金融数据库】"


def _build_question(ticker: str) -> str:
    """固定问数（fin_db auto 路由）：该股最新财务概况 + 近期行情。"""
    return f"查询{ticker}的最新财务数据和近期行情表现，包括营收、净利润、市盈率等关键指标。"


def _format_results(data: dict) -> str | None:
    """fin_db 响应 → 带标题的 Markdown 段落；无有效条目 → None（按失败降级）。

    响应契约（research/billions-api.md）：``result[].content`` 为 Markdown
    表格（success:false 已被 client 归一化为 BillionsApiError，此处 result
    恒为成功条目）；多条 result 依次拼接。字段缺失容错（调用方约定）。
    """
    results = data.get("result") or []
    parts = []
    for item in results:
        if isinstance(item, dict) and item.get("content"):
            parts.append(item["content"])
    if not parts:
        return None
    return _SECTION_TITLE + "\n" + "\n\n".join(parts)


def get_billions_financial_intel(ticker: str, _client=None) -> str:
    """亿信 fin-db 自然语言问数 → stock_information 第 5 段（R3）。

    :param ticker: 6 位 A 股代码
    :param _client: 测试注入点（house style 无 mock 框架）——带
        ``fin_db(query, data_sources=None) -> dict`` 语义的对象
        （BillionsClient 形状）；缺省 None → 函数内懒加载真实现
    :return: 开关关 → 空串 ""（该段不出现）；成功 → 【亿信金融数据库】
        标题 + Markdown 表格内容；失败/无有效结果 → logger.warning +
        占位文本（不 raise，不写污染 stock_information 的内容）
    """
    if not billions_enabled("FINDB"):
        return ""
    if _client is None:
        from data_source.chinese_mainland.billions.client import BillionsClient

        _client = BillionsClient()
    try:
        data = _client.fin_db(_build_question(ticker))
    except Exception as exc:
        logger.warning("亿信 fin-db 查询失败（{}）: {}", ticker, exc)
        return f"（亿信金融数据库查询失败，跳过{ticker}的财务问数）"
    text = _format_results(data)
    if text is None:
        logger.warning("亿信 fin-db 查询成功但无有效结果: {}", ticker)
        return f"（亿信金融数据库无返回结果，跳过{ticker}的财务问数）"
    return text
