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
