"""08-02-fix-data-correctness 离线测试：akshare 备用路径自然日窗口修复。

全离线（不联网）：fetch_stock_history 的交易日 → 自然日余量公式
（×7//5）——原实现按自然日 look_back_days+1 传窗口，天然少拉约 30%
（周末缺口），靠 add_data 按日期去重补足。
"""

from datetime import date, timedelta

from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource


def _trading_days(n, start):
    """从 start 起跳过周六日的 n 个工作日日期列表（合成日历，无节假日）。"""
    days = []
    d = start
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    return days


class TestNaturalDayWindow():

    def test_window_formula(self):
        assert AKShareSource._natural_day_window(120) == 168  # 24 周
        assert AKShareSource._natural_day_window(5) == 7
        assert AKShareSource._natural_day_window(1) == 1

    def test_window_covers_120_trading_days(self):
        """合成日历验证：120 个交易日（跳过周末）的自然日跨度 ≤ 168。"""
        days = _trading_days(120, date(2026, 8, 3))  # 2026-08-03 是周一
        span = (days[-1] - days[0]).days
        assert span >= 120
        assert span + 1 <= AKShareSource._natural_day_window(120)
