from datetime import timedelta

import akshare as ak

from utils.time_helper import asia_today

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

    @staticmethod
    def _natural_day_window(look_back_days):
        """交易日数 → 自然日窗口（×7//5 周末余量：120 交易日 ≈ 24 周 = 168
        自然日），多拉的旧 bar 由 ChinaStock.add_data 按日期去重。"""
        return look_back_days * 7 // 5

    def fetch_stock_history(self, ticker, look_back_days=120):
        # look_back_days 是交易日数；akshare 窗口按自然日，直接传交易日会天然
        # 少拉约 30%（周末缺口）。
        natural_days = self._natural_day_window(look_back_days)
        today = asia_today()  # 北京时间"今天"（时区统一）
        stock_hist = ak.stock_zh_a_hist(symbol=ticker, period="daily", start_date=(today-timedelta(days=natural_days+1)).strftime('%Y%m%d'),
                                                end_date=today.strftime('%Y%m%d'), adjust="qfq")
        return stock_hist

    def fetch_performance_report(self, date):
        performance = ak.stock_yjbb_em(date=date)
        return performance