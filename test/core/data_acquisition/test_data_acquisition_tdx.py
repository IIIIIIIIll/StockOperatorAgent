"""DataAcquisition TDX 路径测试：布尔协议、新鲜度跳过、非法代码兜底。

沿用 test_data_acquisition.py 风格：真实 ZODB（进程级单例连接，见
get_zodb_storage）+ 真实 TDX 服务器。历史数据测试会写
database/china_stock_data.fs（与既有测试共享，正常）。
M3：新增 ensure_stock / acquire_performance_report_tdx / get_stock_data
纯 TDX 全链路用例（无 akshare；F10 不可达时业绩降级为 0 份不阻断）。
"""

import datetime

import BTrees
import transaction
from numpy import float64

from core.data_acquisition import DataAcquisition
from data_source.chinese_mainland.tdx.tdx_source import TdxSource
from data_structure.chinese_mainland import ChinaStock
from data_structure.chinese_mainland.StockOverview import StockOverview
from utils.time_helper import asia_today, get_last_business_day


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
        # 行为断言：有数据且不依赖 DB 历史（旧代码留下的 120 根连续数据无
        # 缺口时新代码合理跳过回填；"缺口大 → 全量回填"由
        # test_full_backfill_when_gap_large 专项覆盖）
        assert len(stock.get_datas()) > 0
        # 12 列位置构造：date 到 turnover_rate 字段应被正确填充
        last = stock.get_datas()[-1]
        assert last.ticker == "000001"
        assert last.close > 0

    def test_freshness_skip_when_up_to_date(self):
        da = DataAcquisition()
        stock = _seed_stock(da, "000001", "平安银行")
        # 首拉成功后当日再次调用应走新鲜度分支直接 True（修复：date==date
        # 比较真实生效——原 == datetime.today() 恒假，每次无谓重拉）
        assert da.acquire_historical_data_tdx("000001") is True
        len_before = len(stock.get_datas())
        assert da.acquire_historical_data_tdx("000001") is True
        # 跳过路径生效：不新增任何 bar
        assert len(stock.get_datas()) == len_before
        # last_data_update = 数据最后一根 bar 的日期（= 最近交易日，周末时为周五）
        assert stock.last_data_update == get_last_business_day(asia_today())

    def test_full_backfill_when_gap_large(self):
        """缺口 > 120 自然日 → max_bars=None 全量回填，无空洞（修复 2）。

        模拟 200 交易日缺口：把 last_data_update 拨回 130 天前（> 120 自然
        日阈值），触发全量路径；断言数据量覆盖缺口且日期连续无空洞。
        """
        da = DataAcquisition()
        stock = _seed_stock(da, "000001", "平安银行")
        stock.last_data_update = asia_today() - datetime.timedelta(days=130)
        transaction.commit()
        assert da.acquire_historical_data_tdx("000001") is True
        datas = stock.get_datas()
        # 全量回填覆盖缺口：数据最后日期 = 最近交易日
        assert len(datas) > 130
        assert stock.last_data_update == get_last_business_day(asia_today())
        # 无空洞：相邻 bar 日期差不超过 15 自然日（周末 + 节假日余量）
        dates = sorted(d.date for d in datas)
        assert max((b - a).days for a, b in zip(dates, dates[1:])) <= 15

    # ---------- M3：ensure_stock / acquire_performance_report_tdx / 纯 TDX 链路 ----------

    def test_ensure_stock_builds_and_is_idempotent(self):
        """storage 无该股票 → TDX 构建 overview 入仓；已有 → 直接 True（幂等）。"""
        da = DataAcquisition()
        ticker = "000002"
        assert da.ensure_stock(ticker) is True
        stock = da.storage.get_stock(ticker)
        assert stock is not None
        assert stock.overview is not None
        assert stock.overview.ticker == ticker
        assert stock.overview.name  # TDX 名称或回退 ticker，永不 NaN/空
        # 幂等：二次调用不重建（返回同一对象）
        assert da.ensure_stock(ticker) is True
        assert da.storage.get_stock(ticker) is stock

    def test_ensure_stock_fails_when_overview_build_fails(self):
        """无价格来源的代码 → build_overview None → False 且不入仓。

        699999 在 TDX 符号域中不存在（snapshot/daily 均抛 ValueError，实测
        确认）；999999 反而是上证指数（SH 指数代码），不能用作非法代码。
        TDX 整体不可达时同样返回 False——本用例对两种情况都成立。
        """
        da = DataAcquisition()
        assert da.ensure_stock("699999") is False
        assert da.storage.get_stock("699999") is None

    def test_ensure_stock_bj_code_returns_false(self):
        """北交所（4/8 前缀）→ 显式失败提示（TDX 不覆盖 BJ，静默 NaN 禁止），不入仓。

        离线：ensure_stock 在 BJ 检查处短路返回，不触发任何 TDX 拉取。
        """
        da = DataAcquisition()
        for ticker in ["430047", "830799"]:
            assert da.ensure_stock(ticker) is False
            assert da.storage.get_stock(ticker) is None

    def test_acquire_performance_report_tdx_missing_stock_returns_false(self):
        da = DataAcquisition()
        _seed_stock(da, "000001")
        assert da.acquire_performance_report_tdx("999999") is False

    def test_acquire_performance_report_tdx(self):
        da = DataAcquisition()
        stock = _seed_stock(da, "000001", "平安银行")
        assert da.acquire_performance_report_tdx("000001") is True
        reports = stock.get_performance_reports()
        # F10 可达 → 应有报告；不可达（build_reports None 降级）→ 0 份且不报错
        if TdxSource().build_reports("000001") is not None:
            assert len(reports) > 0
        for report in reports:
            assert len(report.report_date) == 8  # '%Y%m%d' 字符串协议

    def test_get_stock_data_pure_tdx_full_chain(self):
        """get_stock_data 纯 TDX 全链路：ensure_stock → 历史(TDX) → 业绩(TDX)。

        M3 前该链路依赖 akshare 全市场扫描（无 akshare 网络无法稳定断言）；
        现为按需单股构建，TDX 可达即可测（与 test_acquire_historical_data_tdx
        同语义）。
        """
        da = DataAcquisition()
        stock = da.get_stock_data("000001")
        assert stock is not None
        assert stock.overview is not None
        assert stock.overview.ticker == "000001"
        assert stock.overview.name  # TDX 名称或回退 ticker
        assert len(stock.get_datas()) > 0  # 历史（TDX 日K）
        if TdxSource().build_reports("000001") is not None:
            assert len(stock.get_performance_reports()) > 0
