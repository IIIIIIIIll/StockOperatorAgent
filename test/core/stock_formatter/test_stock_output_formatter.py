from core.stock_output_formatter import StockOutputFormatter
from core.data_acquisition import DataAcquisition
from loguru import logger


class TestStockOutputFormatter():

    def test_format(self):
        da = DataAcquisition()
        stock = da.storage.get_stock('002714')
        assert stock is not None
        assert len(stock.get_performance_reports()) > 0
        logger.info(StockOutputFormatter.format_stock_output(stock))