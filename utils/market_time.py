"""A 股交易时段/交易日判定（08-02-market-hours-util）。

**离线优先**：不引入 akshare（用户确认完全弃用）、不引入网络交易日历——
pytdx（TDX）无交易日历/市场状态接口，节假日（国庆/春节等）无日历可查时
判定为"非交易时段"（保守：休市日行情不变，下游"用缓存"是正确行为）。

用途：TDX MCP 情报缓存（08-02-mcp-intel-cache）判定"收盘后到次日开盘
前用缓存"。

时段约定（北京时间）：
- 交易时段 = 工作日的 9:30–11:30 / 13:00–15:00（含边界——9:30:00 与
  15:00:00 本身是交易时刻；11:30:00 与 13:00:00 是午休边界，判非交易
  时段，行情不变无影响）。
- 工作日近似 = `get_last_business_day` 语义（跳过周末）。
- 时区 = `ZoneInfo("Asia/Shanghai")`（与 time_helper.asia_today 同时区
  约定，不受进程 TZ 影响）。
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from utils.time_helper import get_last_business_day

# 交易时段（含边界：9:30 与 15:00 本身是交易时刻）
_MORNING_START = (9, 30)
_MORNING_END = (11, 30)
_AFTERNOON_START = (13, 0)
_AFTERNOON_END = (15, 0)

_SHANGHAI = ZoneInfo("Asia/Shanghai")


def is_trading_time(now: datetime | None = None) -> bool:
    """北京时间工作日交易时段判定。

    ``now`` 可注入（datetime，带任意时区——内部转北京时间；naive 视为
    北京时间），缺省用当前时刻。周末/节假日 → False（保守，见模块
    docstring）。
    """
    if now is None:
        now = datetime.now(_SHANGHAI)
    elif now.tzinfo is None:
        # naive 输入视为北京时间（测试注入简化）
        now = now.replace(tzinfo=_SHANGHAI)
    else:
        now = now.astimezone(_SHANGHAI)

    if get_last_business_day(now.date()) != now.date():
        # 非工作日（周末）——get_last_business_day 返回最近工作日，
        # 相等 = 今天是工作日
        return False

    t = (now.hour, now.minute)
    return (_MORNING_START <= t < _MORNING_END
            or _AFTERNOON_START <= t < _AFTERNOON_END)


def latest_trading_day(stock) -> "object | None":
    """从日K 末根 bar 取最近交易日（零网络，ZODB 已有数据）。

    ``stock`` 为 ChinaStock（有 get_datas()）；无数据 → None。
    """
    datas = stock.get_datas()
    if not datas:
        return None
    return datas[-1].date
