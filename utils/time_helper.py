from datetime import datetime, timedelta
from loguru import logger

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