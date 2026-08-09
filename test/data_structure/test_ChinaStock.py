import datetime

from numpy import float64, int64

from data_structure.chinese_mainland.ChinaStock import ChinaStock
from data_structure.chinese_mainland.ChinaStockData import ChinaStockData
from data_structure.chinese_mainland.StockOverview import StockOverview
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport


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


def _make_report(ticker, report_date):
    """15 字段 StockPerformanceReport 合成（report_date 为 '%Y%m%d' 字符串）。"""
    return StockPerformanceReport(
        ticker, "测试",
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), "", report_date,
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
        修复后 update_overview(new) → stock.overview == new（08-09：info
        死字段已移除，无 info 断言）。
        """
        stock = ChinaStock("测试", "000001", _make_overview("000001"))
        new_overview = _make_overview("000001")
        stock.update_overview(new_overview)
        assert stock.overview == new_overview

    # ---------- review #3：批量 mutator（2026-08-02） ----------

    def test_add_datas_bulk(self):
        """批量追加：全量追加 + last_data_update 前进 + 返回追加数。"""
        stock = ChinaStock("测试", "000001", _make_overview("000001"))
        rows = [
            _make_data(datetime.date(2024, 1, 2), "000001"),
            _make_data(datetime.date(2024, 1, 3), "000001"),
            _make_data(datetime.date(2024, 1, 4), "000001"),
        ]
        assert stock.add_datas(rows) == 3
        assert len(stock.get_datas()) == 3
        assert stock.last_data_update == datetime.date(2024, 1, 4)

    def test_add_datas_rejects_old_rows_batch(self):
        """批量去重：全部旧行 → 0 且不 commit（datas 与 last_data_update 不变）。"""
        stock = ChinaStock("测试", "000001", _make_overview("000001"))
        stock.add_datas([_make_data(datetime.date(2024, 1, 3), "000001")])
        assert stock.add_datas([_make_data(datetime.date(2024, 1, 2), "000001")]) == 0
        assert len(stock.get_datas()) == 1
        assert stock.last_data_update == datetime.date(2024, 1, 3)

    def test_add_datas_mixed_batch_keeps_newer_only(self):
        """混合批次：旧行被过滤，新行全追加，一次 commit。"""
        stock = ChinaStock("测试", "000001", _make_overview("000001"))
        stock.add_datas([_make_data(datetime.date(2024, 1, 3), "000001")])
        assert stock.add_datas([
            _make_data(datetime.date(2024, 1, 2), "000001"),  # 旧
            _make_data(datetime.date(2024, 1, 4), "000001"),  # 新
            _make_data(datetime.date(2024, 1, 5), "000001"),  # 新
        ]) == 2
        assert len(stock.get_datas()) == 3
        assert stock.last_data_update == datetime.date(2024, 1, 5)

    def test_add_data_delegates_to_batch(self):
        """单行版委托批量版：行为逐行等价（去重 + commit）。"""
        stock = ChinaStock("测试", "000001", _make_overview("000001"))
        stock.add_data(_make_data(datetime.date(2024, 1, 2), "000001"))
        stock.add_data(_make_data(datetime.date(2024, 1, 2), "000001"))  # 重复拒绝
        assert len(stock.get_datas()) == 1
        assert stock.last_data_update == datetime.date(2024, 1, 2)

    def test_add_performance_reports_bulk(self):
        """批量追加：report_date 递增全追加 + 返回数。"""
        stock = ChinaStock("测试", "000001", _make_overview("000001"))
        assert stock.add_performance_reports([
            _make_report("000001", "20240331"),
            _make_report("000001", "20240630"),
            _make_report("000001", "20240930"),
        ]) == 3
        assert len(stock.get_performance_reports()) == 3

    def test_add_performance_reports_dedupes(self):
        """递增去重：旧期/同期拒绝，新期追加。"""
        stock = ChinaStock("测试", "000001", _make_overview("000001"))
        stock.add_performance_reports([_make_report("000001", "20240630")])
        assert stock.add_performance_reports([
            _make_report("000001", "20240331"),   # 旧
            _make_report("000001", "20240630"),   # 同
            _make_report("000001", "20240930"),   # 新
        ]) == 1
        assert len(stock.get_performance_reports()) == 2

    def test_add_performance_report_delegates_to_batch(self):
        """单行版委托批量版：重复拒绝语义保持。"""
        stock = ChinaStock("测试", "000001", _make_overview("000001"))
        stock.add_performance_report(_make_report("000001", "20240630"))
        stock.add_performance_report(_make_report("000001", "20240630"))  # 重复拒绝
        assert len(stock.get_performance_reports()) == 1
