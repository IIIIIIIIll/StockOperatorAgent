from core.data_acquisition import DataAcquisition
from core.stock_output_formatter import StockOutputFormatter
from loguru import logger

class TestDataAcquisition():

    def test_acquire_bjex_overview(self):
        da = DataAcquisition()
        assert da.update_bjex_overview() is True
        assert da.storage.get_stock('871263') is not None

    def test_acquire_szex_overview(self):
        da = DataAcquisition()
        assert da.update_szex_overview() is True
        assert da.storage.get_stock('002741') is not None

    def test_acquire_shex_overview(self):
        da = DataAcquisition()
        assert da.update_shex_overview() is True
        assert da.storage.get_stock('601188') is not None

    def test_acquire_day_overview(self):
        da = DataAcquisition()
        assert da.acquire_daily_overview() is True
        assert da.storage.get_stock('002741') is not None
        assert da.storage.get_stock('871263') is not None
        assert da.storage.get_stock('601188') is not None

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
        assert da.acquire_performance_report() is True
        stock = da.storage.get_stock('002714')
        assert stock is not None
        assert len(stock.get_performance_reports()) > 0

    def test_acquire_stock_data(self):
        da = DataAcquisition()
        stock = da.get_stock_data('002714')
        logger.info(StockOutputFormatter.format_stock_output(stock))
        assert stock is not None
