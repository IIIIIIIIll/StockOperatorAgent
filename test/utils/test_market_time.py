"""08-02-market-hours-util：A 股交易时段/交易日判定测试。

is_trading_time 是纯函数（注入 now）——离线固定时刻断言盘中/午休/收盘
后/开盘前/周末各时段；latest_trading_day 从日K 末根 bar 取最近交易日。
house style：无 mock 框架，参数注入 + 真实对象（ChinaStockData 列表）。
"""

from datetime import datetime, date

from utils.market_time import is_trading_time, latest_trading_day
from data_structure.chinese_mainland.ChinaStockData import ChinaStockData


def _dt(y, m, d, hh, mm):
    """北京时间（naive 视为北京时间，与实现约定一致）。"""
    return datetime(y, m, d, hh, mm)


# 2026-07-31 是周五（工作日）；2026-08-01 是周六
class TestIsTradingTime:

    def test_morning_session(self):
        assert is_trading_time(_dt(2026, 7, 31, 9, 30)) is True   # 开盘边界
        assert is_trading_time(_dt(2026, 7, 31, 9, 31)) is True
        assert is_trading_time(_dt(2026, 7, 31, 11, 29)) is True

    def test_lunch_break(self):
        assert is_trading_time(_dt(2026, 7, 31, 11, 30)) is False  # 午休开始
        assert is_trading_time(_dt(2026, 7, 31, 12, 0)) is False
        assert is_trading_time(_dt(2026, 7, 31, 12, 59)) is False

    def test_afternoon_session(self):
        assert is_trading_time(_dt(2026, 7, 31, 13, 0)) is True    # 午后开盘
        assert is_trading_time(_dt(2026, 7, 31, 14, 59)) is True
        # 15:00 整是收盘时刻——其后行情不再变化，判非交易时段（缓存安全）
        assert is_trading_time(_dt(2026, 7, 31, 15, 0)) is False

    def test_after_close_and_before_open(self):
        assert is_trading_time(_dt(2026, 7, 31, 15, 1)) is False   # 收盘后
        assert is_trading_time(_dt(2026, 7, 31, 20, 0)) is False
        assert is_trading_time(_dt(2026, 7, 31, 8, 59)) is False   # 开盘前

    def test_weekend(self):
        assert is_trading_time(_dt(2026, 8, 1, 10, 0)) is False    # 周六盘中
        assert is_trading_time(_dt(2026, 8, 2, 10, 0)) is False    # 周日盘中

    def test_default_now_is_used(self):
        # 无参调用不炸（当前时刻判定，不断言结果）
        is_trading_time()

    def test_aware_datetime_converted_to_beijing(self):
        """带时区 datetime 转北京时间判定（UTC+0 周五 01:30 = 北京 09:30）。"""
        from datetime import timezone, timedelta
        utc = datetime(2026, 7, 31, 1, 30, tzinfo=timezone.utc)
        assert is_trading_time(utc) is True


class TestLatestTradingDay:

    def test_returns_last_bar_date(self):
        from data_structure.chinese_mainland.ChinaStock import ChinaStock
        # 最小 ChinaStock（构造只需 name/ticker/overview，overview 可 None）
        stock = ChinaStock("dummy", "999998", None)
        stock.datas.extend([
            ChinaStockData(date(2026, 7, 30), "999998", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
            ChinaStockData(date(2026, 7, 31), "999998", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
        ])
        assert latest_trading_day(stock) == date(2026, 7, 31)

    def test_no_data_returns_none(self):
        from data_structure.chinese_mainland.ChinaStock import ChinaStock
        stock = ChinaStock("dummy", "999998", None)
        assert latest_trading_day(stock) is None
