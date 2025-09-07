from data_acquisition import DataAcquisition
from data_storage.chinese_mainland import ZODBStorage


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
        assert da.acquire_historical_data('002741') is True
        stock = da.storage.get_stock('002741')
        assert stock is not None
        assert len(stock.get_datas()) > 0

    def test_acquire_historical_data_failed(self):
        da = DataAcquisition()
        assert da.acquire_historical_data('999999') is False