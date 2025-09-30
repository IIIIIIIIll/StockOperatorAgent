import datetime
import persistent
import transaction
from loguru import logger

from data_structure.chinese_mainland.ChinaStockData import ChinaStockData
from utils.constants import default_start
from persistent.list import PersistentList

class ChinaStock(persistent.Persistent):


        def __init__(self, name, ticker, overview):
            self.name = name
            self.ticker = ticker
            self.datas = PersistentList()
            self.performance_reports = PersistentList()
            self.overview = overview
            self.info = None
            self.overview_last_update = datetime.datetime.now()
            self.last_data_update = default_start.date()

        def update_overview(self, new_overview):
            self.info = new_overview
            self.overview_last_update = datetime.datetime.now()
            transaction.commit()

        def add_info(self, info):
            self.info = info
            transaction.commit()

        def get_info(self):
            return self.info

        def add_data(self, data: ChinaStockData):
            if not data.date > self.last_data_update:
                logger.debug("Data on {} already exists for stock {}, last data date is {}", data.date, self.ticker, self.last_data_update)
                return
            self.datas.append(data)
            self.last_data_update = data.date
            logger.debug("Add data on {} to stock {}", data.date, self.ticker)
            transaction.commit()

        def get_datas(self):
           return self.datas

        def add_performance_report(self, performance_report):
            logger.debug(performance_report)
            self.performance_reports.append(performance_report)
            logger.debug("Add performance_report on {} to stock {}, current reports {}", performance_report.report_date, self.ticker, len(self.performance_reports))
            transaction.commit()

        def get_performance_reports(self):
            return self.performance_reports