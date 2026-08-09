import datetime

import transaction
from loguru import logger
from numpy import float64

from data_storage.chinese_mainland import ZODBStorage
from data_structure.chinese_mainland.ChinaStock import ChinaStock
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
        """表驱动独立期望（08-09-test-quality R1 拆同义反复）。

        旧版用实现自身公式（get_last_business_day + 17:00）推导期望、两分支
        各自断言自己——删除实现测试照样绿。现改为固定绝对日期直接给期望
        （远离今天的 2000/2100 与任何"上一工作日 17:00"比较结果恒定）：
        远古 → 需更新（True）；未来 → 不更新（False）。删除实现或恒 True
        实现必然 FAIL。

        共享 DB 跨运行确定性：显式设置 + finally 恢复原值（对齐 spec 的
        前置条件显式化约定）。
        """
        storage = _get_storage()
        original = storage.root.overview_last_updated
        try:
            cases = [
                (datetime.datetime(2000, 1, 4, 12, 0), True),   # 远古 → 早于任何上一工作日 17:00
                (datetime.datetime(2100, 1, 4, 12, 0), False),  # 未来 → 晚于任何上一工作日 17:00
            ]
            for stamp, expected in cases:
                storage.root.overview_last_updated = stamp
                transaction.commit()
                assert storage.check_need_update_overview() is expected
        finally:
            storage.root.overview_last_updated = original
            transaction.commit()

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

    def test_singleton_concurrent_first_call(self):
        """并发首调不双构造（修复 8）：threading.Lock 双重检查保护惰性初始化。

        释放旧连接（flock 锁）→ 重置 _instance → 8 线程并发首调 → 恰好构造
        一次、全部返回同一实例。无锁实现下并发构造第二个实例会
        zc.lockfile.LockError（本用例失败）。本用例放在本文件末尾：替换单例后
        套件后续（data_structure/integration/utils）不再触碰 ZODB，安全。
        """
        import threading
        from data_storage.chinese_mainland import ZODBStorage as storage_module

        old = storage_module.get_zodb_storage()
        try:
            transaction.abort()
        except Exception:
            pass
        old.connection.close()
        old.db.close()

        init_count = {"n": 0}
        orig_init = storage_module.ZODBStorageInstance.__init__

        def counting_init(self, *args, **kwargs):
            init_count["n"] += 1
            orig_init(self, *args, **kwargs)

        storage_module.ZODBStorageInstance.__init__ = counting_init
        storage_module._instance = None
        try:
            results = []

            def call():
                results.append(storage_module.get_zodb_storage())

            threads = [threading.Thread(target=call) for _ in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            assert init_count["n"] == 1
            assert all(r is results[0] for r in results)
        finally:
            storage_module.ZODBStorageInstance.__init__ = orig_init
