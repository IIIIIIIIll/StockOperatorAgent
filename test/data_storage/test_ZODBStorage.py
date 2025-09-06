import datetime
from loguru import logger
from data_storage.chinese_mainland import ZODBStorage
from data_structure.chinese_mainland.ChinaStock import ChinaStock


class TestZODBStorage():


    def test_storage(self):
        storage = ZODBStorage.ZODBStorageInstance()
        stock =  ChinaStock('dummy')
        storage.put_stock(ticker='000001', stock=stock)
        assert storage.get_stock('000001') == stock

    def test_need_update(self):
        storage = ZODBStorage.ZODBStorageInstance()
        bench_time = datetime.datetime.combine(datetime.date.today(), datetime.time(17, 00));
        if storage.root.overview_last_updated > bench_time:
            assert storage.check_need_update_overview() is False
        else:
            assert storage.check_need_update_overview() is True

    def test_set_update_now(self):
        storage = ZODBStorage.ZODBStorageInstance()
        storage.set_overview_updated_now()
        assert (datetime.datetime.now() - storage.root.overview_last_updated).seconds < 10

    def test_exist_bjex_data(self):
        storage = ZODBStorage.ZODBStorageInstance()
        print(storage.root.overview_last_updated)
        stock = storage.get_stock('871263')
        assert stock is not None
        assert stock.ticker == '871263'
        logger.debug(stock.ticker)


    def test_exist_szex_data(self):
        storage = ZODBStorage.ZODBStorageInstance()
        print(storage.root.overview_last_updated)
        stock = storage.get_stock('002741')
        assert stock is not None
        assert stock.ticker == '002741'
        logger.debug(stock.ticker)


    def test_exist_shex_data(self):
        storage = ZODBStorage.ZODBStorageInstance()
        print(storage.root.overview_last_updated)
        stock = storage.get_stock('600188')
        assert stock is not None
        assert stock.ticker == '600188'
        logger.debug(stock.ticker)