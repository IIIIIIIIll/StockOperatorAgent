import os
import subprocess
import sys
from datetime import date, datetime
from zoneinfo import ZoneInfo

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

    def test_asia_today(self):
        # 返回 date 对象，且与显式 Asia/Shanghai 时钟一致（公式钉死）
        assert isinstance(time_helper.asia_today(), date)
        assert time_helper.asia_today() == datetime.now(ZoneInfo("Asia/Shanghai")).date()

    def test_asia_today_independent_of_process_tz(self):
        # 非中国时区模拟：TZ=America/New_York 的干净子进程里 asia_today()
        # 仍等于北京时间"今天"（ZoneInfo 显式指定，不受 TZ 影响）。
        # 用子进程而非改本进程 TZ——避免污染同进程其他测试的 datetime.today()
        code = (
            "import sys; from datetime import datetime; from zoneinfo import ZoneInfo; "
            "from utils.time_helper import asia_today; "
            "sys.exit(0 if asia_today() == datetime.now(ZoneInfo('Asia/Shanghai')).date() else 1)"
        )
        env = dict(os.environ, TZ="America/New_York")
        result = subprocess.run([sys.executable, "-c", code], env=env)
        assert result.returncode == 0
