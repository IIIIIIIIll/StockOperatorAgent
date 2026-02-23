import math
import time
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta

from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource
from data_structure.chinese_mainland import ChinaStock, ChinaStockData
from data_structure.chinese_mainland.StockInfo import StockInfo
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport
from loguru import logger
from data_storage.chinese_mainland.ZODBStorage import ZODBStorageInstance
from utils.time_helper import get_last_business_day

class DataAcquisition:
    def __init__(self):
        self.storage = ZODBStorageInstance()

    def acquire_stock_info(self, ticker):
        stock = self.storage.get_stock(ticker)
        if stock is None:
            logger.error(f"Stock {ticker} not found in database. Acquiring stock info from AKShare.")
            stock_info = AKShareSource().fetch_stock_info(ticker)
            stock_info_dict = stock_info.to_dict()
            stock_info_struct = StockInfo(*list(stock_info_dict['value'].values()))
            stock = ChinaStock.ChinaStock(stock_info_struct.name, stock_info_struct.ticker)
            logger.debug(f"Stock {ticker} info acquired from AKShare, adding to database.")
            self.storage.put_stock(ticker, stock)
        else:
            logger.debug(f"Stock {ticker} info exists in database.")


    def acquire_historical_day_data(self, ticker, stock):
        look_back_days = 100
        if get_last_business_day(datetime.today().date()) - stock.last_day_data_update < timedelta(days=look_back_days):
            look_back_days = (get_last_business_day(datetime.today().date()) - stock.last_day_data_update).days

        if not look_back_days > 0:
            logger.info(f"Stock {ticker} historical day data is already up to date.")
            return stock

        for row in AKShareSource().fetch_stock_history_days(ticker, look_back_cycles=look_back_days).to_dict(orient='records'):
            stock_data = ChinaStockData.ChinaStockData(*list(row.values()))
            logger.debug(stock_data)
            stock.add_day_data(stock_data)
        return stock


    def acquire_historical_week_data(self, ticker, stock):
        look_back_days = 100*7
        if get_last_business_day(datetime.today().date()) - stock.last_week_data_update < timedelta(days=look_back_days):
            look_back_days = (get_last_business_day(datetime.today().date()) - stock.last_week_data_update).days

        look_back_weeks = look_back_days//7
        if not look_back_weeks > 0:
            logger.info(f"Stock {ticker} historical week data is already up to date.")
            return stock

        for row in AKShareSource().fetch_stock_history_weeks(ticker, look_back_cycles=look_back_weeks).to_dict(orient='records'):
            stock_data = ChinaStockData.ChinaStockData(*list(row.values()))
            logger.debug(stock_data)
            stock.add_week_data(stock_data)
        return stock


    def acquire_historical_month_data(self, ticker, stock):
        look_back_months = 60
        actual_month_gap = relativedelta(get_last_business_day(datetime.today().date()), stock.last_month_data_update)
        actual_month_gap_in_months = actual_month_gap.years * 12 + actual_month_gap.months
        if actual_month_gap_in_months < look_back_months:
            look_back_months = actual_month_gap_in_months

        if not look_back_months > 0:
            logger.info(f"Stock {ticker} historical month data is already up to date.")
            return stock

        for row in AKShareSource().fetch_stock_history_months(ticker, look_back_cycles=look_back_months).to_dict(orient='records'):
            stock_data = ChinaStockData.ChinaStockData(*list(row.values()))
            logger.debug(stock_data)
            stock.add_month_data(stock_data)
        return stock


    def acquire_historical_data(self, ticker):
        stock = self.storage.get_stock(ticker)
        if stock is None:
            logger.error(f"Stock {ticker} not found in database.")
            return False
        else:
            logger.debug(f"Stock {ticker} found in database, last data date is {stock.last_day_data_update}.")
            if stock.last_day_data_update == datetime.today():
                logger.info(f"Stock {ticker} historical data is already up to date.")
                return True

        stock = self.acquire_historical_day_data(ticker, stock)
        time.sleep(1)   # to avoid anti crawl
        stock = self.acquire_historical_week_data(ticker, stock)
        time.sleep(2)   # to avoid anti crawl
        stock = self.acquire_historical_month_data(ticker, stock)
        time.sleep(3)   # to avoid anti crawl
        self.storage.put_stock(ticker, stock)
        logger.info(f"Historical data for stock {ticker} updated until {stock.last_day_data_update}.")
        return True


    def get_next_report_date(self, last_report_date):
        year = last_report_date.year
        month = last_report_date.month
        if month <= 3:
            return datetime(year, 6, 30).date()
        elif month <= 6:
            return datetime(year, 9, 30).date()
        elif month <= 9:
            return datetime(year, 12, 31).date()
        else:
            return datetime(year+1, 3, 31).date()


    def fetch_all_performance_report(self, ticker):
        stock = self.storage.get_stock(ticker)
        if stock is None:
            logger.error(f"Stock {ticker} not found in database.")
            return False

        # look back 6 years for performance report
        last_report_year = (datetime.now() - timedelta(6*365)).year
        last_report_date = datetime.strptime(f"{last_report_year}1231", '%Y%m%d').date()
        if  len(stock.performance_reports) == 0:
            logger.debug(f"Stocks has no performance reports in database.")
        else:
            logger.debug(f"Stocks last report date is {stock.performance_reports[-1].report_date}.")
            last_report_date = datetime.strptime(stock.performance_reports[-1].report_date, '%Y%m%d').date()


        latest_possible_date_year = datetime.today().year
        latest_possible_date_marker = '1231'
        if datetime.today().month < 4:
            latest_possible_date_marker = '1230'
        elif datetime.today().month < 7:
            latest_possible_date_marker = '0331'
        elif datetime.today().month < 10:
            latest_possible_date_marker = '0630'
        else:
            latest_possible_date_marker = '0930'

        latest_possible_date = datetime.strptime(f"{latest_possible_date_year}{latest_possible_date_marker}", '%Y%m%d').date()

        next_report_date = self.get_next_report_date(last_report_date)
        logger.debug(f"Lastest report date is {latest_possible_date}.")
        while next_report_date <= latest_possible_date:
            logger.info(f"Fetching report for {next_report_date}.")
            for row in AKShareSource().fetch_performance_report(next_report_date.strftime('%Y%m%d')).to_dict(orient='records'):
                stock_performance = StockPerformanceReport(*list(row.values())[1:])
                stock_performance.report_date = next_report_date.strftime('%Y%m%d')
                self.add_performance_report_in_storage(stock_performance)

            next_report_date = self.get_next_report_date(next_report_date)

        return True


    def add_performance_report_in_storage(self, stock_performance):
        if self.storage.get_stock(stock_performance.ticker) is None:
            logger.error(f"Stock {stock_performance.ticker} not found in database.")
            return False
        else:
            logger.debug(f"Stock {stock_performance.ticker} found in database, adding performance report.")
            stock = self.storage.get_stock(stock_performance.ticker)
            stock.add_performance_report(performance_report=stock_performance)
            self.storage.put_stock(stock.ticker, stock)
        return True

    def get_stock_data(self, ticker):

        self.acquire_historical_data(ticker)
        self.fetch_all_performance_report(ticker)
        return self.storage.get_stock(ticker)