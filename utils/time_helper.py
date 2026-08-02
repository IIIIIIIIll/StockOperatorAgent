from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from loguru import logger

def asia_today() -> "datetime.date":
    """北京时间"今天"（Asia/Shanghai）——全仓唯一"今天"来源。

    跨层约定：需要"今天"日期的判定（ZODBStorage 17:00 新鲜度门、
    akshare 日K 窗口边界、报告期上限等）一律用本函数，避免服务器本地
    时区（UTC/其他）漂移导致与北京时间差一天。ZoneInfo 显式指定时区，
    不受进程 TZ 环境变量影响。
    """
    return datetime.now(ZoneInfo("Asia/Shanghai")).date()

def get_last_business_day(input_date: type[datetime.date]) -> type[datetime.date]:
    # getting difference
    diff = 0
    if input_date.weekday() == 6:
        diff = 2
    elif input_date.weekday() == 5:
        diff = 1
    else:
        diff = 0

    # subtracting diff
    res = input_date - timedelta(days=diff)
    logger.debug("Last business day before {} is {}", input_date, res)
    return res