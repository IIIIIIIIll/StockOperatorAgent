"""DataAcquisition TDX 路径测试：布尔协议、新鲜度跳过、非法代码兜底。

沿用 test_data_acquisition.py 风格：真实 ZODB（进程级单例连接，见
get_zodb_storage）+ 真实 TDX 服务器。历史数据测试会写
database/china_stock_data.fs（与既有测试共享，正常）。
M3：新增 ensure_stock / acquire_performance_report_tdx / get_stock_data
纯 TDX 全链路用例（无 akshare；F10 不可达时业绩降级为 0 份不阻断）。
"""

import datetime

import BTrees
import pandas as pd
import transaction
from numpy import float64

from core.data_acquisition import DataAcquisition, FetchScope
from data_source.chinese_mainland.tdx.overview import OVERVIEW_COLUMNS
from data_source.chinese_mainland.tdx.reports import build_reports
from data_structure.chinese_mainland import ChinaStock
from data_structure.chinese_mainland.StockOverview import StockOverview
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport
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


def _seed_report(stock, report_date):
    """直接向 performance_reports 追加一份最小报告（绕过 add_performance_report
    的递增去重约束——测试需构造任意旧报告期）。report_date 为 '%Y%m%d' 字符串。"""
    report = StockPerformanceReport(
        stock.ticker, stock.name,
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), float64(0), float64(0), float64(0), float64(0),
        float64(0), "", report_date,
    )
    stock.performance_reports.append(report)
    transaction.commit()


class _CountingSrc:
    """计数假数据源（review #2+#3）：fetch_* 返回满足主链路合成需求的最小
    DataFrame（compose_overview / to_akshare_hist_schema / qfq_adjust /
    compose_reports 的列契约），记录每源调用次数。"""

    def __init__(self):
        self.calls = {}

    def _count(self, method, ticker):
        key = (method, ticker)
        self.calls[key] = self.calls.get(key, 0) + 1

    def fetch_daily(self, ticker, max_bars=None):
        self._count("fetch_daily", ticker)
        n = 250 if max_bars is None or max_bars > 250 else max_bars
        dates = pd.date_range(end=asia_today(), periods=n, freq="D")
        return pd.DataFrame({
            "datetime": dates,
            "open": [10.0] * n, "high": [10.5] * n, "low": [9.5] * n,
            "close": [10.2] * n, "vol": [1000] * n, "amount": [1e6] * n,
        })

    def fetch_snapshot(self, ticker):
        self._count("fetch_snapshot", ticker)
        return pd.DataFrame([{"price": 10.2, "open": 10.0, "high": 10.5, "low": 9.5}])

    def fetch_finance_capital(self, ticker):
        self._count("fetch_finance_capital", ticker)
        return pd.DataFrame([{"zongguben": 1e10, "liutongguben": 1e10}])

    def fetch_company_finance(self, ticker):
        self._count("fetch_company_finance", ticker)
        return pd.DataFrame([
            {"metric": "基本每股收益(元)", "period": "2026-03-31", "value_num": 0.5},
            {"metric": "每股净资产(元)", "period": "2026-03-31", "value_num": 11.5},
            {"metric": "净利润(元)", "period": "2026-03-31", "value_num": 1e9},
        ])

    def fetch_xdxr(self, ticker):
        self._count("fetch_xdxr", ticker)
        return pd.DataFrame()


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

    # ---------- review #1：概览 freshness 门（2026-08-02） ----------
    # 专用 dummy ticker 999998（与 test_ZODBStorage 的往返用例同款约定），
    # 不触碰真实股票数据；每个用例显式设置 overview_last_update 前置条件，
    # 与共享 DB 的历史状态解耦（freshness 门的行为只取决于该字段）。

    def test_ensure_stock_skips_fresh_overview(self):
        """当日已更新 → 门未命中，零构建调用，返回同一 stock 对象（幂等）。"""
        da = DataAcquisition()
        stock = _seed_stock(da, "999998")
        stock.overview_last_update = datetime.datetime.now()
        transaction.commit()
        calls = []
        def fake_build(ticker):
            calls.append(ticker)
            return None
        assert da.ensure_stock("999998", _build_overview=fake_build) is True
        assert calls == []
        assert da.storage.get_stock("999998") is stock

    def test_ensure_stock_refreshes_stale_overview(self):
        """概览过期（overview_last_update 回拨 3 天）→ 门命中，构建恰一次。

        注入 fake builder 返回 22 列 DataFrame（OVERVIEW_COLUMNS 列序契约）→
        overview 被替换、overview_last_update 前进到当天，返回 True。
        """
        da = DataAcquisition()
        stock = _seed_stock(da, "999998", "旧名称")
        stock.overview_last_update = datetime.datetime.combine(
            asia_today() - datetime.timedelta(days=3), datetime.time(12, 0)
        )
        transaction.commit()
        calls = []
        def fake_build(ticker):
            calls.append(ticker)
            row = {col: ("999998" if col == "代码" else ("新名称" if col == "名称" else 1.0)) for col in OVERVIEW_COLUMNS}
            return pd.DataFrame([row])
        assert da.ensure_stock("999998", _build_overview=fake_build) is True
        assert calls == ["999998"]
        refreshed = da.storage.get_stock("999998")
        assert refreshed.overview.name == "新名称"
        assert refreshed.overview_last_update.date() == asia_today()

    def test_ensure_stock_keeps_old_overview_on_refresh_failure(self):
        """过期 + 构建失败（None）→ 保留旧概览，仍 True（刷新失败不阻断分析）。

        断言"概览不变"用调用前后快照比较——共享 DB 中该 ticker 的 overview
        可能被前序用例改写，不假设具体名称。
        """
        da = DataAcquisition()
        stock = _seed_stock(da, "999998", "旧名称")
        stock.overview_last_update = datetime.datetime.combine(
            asia_today() - datetime.timedelta(days=3), datetime.time(12, 0)
        )
        transaction.commit()
        name_before = stock.overview.name
        stamp_before = stock.overview_last_update
        assert da.ensure_stock("999998", _build_overview=lambda t: None) is True
        assert da.storage.get_stock("999998").overview.name == name_before
        assert da.storage.get_stock("999998").overview_last_update == stamp_before

    # ---------- review #5：ZODB 读写锁（2026-08-02） ----------

    def test_concurrent_access_safe(self):
        """两线程并发 get/mutate/commit 同一 stock：无 POSKeyError/ConflictError。

        单例 ZODB 连接非线程安全（review #5）——storage.lock 把并发访问
        串行化。无锁时该测试有概率暴露异常（不保证必现）；锁的验证 =
        测试恒绿 + test_concurrent_data_phase_serializes 的时序断言。
        """
        import threading
        da = DataAcquisition()
        _seed_stock(da, "999993")
        errors = []
        def worker():
            try:
                for _ in range(10):
                    with da.storage.lock:
                        s = da.storage.get_stock("999993")
                        s.overview_last_update = datetime.datetime.now()
                        transaction.commit()
            except Exception as e:
                errors.append(e)
        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []

    def test_concurrent_data_phase_serializes(self):
        """两线程并发跑同一股票的数据阶段：锁串行化（时序 + 无异常）。

        锁只保护 ZODB 访问段——预播种 daily（纯网络，无 ZODB）在锁外，
        两线程的预播种可重叠。慢 fetcher 放在**锁内**的 F10（业绩门对两
        线程都未命中：F10 合成数据只有 20260331，≠ 最近季度末 20260630，
        先跑线程写入不会满足后跑线程的门）：
        0.4s/次 × 2 线程 → 串行 ≥0.8s；无锁并行 ≈0.4s。断言墙钟 ≥ 0.6s
        证明锁内段串行化。
        """
        import threading
        import time
        da = DataAcquisition()
        ticker = "999993"
        stock = _seed_stock(da, ticker)
        stock.overview_last_update = datetime.datetime.combine(
            asia_today() - datetime.timedelta(days=3), datetime.time(12, 0)
        )
        stock.last_data_update = asia_today() - datetime.timedelta(days=3)
        transaction.commit()
        errors = []
        def worker():
            try:
                fake = _CountingSrc()
                orig = fake.fetch_company_finance
                def slow_f10(t):
                    time.sleep(0.4)
                    return orig(t)
                fake.fetch_company_finance = slow_f10
                da.get_stock_data(ticker, _scope=FetchScope(fake))
            except Exception as e:
                errors.append(e)
        start = time.monotonic()
        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        elapsed = time.monotonic() - start
        assert errors == []
        assert elapsed >= 0.6, f"expected serialized locked section (~0.8s), got {elapsed:.1f}s"

    # ---------- review #2+#3：单遍拉取（2026-08-02） ----------

    def test_acquire_performance_report_tdx_missing_stock_returns_false(self):
        da = DataAcquisition()
        _seed_stock(da, "000001")
        assert da.acquire_performance_report_tdx("999999") is False

    def test_get_stock_data_first_build_fetches_each_source_once(self):
        """首建（storage 无该股）：5 源各恰一次。

        daily 全量预拉（get_stock_data 首建分支）覆盖 overview 250 窗口与
        history 全量回填；capital/f10 被 overview 与 history/reports 共享
        ——旧实现为 daily/capital/f10 各 2 次。

        前置条件：先删除 999996——共享 DB 持久化跨运行，前次运行的构建会
        让本用例变成"已有股票"路径（门判定随状态漂移），删除后首建语义
        确定。
        """
        da = DataAcquisition()
        ticker = "999996"  # 专用 dummy（999996 非 BJ 前缀，TDX 符号域外）
        if da.storage.get_stock(ticker) is not None:
            del da.storage.root.stocks[ticker]
            transaction.commit()
        fake = _CountingSrc()
        scope = FetchScope(fake)
        assert da.get_stock_data(ticker, _scope=scope) is not None
        assert fake.calls.get(("fetch_daily", ticker), 0) == 1
        assert fake.calls.get(("fetch_snapshot", ticker), 0) == 1
        assert fake.calls.get(("fetch_finance_capital", ticker), 0) == 1
        assert fake.calls.get(("fetch_company_finance", ticker), 0) == 1
        assert fake.calls.get(("fetch_xdxr", ticker), 0) == 1

    def test_get_stock_data_existing_stock_stale_gates_each_source_once(self):
        """已有股票 + 概览/历史双 stale：各源仍恰一次（预播种 250 覆盖）。"""
        da = DataAcquisition()
        ticker = "999995"
        stock = _seed_stock(da, ticker)
        stock.overview_last_update = datetime.datetime.combine(
            asia_today() - datetime.timedelta(days=3), datetime.time(12, 0)
        )
        stock.last_data_update = asia_today() - datetime.timedelta(days=3)
        transaction.commit()
        fake = _CountingSrc()
        scope = FetchScope(fake)
        assert da.get_stock_data(ticker, _scope=scope) is not None
        assert fake.calls.get(("fetch_daily", ticker), 0) == 1
        assert fake.calls.get(("fetch_snapshot", ticker), 0) == 1
        assert fake.calls.get(("fetch_finance_capital", ticker), 0) == 1
        assert fake.calls.get(("fetch_company_finance", ticker), 0) == 1
        assert fake.calls.get(("fetch_xdxr", ticker), 0) == 1

    def test_get_stock_data_fresh_gates_zero_fetch(self):
        """概览/历史/业绩三门全 fresh（含最新季度报告）：零拉取（纯门短路）。"""
        da = DataAcquisition()
        ticker = "999994"
        stock = _seed_stock(da, ticker)
        stock.overview_last_update = datetime.datetime.now()
        stock.last_data_update = asia_today()
        _seed_report(stock, "20260630")  # 最近季度末（2026-08-02 → 0630）
        transaction.commit()
        fake = _CountingSrc()
        scope = FetchScope(fake)
        assert da.get_stock_data(ticker, _scope=scope) is not None
        assert fake.calls.get(("fetch_daily", ticker), 0) == 0
        assert fake.calls.get(("fetch_snapshot", ticker), 0) == 0
        assert fake.calls.get(("fetch_finance_capital", ticker), 0) == 0
        assert fake.calls.get(("fetch_company_finance", ticker), 0) == 0
        assert fake.calls.get(("fetch_xdxr", ticker), 0) == 0

    def test_acquire_performance_report_tdx(self):
        da = DataAcquisition()
        stock = _seed_stock(da, "000001", "平安银行")
        assert da.acquire_performance_report_tdx("000001") is True
        reports = stock.get_performance_reports()
        # F10 可达 → 应有报告；不可达（build_reports None 降级）→ 0 份且不报错
        if build_reports("000001") is not None:
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
        if build_reports("000001") is not None:
            assert len(stock.get_performance_reports()) > 0

    def test_get_stock_data_none_when_overview_unavailable(self):
        """ensure_stock 失败（无任何价格来源，overview 构建 None）→
        get_stock_data 返回 None（纯 TDX 无 akshare 兜底契约，
        error-handling spec；`get_company_info` 的 'Stock not found' 由此触发）。

        注入（house style 无 mock 框架）：模块函数 `_build_overview_module`
        属性交换返回 None（ensure_stock 默认 lambda 调用时经模块全局解析，
        补丁生效）+ `_CountingSrc` scope（预播种不触网）。前置：删除专用
        dummy 999997——跨运行确定性（首建路径）。
        """
        import core.data_acquisition as da_module
        da = DataAcquisition()
        ticker = "999997"  # 专用 dummy（非 BJ 前缀，TDX 符号域外）
        if da.storage.get_stock(ticker) is not None:
            del da.storage.root.stocks[ticker]
            transaction.commit()
        fake = _CountingSrc()
        scope = FetchScope(fake)
        orig = da_module._build_overview_module
        da_module._build_overview_module = lambda t, _scope=None: None
        try:
            assert da.get_stock_data(ticker, _scope=scope) is None
        finally:
            da_module._build_overview_module = orig

    # ---------- 业绩报告 freshness 门（08-02-fix-report-freshness-gate） ----------
    # 门判定：ZODB 最新 report_date == 最近季度末（今天 2026-08-02 → '20260630'）
    # → 跳过远端 F10。验证方式（house style 无 mock 框架）：acquire_performance
    # _report_tdx 的 _fetch_reports 注入点传计数包装——门命中时包装不被调用即
    # 证明无 F10 网络。门未命中用例的包装返回 None（离线确定性：拉取路径进入
    # 即可，F10 可达性不影响断言）。每个用例用独立专用 ticker（600000 浦发银行
    # live / 600001 / 600002 离线），不触碰既有 000001 用例，seed 注入的报告
    # 也不互相污染；报告数断言用"相对 seed 前后"而非绝对值（共享 DB，上次
    # 运行可能已入库）。

    def test_performance_report_gate_skips_fetch_when_latest_quarter_seeded(self):
        """门命中：最新 report_date == 最近季度截止日 → build_reports 不被调用。"""
        da = DataAcquisition()
        stock = _seed_stock(da, "600000", "浦发银行")
        _seed_report(stock, "20260630")
        len_before = len(stock.get_performance_reports())
        calls = []

        def fake_fetch(t):
            calls.append(t)
            return build_reports(t)

        assert da.acquire_performance_report_tdx("600000", _fetch_reports=fake_fetch) is True
        assert calls == []  # 门跳过：无 F10 网络访问
        assert len(stock.get_performance_reports()) == len_before  # 不新增

    def test_performance_report_gate_miss_when_no_reports(self):
        """门未命中（无报告）→ 正常走拉取路径（_fetch_reports 被调一次）。

        专用 ticker 600001（离线，fake 返回 None 不触网），与 600000 用例
        （种子注入 '20260630'）互不污染。
        """
        da = DataAcquisition()
        stock = _seed_stock(da, "600001", "测试")
        len_before = len(stock.get_performance_reports())
        calls = []

        def fake_fetch(t):
            calls.append(t)
            return None  # 模拟 F10 拉取失败/无报告降级

        assert da.acquire_performance_report_tdx("600001", _fetch_reports=fake_fetch) is True
        assert calls == ["600001"]  # 拉取路径进入
        assert len(stock.get_performance_reports()) == len_before  # None 降级：不入库不报错

    def test_performance_report_gate_miss_when_old_report_only(self):
        """门未命中（最新期早于最近季度）→ 正常拉取；旧期不被破坏/重复。

        专用 ticker 600002（离线，fake 返回 None 不触网），与 600000/600001
        用例互不污染。
        """
        da = DataAcquisition()
        stock = _seed_stock(da, "600002", "测试")
        _seed_report(stock, "20250331")  # 上一季（中报未披露语义）
        len_before = len(stock.get_performance_reports())
        calls = []

        def fake_fetch(t):
            calls.append(t)
            return None

        assert da.acquire_performance_report_tdx("600002", _fetch_reports=fake_fetch) is True
        assert calls == ["600002"]
        assert len(stock.get_performance_reports()) == len_before
        assert stock.get_performance_reports()[-1].report_date == "20250331"

    def test_performance_report_gate_live_double_call(self):
        """live：连续两次调用——首拉后最新期入库 → 第二次门命中不再拉 F10。

        先注入旧报告期 '20250331' 保证首拉必走远端（门未命中，calls == 1）；
        第二次是否命中取决于 F10 是否已披露 2026 中报：披露 → 门命中
        （calls 仍 1，最新 report_date == '20260630'）；未披露/TDX 不可达 →
        仍拉（calls == 2）——均为 prd 披露滞后语义的合法结果。
        """
        da = DataAcquisition()
        stock = _seed_stock(da, "600000", "浦发银行")
        _seed_report(stock, "20250331")
        calls = []

        def fake_fetch(t):
            calls.append(t)
            return build_reports(t)

        assert da.acquire_performance_report_tdx("600000", _fetch_reports=fake_fetch) is True
        assert len(calls) == 1  # 旧报告期 → 门未命中，首拉必走远端
        assert da.acquire_performance_report_tdx("600000", _fetch_reports=fake_fetch) is True
        if len(calls) == 1:
            # 第二次未再拉 → 2026 中报已入库，门命中
            assert stock.get_performance_reports()[-1].report_date == "20260630"
        else:
            assert len(calls) == 2

    # ---------- 08-09：ZODB 单事务（3 条 get→mutate→put 链） ----------
    # mutator 链上调用传 commit=False，由 put_stock 一次 commit 持久化——
    # 首建/刷新/历史/业绩各 1 次 commit（原 add_datas/update_overview/
    # add_performance_reports 内部 commit + put_stock commit = 2 次）。
    # 计数注入 monkeypatch transaction.commit（测试内 try/finally 保存恢复，
    # house style 不用 pytest fixture）。ticker 用专用 dummy，前置条件显式
    # 设置（共享 DB 跨运行持久化，见 testing spec）。

    def _commit_counter(self):
        calls = []
        orig_commit = transaction.commit

        def counting():
            calls.append(1)
            orig_commit()

        transaction.commit = counting
        return calls, orig_commit

    def _synthetic_report_rows(self, ticker, report_date="20260630"):
        """15 列 StockPerformanceReport 恒等路径合成 DataFrame（from_row 按列名）。"""
        return pd.DataFrame([{
            "ticker": ticker, "name": "测试",
            "eps": 0.5, "total_income": 1e9, "total_income_YoY_rate": 1.0,
            "total_income_QoQ_rate": 1.0, "net_profit": 1e8,
            "net_profit_YoY_rate": 1.0, "net_profit_QoQ_rate": 1.0,
            "net_worth_per_share": 5.0, "net_worth_return_rate": 5.0,
            "cash_flow_per_share": 1.0, "sales_gross_margin": 10.0,
            "industry": "", "report_date": report_date,
        }])

    def test_ensure_stock_first_build_single_commit(self):
        """首建：put_stock 一次 commit 完成 构建 + 入仓（无 mutator 内部提交）。"""
        da = DataAcquisition()
        ticker = "999991"
        if da.storage.get_stock(ticker) is not None:
            del da.storage.root.stocks[ticker]
            transaction.commit()
        calls, orig_commit = self._commit_counter()
        try:
            def fake_build(t):
                row = {col: (ticker if col == "代码" else ("测试" if col == "名称" else 1.0)) for col in OVERVIEW_COLUMNS}
                return pd.DataFrame([row])
            assert da.ensure_stock(ticker, _build_overview=fake_build) is True
        finally:
            transaction.commit = orig_commit
        assert len(calls) == 1
        assert da.storage.get_stock(ticker).overview.ticker == ticker

    def test_ensure_stock_refresh_single_commit(self):
        """刷新路径：update_overview(commit=False) + put_stock = 1 次 commit。"""
        da = DataAcquisition()
        stock = _seed_stock(da, "999991", "旧名称")
        stock.overview_last_update = datetime.datetime.combine(
            asia_today() - datetime.timedelta(days=3), datetime.time(12, 0)
        )
        transaction.commit()
        calls, orig_commit = self._commit_counter()
        try:
            def fake_build(t):
                row = {col: (t if col == "代码" else ("新名称" if col == "名称" else 1.0)) for col in OVERVIEW_COLUMNS}
                return pd.DataFrame([row])
            assert da.ensure_stock("999991", _build_overview=fake_build) is True
        finally:
            transaction.commit = orig_commit
        assert len(calls) == 1
        assert da.storage.get_stock("999991").overview.name == "新名称"

    def test_acquire_historical_data_tdx_single_commit(self):
        """历史链：add_datas(commit=False) + put_stock = 1 次 commit（原 2 次）。"""
        da = DataAcquisition()
        stock = _seed_stock(da, "999990")
        stock.last_data_update = asia_today() - datetime.timedelta(days=10)
        transaction.commit()
        fake = _CountingSrc()
        calls, orig_commit = self._commit_counter()
        try:
            assert da.acquire_historical_data_tdx("999990", _scope=FetchScope(fake)) is True
        finally:
            transaction.commit = orig_commit
        assert len(calls) == 1
        assert len(stock.get_datas()) > 0  # mutate 已随 put_stock 事务持久化

    def test_acquire_performance_report_tdx_single_commit(self):
        """业绩链：add_performance_reports(commit=False) + put_stock = 1 次 commit。

        前置条件：先删除 999989——共享 DB 跨运行持久化，前次运行已写入的
        '20260630' 报告会让业绩门命中跳过拉取（0 commit），删除后门必未命中
        走拉取路径，确定性成立。
        """
        da = DataAcquisition()
        ticker = "999989"
        if da.storage.get_stock(ticker) is not None:
            del da.storage.root.stocks[ticker]
            transaction.commit()
        stock = _seed_stock(da, ticker)
        calls, orig_commit = self._commit_counter()
        try:
            assert da.acquire_performance_report_tdx(
                ticker, _fetch_reports=lambda t: self._synthetic_report_rows(t)
            ) is True
        finally:
            transaction.commit = orig_commit
        assert len(calls) == 1
        assert len(stock.get_performance_reports()) == 1
