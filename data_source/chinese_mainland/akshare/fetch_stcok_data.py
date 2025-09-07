import datetime
from datetime import timedelta

import akshare as ak

class AKShareSource():
    def __init__(self):
        pass


    def fetch_shex_stocks(self):
        stock_sh_a_spot_em_df = ak.stock_sh_a_spot_em()
        return stock_sh_a_spot_em_df


    def fetch_szex_stocks(self):
        stock_sz_a_spot_em_df = ak.stock_sz_a_spot_em()
        return stock_sz_a_spot_em_df


    def fetch_bjex_stocks(self):
        stock_bj_a_spot_em_df = ak.stock_bj_a_spot_em()
        return stock_bj_a_spot_em_df


    def fetch_stock_info(self, ticker):
        stock_info = ak.stock_individual_info_em(symbol=ticker)
        return stock_info

    def fetch_stock_history(self, ticker, look_back_days=120):
        stock_hist = ak.stock_zh_a_hist(symbol=ticker, period="daily", start_date=(datetime.date.today()-timedelta(days=look_back_days)).strftime('%Y%m%d'),
                                                end_date=datetime.date.today().strftime('%Y%m%d'), adjust="qfq")
        return stock_hist