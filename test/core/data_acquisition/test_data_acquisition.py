from core.data_acquisition import DataAcquisition
from core.stock_output_formatter import StockOutputFormatter
from loguru import logger

class TestDataAcquisition():

    def test_acquire_stock_info(self):
        da = DataAcquisition()
        da.acquire_stock_info('002714')
        stock = da.storage.get_stock('002714')
        assert stock is not None
        assert stock.ticker == '002714'
        assert stock.name is not None

    def test_acquire_historical_data(self):
        da = DataAcquisition()
        assert da.acquire_historical_data('002714') is True
        stock = da.storage.get_stock('002714')
        assert stock is not None
        assert len(stock.get_datas()) > 0

    def test_acquire_historical_data_failed(self):
        da = DataAcquisition()
        assert da.acquire_historical_data('999999') is False

    def test_acquire_stock_performance_report(self):
        da = DataAcquisition()
        assert da.fetch_all_performance_report('002714') is True
        stock = da.storage.get_stock('002714')
        assert stock is not None
        assert len(stock.get_performance_reports()) > 0

    def test_acquire_stock_data(self):
        da = DataAcquisition()
        stock = da.get_stock_data('002714')
        logger.info(StockOutputFormatter.format_stock_output(stock))
        assert stock is not None
