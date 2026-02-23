import datetime
from datetime import timedelta

import akshare as ak
from dateutil.relativedelta import relativedelta


class AKShareSource():
    def __init__(self):
        pass

    def fetch_a_share_stocks_sina(self):
        stock_sh_a_spot_sina_df = ak.stock_zh_a_spot()
        return stock_sh_a_spot_sina_df

    def fetch_stock_info(self, ticker):
        stock_info = ak.stock_individual_info_em(symbol=ticker)
        return stock_info

    def fetch_stock_history_days(self, ticker, look_back_cycles=100):
        stock_hist = ak.stock_zh_a_hist(symbol=ticker, period="daily", start_date=(datetime.date.today() - relativedelta(days=look_back_cycles + 1)).strftime('%Y%m%d'),
                                        end_date=datetime.date.today().strftime('%Y%m%d'), adjust="qfq")
        return stock_hist

    def fetch_stock_history_weeks(self, ticker, look_back_cycles=100):
        stock_hist = ak.stock_zh_a_hist(symbol=ticker, period="weekly", start_date=(datetime.date.today() - relativedelta(weeks=look_back_cycles + 1)).strftime('%Y%m%d'),
                                        end_date=datetime.date.today().strftime('%Y%m%d'), adjust="qfq")
        return stock_hist

    def fetch_stock_history_months(self, ticker, look_back_cycles=100):
        stock_hist = ak.stock_zh_a_hist(symbol=ticker, period="monthly", start_date=(datetime.date.today() - relativedelta(months=look_back_cycles + 1)).strftime('%Y%m%d'),
                                        end_date=datetime.date.today().strftime('%Y%m%d'), adjust="qfq")
        return stock_hist

    def fetch_performance_report(self, date):
        performance = ak.stock_yjbb_em(date=date)
        return performance