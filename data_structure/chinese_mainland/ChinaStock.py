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
            # 修复（08-02-fix-dead-code-cleanup）：原写 self.info 不写
            # self.overview → formatter 永远读构造时的陈旧概览。现写
            # self.overview（formatter 读取槽位）；info 字段保留仅为
            # 兼容既有序列化数据，不再写入。
            self.overview = new_overview
            self.overview_last_update = datetime.datetime.now()
            transaction.commit()

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
            if self.performance_reports and self.performance_reports[-1].report_date >= performance_report.report_date:
                logger.debug("Performance report on {} already exists for stock {}, last report date is {}", performance_report.report_date, self.ticker, self.performance_reports[-1].report_date)
                return
            self.performance_reports.append(performance_report)
            logger.debug("Add performance_report on {} to stock {}, current reports {}", performance_report.report_date, self.ticker, len(self.performance_reports))
            transaction.commit()

        def get_performance_reports(self):
            return self.performance_reports