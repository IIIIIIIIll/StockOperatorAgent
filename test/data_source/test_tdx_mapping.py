"""离线测试：mapping / adjust 层的列序契约与 qfq 算法。

对齐 data_source spec 的列序耦合约定：输出 12 列必须与 akshare
stock_zh_a_hist 完全一致，保证 ChinaStockData(*list(row.values())) 位置构造正确。
"""

from datetime import date

import numpy as np
import pandas as pd
import pytest

from data_source.chinese_mainland.tdx.adjust import qfq_adjust
from data_source.chinese_mainland.tdx.mapping import (
    AKSHARE_HIST_COLUMNS,
    to_akshare_hist_schema,
)


def _make_bars(rows):
    """构造 pytdx 风格日K DataFrame（tdx_quant bars_to_dataframe 输出形状）。"""
    df = pd.DataFrame(rows)
    df["datetime"] = pd.to_datetime(df["datetime"])
    df["market"] = 0
    df["code"] = "000001"
    df["ts_code"] = "000001.SZ"
    df["trade_date"] = df["datetime"].dt.strftime("%Y%m%d")
    return df


class TestToAkshareHistSchema:
    def test_column_order_matches_akshare(self):
        bars = _make_bars([
            {"datetime": "2026-07-28", "open": 11.0, "high": 11.5, "low": 10.9,
             "close": 11.2, "vol": 1000000.0, "amount": 1.12e9},
            {"datetime": "2026-07-29", "open": 11.3, "high": 11.6, "low": 11.1,
             "close": 11.4, "vol": 1200000.0, "amount": 1.37e9},
        ])
        out = to_akshare_hist_schema(bars, "000001")
        assert list(out.columns) == AKSHARE_HIST_COLUMNS

    def test_positional_values_align_with_dataclass_fields(self):
        # 12 列的值必须能直接喂给 ChinaStockData 位置构造
        bars = _make_bars([
            {"datetime": "2026-07-28", "open": 10.0, "high": 10.6, "low": 9.9,
             "close": 10.3, "vol": 2000000.0, "amount": 2.06e9},
            {"datetime": "2026-07-29", "open": 10.4, "high": 10.8, "low": 10.2,
             "close": 10.6, "vol": 2200000.0, "amount": 2.32e9},
        ])
        out = to_akshare_hist_schema(bars, "000001")
        first = list(out.iloc[0].values)
        # 日期（datetime.date 对象，契约见 mapping docstring）/代码/OHLC/成交量/成交额
        assert first[:8] == [date(2026, 7, 28), "000001", 10.0, 10.3, 10.6, 9.9, 2000000, 2.06e9]
        # 振幅 = (high-low)/prev_close 首行无前收盘 → NaN
        assert np.isnan(first[8])
        # 涨跌幅/涨跌额 首行 NaN
        assert np.isnan(first[9]) and np.isnan(first[10])
        # 换手率 = vol*100/float_shares*100
        second = list(out.iloc[1].values)
        assert second[8] == pytest.approx((10.8 - 10.2) / 10.3 * 100)
        assert second[9] == pytest.approx((10.6 - 10.3) / 10.3 * 100)
        assert second[10] == pytest.approx(10.6 - 10.3)

    def test_turnover_rate_with_float_shares(self):
        bars = _make_bars([
            {"datetime": "2026-07-28", "open": 10.0, "high": 10.6, "low": 9.9,
             "close": 10.3, "vol": 2000000.0, "amount": 2.06e9},
        ])
        # 流通股本 1 亿股：换手率 = 2,000,000手*100 / 1e8 * 100 = 200%
        out = to_akshare_hist_schema(bars, "000001", float_shares=1e8)
        assert out.iloc[0]["换手率"] == pytest.approx(200.0)

    def test_turnover_rate_nan_without_float_shares(self):
        bars = _make_bars([
            {"datetime": "2026-07-28", "open": 10.0, "high": 10.6, "low": 9.9,
             "close": 10.3, "vol": 2000000.0, "amount": 2.06e9},
        ])
        out = to_akshare_hist_schema(bars, "000001")
        assert np.isnan(out.iloc[0]["换手率"])

    def test_ticker_suffix_stripped(self):
        bars = _make_bars([
            {"datetime": "2026-07-28", "open": 10.0, "high": 10.6, "low": 9.9,
             "close": 10.3, "vol": 2000000.0, "amount": 2.06e9},
        ])
        out = to_akshare_hist_schema(bars, "600000")
        assert out.iloc[0]["股票代码"] == "600000"


class TestQfqAdjust:
    def test_no_events_is_identity(self):
        bars = _make_bars([
            {"datetime": "2026-07-28", "open": 10.0, "high": 10.6, "low": 9.9,
             "close": 10.3, "vol": 2000000.0, "amount": 2.06e9},
            {"datetime": "2026-07-29", "open": 10.4, "high": 10.8, "low": 10.2,
             "close": 10.6, "vol": 2200000.0, "amount": 2.32e9},
        ])
        out = to_akshare_hist_schema(bars, "000001")
        adjusted = qfq_adjust(out, pd.DataFrame())
        pd.testing.assert_frame_equal(adjusted, out)

    def test_cash_dividend_adjusts_prices_before_event(self):
        bars = _make_bars([
            {"datetime": "2026-07-01", "open": 10.0, "high": 10.6, "low": 9.9,
             "close": 10.3, "vol": 2000000.0, "amount": 2.06e9},
            {"datetime": "2026-07-02", "open": 10.4, "high": 10.8, "low": 10.2,
             "close": 10.6, "vol": 2200000.0, "amount": 2.33e9},
        ])
        # 7/2 除息（每股分红 0.3 元，每10股派3.0元）：prev_close = 事件日前最后
        # 一根 bar 的未复权收盘（7/1 = 10.3）→ 理论除权价 10.0 → 7/1 价格按
        # (10.3-0.3)/10.3 = 0.97087 缩放；7/2（除权日 bar）不调整
        xdxr = pd.DataFrame([
            {"trade_date": "20260702", "fenhong": 3.0, "songzhuangu": 0.0,
             "peigu": 0.0, "peigujia": 0.0, "suogu": None},
        ])
        out = to_akshare_hist_schema(bars, "000001")
        adjusted = qfq_adjust(out, xdxr)
        ratio = (10.3 - 0.3) / 10.3
        assert adjusted.iloc[0]["收盘"] == pytest.approx(10.3 * ratio)
        # 事件日（含）之后不调整
        assert adjusted.iloc[1]["收盘"] == pytest.approx(10.6)
        # 成交量不变（纯现金分红不改股本）
        assert adjusted.iloc[0]["成交量"] == 2000000

    def test_bonus_shares_adjust_volume(self):
        bars = _make_bars([
            {"datetime": "2026-07-01", "open": 10.0, "high": 10.6, "low": 9.9,
             "close": 10.3, "vol": 2000000.0, "amount": 2.06e9},
            {"datetime": "2026-07-02", "open": 10.4, "high": 10.8, "low": 10.2,
             "close": 10.6, "vol": 2200000.0, "amount": 2.33e9},
        ])
        # 7/2 每 10 股送 2 股 → 7/1 价格除以 1.2，成交量乘以 1.2
        xdxr = pd.DataFrame([
            {"trade_date": "20260702", "fenhong": 0.0, "songzhuangu": 2.0,
             "peigu": 0.0, "peigujia": 0.0, "suogu": None},
        ])
        out = to_akshare_hist_schema(bars, "000001")
        adjusted = qfq_adjust(out, xdxr)
        assert adjusted.iloc[0]["收盘"] == pytest.approx(10.3 / 1.2)
        assert adjusted.iloc[0]["成交量"] == pytest.approx(2000000 * 1.2)
        assert adjusted.iloc[1]["收盘"] == pytest.approx(10.6)

    def test_metrics_recomputed_after_adjustment(self):
        bars = _make_bars([
            {"datetime": "2026-07-01", "open": 10.0, "high": 10.6, "low": 9.9,
             "close": 10.3, "vol": 2000000.0, "amount": 2.06e9},
            {"datetime": "2026-07-02", "open": 10.4, "high": 10.8, "low": 10.2,
             "close": 10.6, "vol": 2200000.0, "amount": 2.33e9},
        ])
        # 除息 0.3 元：复权后 7/2 相对 7/1 的涨跌幅应基于复权价
        xdxr = pd.DataFrame([
            {"trade_date": "20260702", "fenhong": 3.0, "songzhuangu": 0.0,
             "peigu": 0.0, "peigujia": 0.0, "suogu": None},
        ])
        out = to_akshare_hist_schema(bars, "000001")
        adjusted = qfq_adjust(out, xdxr)
        adj_prev = adjusted.iloc[0]["收盘"]
        assert adjusted.iloc[1]["涨跌幅"] == pytest.approx((10.6 - adj_prev) / adj_prev * 100)

    def test_events_before_window_are_ignored(self):
        bars = _make_bars([
            {"datetime": "2026-07-01", "open": 10.0, "high": 10.6, "low": 9.9,
             "close": 10.3, "vol": 2000000.0, "amount": 2.06e9},
        ])
        # 事件日在所有 bar 之前（窗口外）→ 无 bar 可调整
        xdxr = pd.DataFrame([
            {"trade_date": "20200101", "fenhong": 1.0, "songzhuangu": 0.0,
             "peigu": 0.0, "peigujia": 0.0, "suogu": None},
        ])
        out = to_akshare_hist_schema(bars, "000001")
        adjusted = qfq_adjust(out, xdxr)
        assert adjusted.iloc[0]["收盘"] == pytest.approx(10.3)

    def test_songgu_legacy_field_name(self):
        # 兼容旧版字段名 songgu（每10股单位）
        bars = _make_bars([
            {"datetime": "2026-07-01", "open": 10.0, "high": 10.6, "low": 9.9,
             "close": 10.3, "vol": 2000000.0, "amount": 2.06e9},
            {"datetime": "2026-07-02", "open": 10.4, "high": 10.8, "low": 10.2,
             "close": 10.6, "vol": 2200000.0, "amount": 2.33e9},
        ])
        xdxr = pd.DataFrame([
            {"trade_date": "20260702", "fenhong": 0.0, "songgu": 2.0,
             "peigu": 0.0, "peigujia": 0.0, "suogu": None},
        ])
        out = to_akshare_hist_schema(bars, "000001")
        adjusted = qfq_adjust(out, xdxr)
        assert adjusted.iloc[0]["收盘"] == pytest.approx(10.3 / 1.2)
