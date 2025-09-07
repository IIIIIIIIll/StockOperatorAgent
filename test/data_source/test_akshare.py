from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource
from loguru import logger

from data_structure.chinese_mainland.ChinaStockData import ChinaStockData
from data_structure.chinese_mainland.StockInfo import StockInfo
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport
from data_structure.chinese_mainland.StockOverview import StockOverview


class TestAKShare():


    def test_get_ticker_info(self):
        akshare_source = AKShareSource()
        stock = akshare_source.fetch_stock_info('000001')
        assert stock is not None
        stock_dict = stock.to_dict(orient='dict').get('value')

        stock_info = StockInfo(*stock_dict.values())
        logger.info(stock)
        logger.info(stock_dict)
        logger.info(stock_info)


    def test_get_shex_stock_overview(self):
        akshare_source = AKShareSource()
        shex_stocks = akshare_source.fetch_shex_stocks()
        assert shex_stocks is not None
        shex_stocks_dict = shex_stocks.to_dict(orient='records')
        for row in shex_stocks_dict:
            stock_overview = StockOverview(*list(row.values())[1:])
            logger.info(stock_overview)

        logger.info(shex_stocks)


    def test_get_shex_stock_overview(self):
        akshare_source = AKShareSource()
        shex_stocks = akshare_source.fetch_shex_stocks()
        assert shex_stocks is not None
        shex_stocks_dict = shex_stocks.to_dict(orient='records')
        for row in shex_stocks_dict:
            stock_overview = StockOverview(*list(row.values())[1:])
            logger.info(stock_overview)

        logger.info(shex_stocks)


    def test_get_szex_stock_overview(self):
        akshare_source = AKShareSource()
        szex_stocks = akshare_source.fetch_szex_stocks()
        assert szex_stocks is not None
        szex_stocks_dict = szex_stocks.to_dict(orient='records')
        for row in szex_stocks_dict:
            stock_overview = StockOverview(*list(row.values())[1:])
            logger.info(stock_overview)

        logger.info(szex_stocks)


    def test_get_bjex_stock_overview(self):
        akshare_source = AKShareSource()
        bjex_stocks = akshare_source.fetch_bjex_stocks()
        assert bjex_stocks is not None
        bjex_stocks_dict = bjex_stocks.to_dict(orient='records')
        for row in bjex_stocks_dict:
            stock_overview = StockOverview(*list(row.values())[1:])
            logger.info(stock_overview)

        logger.info(bjex_stocks)


    def test_get_stock_hist(self):
        akshare_source = AKShareSource()
        stocks_hist = akshare_source.fetch_stock_history('601188')
        assert stocks_hist is not None
        stocks_hist_dict = stocks_hist.to_dict(orient='records')
        for row in stocks_hist_dict:
            stock_data = ChinaStockData(*list(row.values()))
            logger.info(row)
            logger.info(stock_data)

        logger.info(stocks_hist)


    def test_get_stock_performance_report(self):
        akshare_source = AKShareSource()
        market_report = akshare_source.fetch_performance_report('20250630')
        assert market_report is not None
        perf_report_dict = market_report.to_dict(orient='records')

        for row  in perf_report_dict:
            stock_report = StockPerformanceReport(*list(row.values())[1:])
            # logger.info(row)
            logger.info(stock_report)

        logger.info(market_report)
