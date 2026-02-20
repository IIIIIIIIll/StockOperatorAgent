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

    def test_get_shsz_stock_overview_sina(self):
        akshare_source = AKShareSource()
        shsz_stocks = akshare_source.fetch_a_share_stocks_sina()
        assert shsz_stocks is not None
        shsz_stocks_dict = shsz_stocks.to_dict(orient='records')
        for row in shsz_stocks_dict:
            # stock_overview = StockOverview(*list(row.values())[1:])
            # logger.info(stock_overview)
            logger.info(row)
            logger.info(*list(row.values())[1:])

        logger.info(shsz_stocks)

    def test_get_row(self):
        row = {'代码': 'bj920000', '名称': '安徽凤凰', '最新价': 21.15, '涨跌额': -0.62, '涨跌幅': -2.848, '买入': 21.14,
         '卖出': 21.15, '昨收': 21.77, '今开': 21.66, '最高': 22.19, '最低': 21.05, '成交量': 2109502.0,
         '成交额': 45000437.0, '时间戳': '15:30:00'}
        logger.info(list(row.values())[1:])
        logger.info(list(row.values())[0:-1])
        logger.info(*list(row.values())[1:])


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
