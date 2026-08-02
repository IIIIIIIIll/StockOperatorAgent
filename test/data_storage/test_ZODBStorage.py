import datetime

from loguru import logger
from numpy import float64

from data_storage.chinese_mainland import ZODBStorage
from data_structure.chinese_mainland.ChinaStock import ChinaStock
from data_structure.chinese_mainland.StockOverview import StockOverview
from utils.time_helper import get_last_business_day


def _make_overview(ticker):
    """22 字段 StockOverview 合成（数值全 0）—— 参照 test_data_acquisition_tdx._seed_stock。"""
    return StockOverview(
        ticker, "测试",
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
    )


def _seed_stock(storage, ticker, name="测试"):
    """若 storage 中无该股票，播种一个最小 ChinaStock（自包含，不依赖旧数据）。"""
    stock = storage.get_stock(ticker)
    if stock is None:
        stock = ChinaStock(name, ticker, _make_overview(ticker))
        storage.put_stock(ticker, stock)
    return stock


def _get_storage():
    """进程级单例（get_zodb_storage）：FileStorage flock 不可重入，同进程
    不得开第二个连接（data_storage spec）。全量回归中 test/core 套件已创建
    单例并持有锁，这里必须复用而非另开 ZODBStorageInstance。"""
    return ZODBStorage.get_zodb_storage()


class TestZODBStorage():

    def test_storage(self):
        storage = _get_storage()
        # 专用 dummy ticker：不触碰 DB 中真实 000001（120 日K + 6 报告）
        stock = ChinaStock("测试", "999998", _make_overview("999998"))
        storage.put_stock(ticker="999998", stock=stock)
        assert storage.get_stock("999998") == stock

    def test_need_update(self):
        storage = _get_storage()
        # 基准与 check_need_update_overview 实现完全一致：
        # 上一工作日（周末/工作日都成立）17:00
        bench_time = datetime.datetime.combine(get_last_business_day(datetime.date.today()), datetime.time(17, 00))
        if storage.root.overview_last_updated > bench_time:
            assert storage.check_need_update_overview() is False
        else:
            assert storage.check_need_update_overview() is True

    def test_set_update_now(self):
        storage = _get_storage()
        storage.set_overview_updated_now()
        assert (datetime.datetime.now() - storage.root.overview_last_updated).seconds < 10

    def test_exist_bjex_data(self):
        """按需构建契约：未构建的 ticker → None；补种后 → 数据（自包含）。

        旧语义（871263 等全市场扫描时代必存在）已废弃：纯 TDX 架构下 DB 只含
        分析过的股票，871263/002741/600188 从未入仓。None 断言用交易所 ticker
        （测试不补种它，跨 run 稳定）；补种断言用专用 dummy ticker。
        """
        storage = _get_storage()
        assert storage.get_stock("871263") is None
        stock = _seed_stock(storage, "999001")
        assert storage.get_stock("999001") is stock
        assert stock.ticker == "999001"
        logger.debug(stock.ticker)

    def test_exist_szex_data(self):
        storage = _get_storage()
        assert storage.get_stock("002741") is None
        stock = _seed_stock(storage, "999002")
        assert storage.get_stock("999002") is stock
        assert stock.ticker == "999002"
        logger.debug(stock.ticker)

    def test_exist_shex_data(self):
        storage = _get_storage()
        assert storage.get_stock("600188") is None
        stock = _seed_stock(storage, "999003")
        assert storage.get_stock("999003") is stock
        assert stock.ticker == "999003"
        logger.debug(stock.ticker)

    def test_exist_stock_data(self):
        storage = _get_storage()
        assert storage.get_stock("002741") is None
        stock = _seed_stock(storage, "999004")
        assert storage.get_stock("999004") is stock
        assert stock.ticker == "999004"
        assert len(stock.get_datas()) == 0  # 新补种无历史数据
        logger.debug(stock.ticker)
