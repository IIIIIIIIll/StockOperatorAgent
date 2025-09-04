import pytest
from data_structure.chinese_mainland.ChinaStock import ChinaStock
from data_structure.chinese_mainland.ChinaStockData import ChinaStockData


class TestZODBStorage():


    def test_stock(self):
        stock =  ChinaStock('dummy')

        data1 = ChinaStockData()
        data1.ticker = '000001'
        stock.add_data(data1)

        data2 = ChinaStockData()
        data2.ticker = '000002'
        stock.add_data(data2)

        assert len(stock.get_data()) == 2
        assert stock.get_data()[0] == data1
        assert stock.get_data()[1] == data2


