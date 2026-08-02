from datetime import datetime, timedelta
import pandas as pd
from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource
from data_source.chinese_mainland.tdx.adjust import qfq_adjust
from data_source.chinese_mainland.tdx.mapping import to_akshare_hist_schema
from data_source.chinese_mainland.tdx.tdx_source import TdxSource
from data_structure.chinese_mainland import ChinaStock, ChinaStockData
from data_structure.chinese_mainland.StockOverview import StockOverview
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport
from loguru import logger
from data_storage.chinese_mainland.ZODBStorage import get_zodb_storage
from utils.time_helper import get_last_business_day

class DataAcquisition:
    def __init__(self):
        # 进程级单例连接（见 get_zodb_storage docstring：FileStorage flock 不可重入）
        self.storage = get_zodb_storage()

    def acquire_daily_overview(self):
        if self.storage.check_need_update_overview():
            logger.info("Updating stock overview data...")
            self.update_shex_overview()
            self.update_szex_overview()
            self.update_bjex_overview()
            self.storage.set_overview_updated_now()
        return True

    def update_shex_overview(self):
        for row in AKShareSource().fetch_shex_stocks().to_dict(orient='records'):
            self.update_overview_in_storage(row)
        return True

    def update_szex_overview(self):
        for row in AKShareSource().fetch_szex_stocks().to_dict(orient='records'):
            self.update_overview_in_storage(row)
        return True

    def update_bjex_overview(self):
        for row in AKShareSource().fetch_bjex_stocks().to_dict(orient='records'):
            self.update_overview_in_storage(row)
        return True

    def update_overview_in_storage(self, row):
        stock_overview = StockOverview(*list(row.values())[1:])
        if self.storage.get_stock(stock_overview.ticker) is None:
            logger.debug(f"Stock overview for {stock_overview.ticker} not found in database.")
            stock = ChinaStock.ChinaStock(stock_overview.name, stock_overview.ticker, stock_overview)
            self.storage.put_stock(stock_overview.ticker, stock)
        else:
            logger.debug(f"Stock overview for {stock_overview.ticker} found in database, updating.")
            stock = self.storage.get_stock(stock_overview.ticker)
            stock.update_overview(new_overview=stock_overview)
            self.storage.put_stock(stock_overview.ticker, stock)
        logger.info(stock_overview)
        return True

    def acquire_historical_data(self, ticker):
        stock = self.storage.get_stock(ticker)
        if stock is None:
            logger.error(f"Stock {ticker} not found in database.")
            return False
        else:
            logger.debug(f"Stock {ticker} found in database, last data date is {stock.last_data_update}.")
            if stock.last_data_update == datetime.today():
                logger.info(f"Stock {ticker} historical data is already up to date.")
                return True

        look_back_days = 120
        if get_last_business_day(datetime.today().date()) - stock.last_data_update < timedelta(days=120):
            look_back_days = (get_last_business_day(datetime.today().date()) - stock.last_data_update).days

        if not look_back_days > 0:
            logger.info(f"Stock {ticker} historical data is already up to date.")
            return True

        for row in AKShareSource().fetch_stock_history(ticker, look_back_days=look_back_days).to_dict(orient='records'):
            stock_data = ChinaStockData.ChinaStockData(*list(row.values()))
            logger.debug(stock_data)
            stock.add_data(stock_data)

        self.storage.put_stock(ticker, stock)
        logger.info(f"Historical data for stock {ticker} updated until {stock.last_data_update}.")
        return True

    def acquire_historical_data_tdx(self, ticker):
        """TDX(pytdx) 历史行情路径：akshare 路径的快速替代，失败返回 False 走兜底。

        与 akshare 版本相同的约定：新鲜度优先、布尔结果协议、loguru {} 占位。
        数据链路：TdxSource(fetch_daily + fetch_xdxr + fetch_finance_capital)
        → mapping.to_akshare_hist_schema（12 列序，与 akshare 一致）
        → qfq_adjust（前复权，对齐 akshare qfq 口径）→ ChinaStockData 位置构造。

        异常处理约定（本方法为数据层唯一捕获点，见 spec 更新）：
        - finance_capital / xdxr 失败降级（换手率 NaN / 未复权），不阻断主路径
        - daily 拉取失败 → logger.error + return False → 调用方回退 akshare
        """
        stock = self.storage.get_stock(ticker)
        if stock is None:
            logger.error("Stock {} not found in database.", ticker)
            return False
        logger.debug("Stock {} found in database, last data date is {}.", ticker, stock.last_data_update)
        if stock.last_data_update == datetime.today():
            logger.info("Stock {} historical data is already up to date.", ticker)
            return True

        look_back_days = 120
        if get_last_business_day(datetime.today().date()) - stock.last_data_update < timedelta(days=120):
            look_back_days = (get_last_business_day(datetime.today().date()) - stock.last_data_update).days

        if not look_back_days > 0:
            logger.info("Stock {} historical data is already up to date.", ticker)
            return True

        tdx_source = TdxSource()

        float_shares = None
        try:
            capital = tdx_source.fetch_finance_capital(ticker)
            if not capital.empty and "liutongguben" in capital.columns:
                float_shares = float(capital["liutongguben"].iloc[0])
        except Exception:
            logger.warning("Finance capital unavailable for {}; turnover_rate will be NaN.", ticker)

        try:
            daily = tdx_source.fetch_daily(ticker, max_bars=look_back_days)
        except Exception:
            logger.error("TDX daily fetch failed for {}; historical data unavailable.", ticker)
            return False

        xdxr = pd.DataFrame()
        try:
            xdxr = tdx_source.fetch_xdxr(ticker)
        except Exception:
            logger.warning("TDX xdxr fetch failed for {}; using unadjusted prices.", ticker)

        mapped = to_akshare_hist_schema(daily, ticker, float_shares=float_shares)
        adjusted = qfq_adjust(mapped, xdxr)
        for row in adjusted.to_dict(orient='records'):
            stock_data = ChinaStockData.ChinaStockData(*list(row.values()))
            stock.add_data(stock_data)

        self.storage.put_stock(ticker, stock)
        logger.info("Historical data for stock {} updated until {}.", ticker, stock.last_data_update)
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


    def acquire_performance_report(self):
        ticker = '601988' # to check what is the last report date
        stock = self.storage.get_stock(ticker)
        if stock is None:
            logger.error(f"Stock {ticker} not found in database.")
            return False

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

    def ensure_stock(self, ticker):
        """按需单股构建概览：storage 无该股票 → TDX build_overview → put_stock。

        按需构建语义（不每日刷新，见 design.md §4）：storage 已有 → 直接 True。
        构建失败（build_overview 返回 None，snapshot 与日K 均无价格来源）→
        logger.error + False——与 acquire_performance_report_tdx 的"无报告不算
        失败"语义区分（error-handling.md：expected absence 才回 False）。
        """
        if self.storage.get_stock(ticker) is not None:
            return True
        overview_df = TdxSource().build_overview(ticker)
        if overview_df is None:
            logger.error("TDX overview build failed for {}.", ticker)
            return False
        # 22 列序契约（overview.py OVERVIEW_COLUMNS == StockOverview 字段序）：
        # 全量 22 值位置构造，无 [1:] 切片（与 akshare 路径不同，见 data_source spec）
        row = overview_df.to_dict(orient='records')[0]
        stock_overview = StockOverview(*list(row.values()))
        stock = ChinaStock.ChinaStock(stock_overview.name, stock_overview.ticker, stock_overview)
        self.storage.put_stock(stock_overview.ticker, stock)
        return True

    def acquire_performance_report_tdx(self, ticker):
        """TDX F10 业绩报告路径：build_reports 单表多行 → 逐行入仓。

        布尔协议：storage 无该股票 → logger.error + False（expected absence）；
        有 → 每份 add_performance_report（内部已 commit，report_date 字符串
        比较去重）→ put_stock → True。build_reports 返回 None（F10 拉取失败/
        无报告）→ logger.warning + True——无报告不是失败，与 ensure_stock 的
        构建失败语义区分。
        """
        stock = self.storage.get_stock(ticker)
        if stock is None:
            logger.error("Stock {} not found in database.", ticker)
            return False
        reports = TdxSource().build_reports(ticker)
        if reports is None:
            logger.warning("TDX performance reports unavailable for {}; skipped.", ticker)
            return True
        # 15 列序契约（reports.py REPORT_COLUMNS == StockPerformanceReport 字段序）
        for row in reports.to_dict(orient='records'):
            report = StockPerformanceReport(*list(row.values()))
            stock.add_performance_report(report)
        self.storage.put_stock(ticker, stock)
        return True

    def get_stock_data(self, ticker):
        """纯 TDX 按需链路：ensure_stock → 历史(TDX) → 业绩(TDX)，无 akshare。

        ensure_stock 失败（无任何价格来源）→ None；历史/业绩失败各自记日志
        不阻断，返回已构建的 stock。akshare 方法（acquire_daily_overview /
        acquire_performance_report / acquire_historical_data）保留作备用，
        主流程不再调用（PRD：纯 TDX 不兜底）。
        """
        if not self.ensure_stock(ticker):
            return None
        self.acquire_historical_data_tdx(ticker)
        self.acquire_performance_report_tdx(ticker)
        return self.storage.get_stock(ticker)
