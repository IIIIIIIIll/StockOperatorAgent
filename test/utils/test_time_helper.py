from datetime import date

from utils import time_helper


class TestTimeHelper():

    def test_get_last_business_day(self):
        # 实现签名是 date 对象（datetime 子类亦可，但按签名传 date）
        # 周六 2026-08-01 → 上一工作日 2026-07-31 周五
        assert time_helper.get_last_business_day(date(2026, 8, 1)) == date(2026, 7, 31)
        # 周日 2026-08-02 → 2026-07-31 周五
        assert time_helper.get_last_business_day(date(2026, 8, 2)) == date(2026, 7, 31)
        # 周五 2026-07-31 → 自身
        assert time_helper.get_last_business_day(date(2026, 7, 31)) == date(2026, 7, 31)
        # 周三 2026-07-29 → 自身
        assert time_helper.get_last_business_day(date(2026, 7, 29)) == date(2026, 7, 29)
