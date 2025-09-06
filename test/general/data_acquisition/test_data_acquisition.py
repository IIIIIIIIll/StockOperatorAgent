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