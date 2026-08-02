"""TDX MCP 实时市场情报工具：概念板块/资金流向/大盘概况。

接入点：make_investment_decision 图前预取，追加进 stock_information
（不改 State/图/agent 模式——agent 是 prompt|llm 链，无 tool calling）。

约定（对齐 error-handling spec）：
- 无 TDX_API_KEY 或查询失败 → 返回占位说明文本，**不 raise**（图可继续）
- 只有构造 TdxMcpClient 需要 API key；查询结果转中文摘要文本
"""

from __future__ import annotations

import os

from data_source.chinese_mainland.tdx.tdx_source import ensure_vendor_on_path

ensure_vendor_on_path()
from scripts.tdx_mcp.tdx_client import TdxMcpClient  # noqa: E402

_FALLBACK_TEXT = "（未配置 TDX_API_KEY，跳过实时市场情报）"


def get_market_intel(ticker: str) -> str:
    """按目标股票查询实时行情/资金流向/所属概念板块，返回中文摘要文本。"""
    api_key = os.getenv("TDX_API_KEY", "")
    if not api_key:
        return _FALLBACK_TEXT
    try:
        client = TdxMcpClient(api_key=api_key)
        result = client.query(f"{ticker} 实时行情 资金流向 所属概念板块", size=50)
        if not result.ok():
            return f"（通达信 MCP 查询失败：{result.message}）"
        rows = result.to_dicts()
        if not rows:
            return "（通达信 MCP 无返回数据）"
        lines = [row_to_text(row) for row in rows[:10]]
        return "【实时市场情报】\n" + "\n".join(lines)
    except Exception:
        # MCP 网络/解析异常不阻断主流程（图可继续）
        return f"（通达信 MCP 查询异常，跳过{ticker}的实时情报）"


def row_to_text(row: dict) -> str:
    """把 MCP 一行数据渲染为 `字段: 值` 文本。"""
    return ", ".join(f"{k}: {v}" for k, v in row.items() if v not in (None, ""))
