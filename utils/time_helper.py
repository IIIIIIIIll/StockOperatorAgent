from datetime import datetime, timedelta
from loguru import logger

def get_last_business_day(input_date: type[datetime.date]) -> type[datetime.date]:
    # getting difference
    diff = 1
    if input_date.weekday() == 0:
        diff = 3
    elif input_date.weekday() == 6:
        diff = 2
    else:
        diff = 1

    # subtracting diff
    res = input_date - timedelta(days=diff)
    logger.info("Last business day before {} is {}", input_date.date(), res.date())
    return res