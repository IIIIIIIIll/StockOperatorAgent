import datetime
from loguru import logger
from data_storage.chinese_mainland import ZODBStorage
from data_structure.chinese_mainland.ChinaStock import ChinaStock


class TestZODBStorage():


    def test_storage(self):
        storage = ZODBStorage.ZODBStorageInstance()
        stock =  ChinaStock('dummy', '000000')
        storage.put_stock(ticker='000000', stock=stock)
        assert storage.get_stock('000000') == stock