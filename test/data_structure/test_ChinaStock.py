import datetime

from numpy import float64, int64

from data_structure.chinese_mainland.ChinaStock import ChinaStock
from data_structure.chinese_mainland.ChinaStockData import ChinaStockData
from data_structure.chinese_mainland.StockOverview import StockOverview


def _make_overview(ticker):
    """22 字段 StockOverview 合成（数值全 0）—— 参照 test_data_acquisition_tdx._seed_stock。"""
    return StockOverview(
        ticker, "测试",
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
    )


def _make_data(date, ticker):
    """12 字段 ChinaStockData 完整构造 —— 无参构造本身 TypeError（字段无默认值）。"""
    return ChinaStockData(
        date=date, ticker=ticker,
        open=float64(0), close=float64(0), high=float64(0), low=float64(0),
        volume=int64(0), turnover=float64(0), amplitude=float64(0),
        percentage_gain=float64(0), price_change=float64(0), turnover_rate=float64(0),
    )


class TestChinaStock():

    def test_stock(self):
        stock = ChinaStock("测试", "000001", _make_overview("000001"))

        # date 递增：add_data 的 date > last_data_update 比较要求可比较且递增。
        # 真实数据 date 是 datetime.date（实测 DB 000001 首根 bar 即 date 类型）
        data1 = _make_data(datetime.date(2024, 1, 2), "000001")
        stock.add_data(data1)

        data2 = _make_data(datetime.date(2024, 1, 3), "000001")
        stock.add_data(data2)

        assert len(stock.get_datas()) == 2
        assert stock.get_datas()[0] == data1
        assert stock.get_datas()[1] == data2

        # 去重语义：date 不晚于 last_data_update 的 data 被拒绝
        stock.add_data(_make_data(datetime.date(2024, 1, 2), "000001"))
        assert len(stock.get_datas()) == 2

    def test_update_overview(self):
        """修复（08-02-fix-dead-code-cleanup）：update_overview 写 self.overview。

        原实现写 self.info（formatter 读 self.overview）→ 概览永不刷新；
        修复后 update_overview(new) → stock.overview == new，info 保持 None。
        """
        stock = ChinaStock("测试", "000001", _make_overview("000001"))
        new_overview = _make_overview("000001")
        stock.update_overview(new_overview)
        assert stock.overview == new_overview
        assert stock.info is None
