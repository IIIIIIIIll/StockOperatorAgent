"""DataAcquisition TDX 路径测试：布尔协议、新鲜度跳过、非法代码兜底。

沿用 test_data_acquisition.py 风格：真实 ZODB（进程级单例连接，见
get_zodb_storage）+ 真实 TDX 服务器。历史数据测试会写
database/china_stock_data.fs（与既有测试共享，正常）。
"""

from datetime import datetime

import BTrees
import transaction
from numpy import float64

from core.data_acquisition import DataAcquisition
from data_structure.chinese_mainland import ChinaStock
from data_structure.chinese_mainland.StockOverview import StockOverview
from utils.time_helper import get_last_business_day


def _seed_stock(da, ticker, name="测试"):
    """若 storage 中无该股票，播种一个最小 ChinaStock（22 字段 StockOverview）。"""
    if not hasattr(da.storage.root, "stocks"):
        da.storage.root.stocks = BTrees.OOBTree.BTree()
        transaction.commit()
    if da.storage.get_stock(ticker) is not None:
        return da.storage.get_stock(ticker)
    overview = StockOverview(
        ticker, name,
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
    )
    stock = ChinaStock.ChinaStock(name, ticker, overview)
    da.storage.put_stock(ticker, stock)
    return stock


class TestDataAcquisitionTdx:

    def test_missing_stock_returns_false(self):
        da = DataAcquisition()
        _seed_stock(da, "000001")
        assert da.acquire_historical_data_tdx("999999") is False

    def test_invalid_code_returns_false(self):
        da = DataAcquisition()
        _seed_stock(da, "000000")
        assert da.acquire_historical_data_tdx("000000") is False

    def test_acquire_historical_data_tdx(self):
        da = DataAcquisition()
        stock = _seed_stock(da, "000001", "平安银行")
        assert da.acquire_historical_data_tdx("000001") is True
        assert len(stock.get_datas()) > 0
        # 12 列位置构造：date 到 turnover_rate 字段应被正确填充
        last = stock.get_datas()[-1]
        assert last.ticker == "000001"
        assert last.close > 0

    def test_freshness_skip_when_up_to_date(self):
        da = DataAcquisition()
        stock = _seed_stock(da, "000001", "平安银行")
        # 首拉成功后当日再次调用应走新鲜度分支直接 True
        assert da.acquire_historical_data_tdx("000001") is True
        # last_data_update = 数据最后一根 bar 的日期（= 最近交易日，周末时为周五）
        assert stock.last_data_update == get_last_business_day(datetime.today().date())

    # 注：get_stock_data 的 TDX→akshare 回退为单行逻辑，不单独测试——
    # get_stock_data 先跑 acquire_daily_overview（akshare，网络依赖），
    # 在无 akshare 网络的环境下无法稳定断言（house style 无 mock）。
