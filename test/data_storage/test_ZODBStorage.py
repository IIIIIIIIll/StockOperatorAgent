import pytest
from data_storage import ZODBStorage
from data_structure.chinese_mainland.ChinaStock import ChinaStock


class TestZODBStorage():


    def test_storage(self):
        storage = ZODBStorage.ZODBStorageInstance()
        stock =  ChinaStock('dummy')
        storage.put_stock(ticker='000001', stock=stock)
        assert storage.get_stock('000001') == stock
