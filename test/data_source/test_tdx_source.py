"""TdxSource live smoke 测试：调用真实 pytdx 服务器（对标 test_akshare 风格）。

需要网络可达通达信行情服务器（多服务器 fallback，个别超时属正常）。
"""

from data_source.chinese_mainland.tdx.mapping import AKSHARE_HIST_COLUMNS
from data_source.chinese_mainland.tdx.tdx_source import TdxSource


class TestTdxSource:

    def test_fetch_daily_returns_raw_bars(self):
        df = TdxSource().fetch_daily("000001")
        assert len(df) > 0
        for col in ["datetime", "open", "high", "low", "close", "vol", "amount"]:
            assert col in df.columns

    def test_fetch_xdxr_returns_events(self):
        df = TdxSource().fetch_xdxr("000001")
        assert len(df) > 0
        for col in ["trade_date", "fenhong", "songzhuangu"]:
            assert col in df.columns

    def test_fetch_finance_capital_has_float_shares(self):
        df = TdxSource().fetch_finance_capital("000001")
        assert len(df) == 1
        assert "liutongguben" in df.columns
        assert df.iloc[0]["liutongguben"] > 0

    def test_fetch_daily_invalid_code_raises(self):
        # 非法代码 → 上游 ValueError；薄包装不吞异常，由 DataAcquisition 兜底
        try:
            TdxSource().fetch_daily("999999")
            raised = False
        except ValueError:
            raised = True
        assert raised

    def test_full_pipeline_columns_match_akshare(self):
        # mapping + qfq 全链路：12 列序与 akshare 一致
        from data_source.chinese_mainland.tdx.adjust import qfq_adjust
        from data_source.chinese_mainland.tdx.mapping import to_akshare_hist_schema

        src = TdxSource()
        daily = src.fetch_daily("000001", max_bars=130)
        xdxr = src.fetch_xdxr("000001")
        capital = src.fetch_finance_capital("000001")
        float_shares = float(capital["liutongguben"].iloc[0])
        mapped = to_akshare_hist_schema(daily, "000001", float_shares=float_shares)
        adjusted = qfq_adjust(mapped, xdxr)
        assert list(adjusted.columns) == AKSHARE_HIST_COLUMNS
        assert len(adjusted) == len(daily)
        assert adjusted.iloc[-1]["收盘"] > 0
        assert adjusted.iloc[-1]["换手率"] > 0


class TestGetTdxSourceSingleton:
    """get_tdx_source 进程级懒单例（08-09）：幂等 + TdxDownloader 只构造一次。

    生产链路收敛点：单次分析（get_stock_data 全链路）经单例只构造一次
    TdxDownloader。house style 注入点——测试内 try/finally 保存恢复模块级
    _instance / TdxDownloader（不用 pytest fixture/mock 框架）；恢复后不影响
    其他用例（TdxSource() 直接构造仍可用）。
    """

    def test_returns_same_instance(self):
        from data_source.chinese_mainland.tdx import tdx_source as tdx_module
        saved = tdx_module._instance
        tdx_module._instance = None
        try:
            first = tdx_module.get_tdx_source()
            second = tdx_module.get_tdx_source()
            assert first is second
            assert isinstance(first, TdxSource)
        finally:
            tdx_module._instance = saved

    def test_constructs_tdx_downloader_once(self):
        from data_source.chinese_mainland.tdx import tdx_source as tdx_module
        saved = tdx_module._instance
        saved_downloader = tdx_module.TdxDownloader
        constructions = []

        class CountingDownloader:
            def __init__(self, *args, **kwargs):
                constructions.append(args)

        tdx_module._instance = None
        tdx_module.TdxDownloader = CountingDownloader
        try:
            first = tdx_module.get_tdx_source()
            second = tdx_module.get_tdx_source()
            assert first is second
            # 二次调用不重建：TdxDownloader 只在单例内构造一次
            assert len(constructions) == 1
        finally:
            tdx_module._instance = saved
            tdx_module.TdxDownloader = saved_downloader
