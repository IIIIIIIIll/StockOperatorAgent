import datetime
import pytest
from data_structure.chinese_mainland.ChinaStock import ChinaStock
from data_structure.chinese_mainland.ChinaStockData import ChinaStockData


class TestChinaStock():


    def test_day_data(self):
        stock =  ChinaStock('dummy', '000001')

        data1 = ChinaStockData(date=datetime.date(2026, 1, 29), ticker='601188', open=3.66, close=3.66, high=3.68, low=3.62, volume=208091, turnover=76085427.0, amplitude=1.64, percentage_gain=0.0, price_change=0.0, turnover_rate=1.59)
        data1.ticker = '000001'
        stock.add_day_data(data1)

        data2 = ChinaStockData(date=datetime.date(2026, 1, 30), ticker='601188', open=3.66, close=3.66, high=3.69, low=3.61, volume=202046, turnover=73763678.0, amplitude=2.19, percentage_gain=0.0, price_change=0.0, turnover_rate=1.55)
        data2.ticker = '000002'
        stock.add_day_data(data2)

        stock.add_day_data(data1)   # this should not be added

        assert len(stock.get_day_datas()) == 2
        assert stock.get_day_datas()[0] == data1
        assert stock.get_day_datas()[1] == data2


    def test_week_data(self):
        stock =  ChinaStock('dummy', '000001')

        data1 = ChinaStockData(date=datetime.date(2026, 1, 29), ticker='601188', open=3.66, close=3.66, high=3.68, low=3.62, volume=208091, turnover=76085427.0, amplitude=1.64, percentage_gain=0.0, price_change=0.0, turnover_rate=1.59)
        data1.ticker = '000001'
        stock.add_week_data(data1)

        data2 = ChinaStockData(date=datetime.date(2026, 1, 30), ticker='601188', open=3.66, close=3.66, high=3.69, low=3.61, volume=202046, turnover=73763678.0, amplitude=2.19, percentage_gain=0.0, price_change=0.0, turnover_rate=1.55)
        data2.ticker = '000002'
        stock.add_week_data(data2)

        stock.add_week_data(data1)   # this should not be added

        assert len(stock.get_week_datas()) == 2
        assert stock.get_week_datas()[0] == data1
        assert stock.get_week_datas()[1] == data2


    def test_month_data(self):
        stock = ChinaStock('dummy', '000001')

        data1 = ChinaStockData(date=datetime.date(2026, 1, 29), ticker='601188', open=3.66, close=3.66, high=3.68,
                               low=3.62, volume=208091, turnover=76085427.0, amplitude=1.64, percentage_gain=0.0,
                               price_change=0.0, turnover_rate=1.59)
        data1.ticker = '000001'
        stock.add_month_data(data1)

        data2 = ChinaStockData(date=datetime.date(2026, 1, 30), ticker='601188', open=3.66, close=3.66, high=3.69,
                               low=3.61, volume=202046, turnover=73763678.0, amplitude=2.19, percentage_gain=0.0,
                               price_change=0.0, turnover_rate=1.55)
        data2.ticker = '000002'
        stock.add_month_data(data2)

        stock.add_month_data(data1)  # this should not be added

        assert len(stock.get_month_datas()) == 2
        assert stock.get_month_datas()[0] == data1
        assert stock.get_month_datas()[1] == data2