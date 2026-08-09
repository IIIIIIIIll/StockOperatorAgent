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
            self.overview_last_update = datetime.datetime.now()
            self.last_data_update = default_start.date()

        def update_overview(self, new_overview):
            # 修复（08-02-fix-dead-code-cleanup）：原写 self.info 不写
            # self.overview → formatter 永远读构造时的陈旧概览。现写
            # self.overview（formatter 读取槽位）。08-09：info 死字段
            # （grep 无消费者）已移除——既有序列化数据上的多余属性不受影响。
            self.overview = new_overview
            self.overview_last_update = datetime.datetime.now()
            transaction.commit()

        def add_data(self, data: ChinaStockData):
            """单行追加（review #3：委托批量版，行为逐行等价——去重 + commit）。"""
            self.add_datas([data])

        def add_datas(self, datas: list[ChinaStockData]) -> int:
            """批量追加（review #3）：date > last_data_update 的行全量追加，
            一次 commit；返回实际追加数（0 = 全部重复，不 commit）。输入须
            date 升序（数据链路保证：TDX 历史升序）。首建全量回填数千行 =
            1 个事务（逐行 commit 是 anti-pattern，见 data_structure spec）。"""
            fresh = [d for d in datas if d.date > self.last_data_update]
            if not fresh:
                logger.debug("No new data on {}; last data date is {}", self.ticker, self.last_data_update)
                return 0
            self.datas.extend(fresh)
            self.last_data_update = fresh[-1].date
            logger.debug("Add {} data rows to stock {} until {}", len(fresh), self.ticker, self.last_data_update)
            transaction.commit()
            return len(fresh)

        def get_datas(self):
           return self.datas

        def add_performance_report(self, performance_report):
            """单行追加（review #3：委托批量版，行为逐行等价——去重 + commit）。"""
            self.add_performance_reports([performance_report])

        def add_performance_reports(self, reports: list) -> int:
            """批量追加（review #3）：report_date 递增去重（仅 > 最后一份者），
            一次 commit；返回追加数（0 = 全部重复，不 commit）。输入须
            report_date 升序（compose_reports period 升序保证）。"""
            fresh = [r for r in reports
                     if not self.performance_reports
                     or r.report_date > self.performance_reports[-1].report_date]
            if not fresh:
                logger.debug("No new performance reports for {}; last report date is {}", self.ticker, self.performance_reports[-1].report_date if self.performance_reports else None)
                return 0
            self.performance_reports.extend(fresh)
            logger.debug("Add {} performance reports to stock {}", len(fresh), self.ticker)
            transaction.commit()
            return len(fresh)

        def get_performance_reports(self):
            return self.performance_reports