"""TDX MCP 实时市场情报工具：概念板块/资金流向/大盘概况。

接入点：make_investment_decision 图前预取，追加进 stock_information
（不改 State/图/agent 模式——agent 是 prompt|llm 链，无 tool calling）。

约定（对齐 error-handling spec）：
- 无 TDX_API_KEY 或查询失败 → 返回占位说明文本，**不 raise**（图可继续）
- 只有构造 TdxMcpClient 需要 API key；查询结果转中文摘要文本

缓存（08-02-mcp-intel-cache）：非交易时段（utils.market_time.is_trading_time
判 False——收盘后到次日开盘前行情不变）优先读缓存（mcp_intel_cache，
按 ticker JSON 落 data/tdx_cache/mcp_intel/）；交易时段实时查询并写
缓存。无 key 不读写缓存。

开关（08-02-disable-tdx-mcp）：`TDX_MCP_DISABLED` 环境变量设置时整个
MCP 段停用（返回占位文本，不查询不缓存）——分析流程不再等 MCP。
"""

from __future__ import annotations

import os

from data_source.chinese_mainland.tdx.tdx_source import ensure_vendor_on_path

ensure_vendor_on_path()
from scripts.tdx_mcp.tdx_client import TdxMcpClient  # noqa: E402
from utils.runtime_config import env_disabled, runtime_bool

_FALLBACK_TEXT = "（未配置 TDX_API_KEY，跳过实时市场情报）"
_DISABLED_TEXT = "（TDX MCP 已禁用，跳过实时市场情报）"


def _mcp_disabled() -> bool:
    """TDX_MCP_DISABLED 开关：存在且值非空/非 "0"/非 "false" → 禁用。

    真值判定（与 _has_deepseek_key 的 os.environ 检查同风格）：
    设置任意值（"1"/"true"/"yes"/随意）即视为禁用，除显式假值
    "0"/"false"/"no"（留恢复路径）——env 负极性判定收敛到
    runtime_config.env_disabled 单点。

    覆盖层（08-08-billions-switches-ui）：`TDX_MCP_ENABLED` 覆盖
    存在 → True=开、False=关（结果取反）；否则 env 判定（默认行为
    与现状一致）。
    """
    env_enabled = not env_disabled("TDX_MCP_DISABLED")
    return not runtime_bool("TDX_MCP_ENABLED", env_enabled)


def _query_mcp(ticker: str, api_key: str) -> str:
    """实时查询 MCP 并拼中文摘要；失败 → 降级占位（不 raise）。

    与缓存判定解耦（08-02-mcp-intel-cache）：查询 + 文本拼装独立成
    模块函数——测试可注入/计数，缓存分支只做判定与读写。
    """
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


def get_market_intel(ticker: str) -> str:
    """按目标股票查询实时行情/资金流向/所属概念板块，返回中文摘要文本。

    缓存语义（08-02-mcp-intel-cache）：非交易时段（收盘后到次日开盘
    前）优先读缓存——省网络往返；交易时段（或缓存缺失）实时查询，
    成功写缓存。查询失败 → 降级占位（不静默用旧缓存——盘中数据必须
    新鲜）。

    开关（08-02-disable-tdx-mcp）：`TDX_MCP_DISABLED` 环境变量设置时
    直接返回占位文本——不查 MCP、不读写缓存（分析流程不再等 MCP
    网络/超时）；恢复 = 删环境变量，不动代码。
    """
    from core.llms.tools.mcp_intel_cache import DEFAULT_CACHE_ROOT, read_cache, write_cache
    from utils.market_time import is_trading_time

    if _mcp_disabled():
        return _DISABLED_TEXT

    api_key = os.getenv("TDX_API_KEY", "")
    if not api_key:
        return _FALLBACK_TEXT

    if not is_trading_time():
        cached = read_cache(DEFAULT_CACHE_ROOT, ticker)
        if cached is not None:
            return cached

    text = _query_mcp(ticker, api_key)
    write_cache(DEFAULT_CACHE_ROOT, ticker, text)
    return text


def row_to_text(row: dict) -> str:
    """把 MCP 一行数据渲染为 `字段: 值` 文本。"""
    return ", ".join(f"{k}: {v}" for k, v in row.items() if v not in (None, ""))
