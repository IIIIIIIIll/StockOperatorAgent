from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource
from loguru import logger

from data_structure.chinese_mainland.ChinaStockData import ChinaStockData
from data_structure.chinese_mainland.StockInfo import StockInfo
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport


class TestAKShare():


    def test_get_stock_info_em(self):
        akshare_source = AKShareSource()
        stock_info = akshare_source.fetch_stock_info('601985')
        assert stock_info is not None
        stock_info_dict = stock_info.to_dict()
        logger.info(stock_info_dict)
        stock_info_struct = StockInfo(*list(stock_info_dict['value'].values()))
        logger.info(stock_info_struct)

    def test_construct_stock_info(self):
        data = {'item': {0: '最新', 1: '股票代码', 2: '股票简称', 3: '总股本', 4: '流通股', 5: '总市值', 6: '流通市值', 7: '行业', 8: '上市时间'}, 'value': {0: 3.56, 1: '601188', 2: '龙江交通', 3: 1305469915.0, 4: 1305469915.0, 5: 4647472897.4, 6: 4647472897.4, 7: '铁路公路', 8: 20100319}}
        logger.info(list(data['value'].values()))
        stock_info_struct = StockInfo(*list(data['value'].values()))
        logger.info(stock_info_struct)

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
        stocks_hist = akshare_source.fetch_stock_history_days('601188')
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
