import datetime
import persistent
import transaction
from loguru import logger

from data_structure.chinese_mainland.ChinaStockData import ChinaStockData
from utils.constants import default_start
from persistent.list import PersistentList

class ChinaStock(persistent.Persistent):


        def __init__(self, name, ticker):
            self.name = name
            self.ticker = ticker
            self.day_datas = PersistentList()
            self.week_datas = PersistentList()
            self.month_datas = PersistentList()
            self.performance_reports = PersistentList()
            self.info = None
            self.overview_last_update = datetime.datetime.now()
            self.last_day_data_update = default_start.date()
            self.last_week_data_update = default_start.date()
            self.last_month_data_update = default_start.date()

        def add_info(self, info):
            self.info = info
            transaction.commit()

        def get_info(self):
            return self.info

        def add_day_data(self, data: ChinaStockData):
            if not data.date > self.last_day_data_update:
                logger.debug("Data on {} already exists for stock {}, last data date is {}", data.date, self.ticker, self.last_day_data_update)
                return
            self.day_datas.append(data)
            self.last_day_data_update = data.date
            logger.debug("Add day data on {} to stock {}", data.date, self.ticker)
            transaction.commit()

        def add_week_data(self, data: ChinaStockData):
            if not data.date > self.last_week_data_update:
                logger.debug("Data on {} already exists for stock {}, last data week is {}", data.date, self.ticker, self.last_week_data_update)
                return
            self.week_datas.append(data)
            self.last_week_data_update = data.date
            logger.debug("Add week data on {} to stock {}", data.date, self.ticker)
            transaction.commit()

        def add_month_data(self, data: ChinaStockData):
            if not data.date > self.last_month_data_update:
                logger.debug("Data on {} already exists for stock {}, last data month is {}", data.date, self.ticker, self.last_month_data_update)
                return
            self.month_datas.append(data)
            self.last_month_data_update = data.date
            logger.debug("Add month data on {} to stock {}", data.date, self.ticker)
            transaction.commit()

        def get_day_datas(self):
            return self.day_datas

        def get_week_datas(self):
            return self.week_datas

        def get_month_datas(self):
            return self.month_datas

        def add_performance_report(self, performance_report):
            logger.debug(performance_report)
            if self.performance_reports and self.performance_reports[-1].report_date >= performance_report.report_date:
                logger.debug("Performance report on {} already exists for stock {}, last report date is {}", performance_report.report_date, self.ticker, self.performance_reports[-1].report_date)
                return
            self.performance_reports.append(performance_report)
            logger.debug("Add performance_report on {} to stock {}, current reports {}", performance_report.report_date, self.ticker, len(self.performance_reports))
            transaction.commit()

        def get_performance_reports(self):
            return self.performance_reports