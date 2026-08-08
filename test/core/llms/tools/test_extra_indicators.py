"""extra_indicators 测试：MACD-VH 与刘晨明乖离率公式 + 柱态/动量区判定。

纯 pandas 计算（无网络/ZODB）——手算样例钉死公式接线（vendor 内部数学
属上游范围，这里验证本模块的组合逻辑）；辅助函数直接测四态/五区边界。
"""

import math

import pandas as pd
import pytest

from core.llms.tools.extra_indicators import (
    calc_liu_bias,
    calc_macd_vh,
    macd_vh_state,
    momentum_zone,
)


def _df(closes, *, spread=0.05, n_rows=None):
    """构造 OHLCV 帧：close 可指定，high/low 围绕 close ± spread。"""
    closes = list(closes)
    n = n_rows or len(closes)
    return pd.DataFrame(
        {
            "datetime": pd.date_range("2026-01-01", periods=n, freq="B"),
            "open": closes,
            "high": [c + spread for c in closes],
            "low": [c - spread for c in closes],
            "close": closes,
            "vol": [1000.0] * n,
        }
    )


class TestCalcMacdVh:

    def test_constant_close_with_range_yields_zero(self):
        # close 恒定 → EMA12 == EMA26 → MACD=0；high/low 有振幅 → ATR>0
        # （除零保护不触发）→ MACD_V / SIGNAL / VH 全 0
        df = _df([10.0] * 30)
        out = calc_macd_vh(df)
        assert abs(out["MACD_V"].iloc[-1]) < 1e-9
        assert abs(out["SIGNAL"].iloc[-1]) < 1e-9
        assert abs(out["MACD_VH"].iloc[-1]) < 1e-9

    def test_flat_series_guard_against_zero_atr(self):
        # 一字板（high == low == close）→ ATR=0 → MACD_V 置 NaN 不除零出 inf
        df = _df([10.0] * 30, spread=0.0)
        out = calc_macd_vh(df)
        assert pd.isna(out["MACD_V"].iloc[-1])
        assert pd.isna(out["MACD_VH"].iloc[-1])

    def test_monotonic_uptrend_positive_momentum(self):
        # 单调上涨：短 EMA 高于长 EMA → MACD>0；ATR>0 → MACD_V>0；
        # MACD_V 上行 → 信号线滞后 → VH>0
        df = _df([10.0 + 0.1 * i for i in range(30)])
        out = calc_macd_vh(df)
        assert out["MACD_V"].iloc[-1] > 0
        assert out["MACD_VH"].iloc[-1] > 0


class TestCalcLiuBias:

    def test_constant_close_zero_bias(self):
        df = _df([10.0] * 30)
        bias = calc_liu_bias(df)
        assert abs(bias.iloc[-1]) < 1e-9

    def test_uptrend_positive_bias(self):
        # 上涨后现价高于 20 日 EMA → ln 偏离 > 0
        df = _df([10.0 + 0.1 * i for i in range(30)])
        bias = calc_liu_bias(df)
        assert bias.iloc[-1] > 0

    def test_formula_ln_close_minus_ln_ema(self):
        # 公式钉死：ln(close) − ln(EMA20)（与 pandas 同口径手算对照）
        df = _df([10.0 + 0.1 * i for i in range(30)])
        ema20 = df["close"].ewm(span=20, adjust=False).mean()
        expected = math.log(df["close"].iloc[-1]) - math.log(ema20.iloc[-1])
        assert abs(calc_liu_bias(df).iloc[-1] - expected) < 1e-9


class TestMacdVhState:

    @pytest.mark.parametrize(
        "vh, prev, expected",
        [
            (0.5, 0.2, "正扩张"),   # >0 且放大
            (0.2, 0.5, "正衰减"),   # >0 且缩小
            (-0.5, -0.2, "负扩张"),  # <0 且更负
            (-0.2, -0.5, "负衰减"),  # <0 且回升
            (0.0, -0.1, "负衰减"),   # 0 退化态：钉死行为
            (float("nan"), 0.1, "N/A"),
            (0.1, float("nan"), "N/A"),
        ],
    )
    def test_four_states_and_nan(self, vh, prev, expected):
        assert macd_vh_state(vh, prev) == expected


class TestMomentumZone:

    @pytest.mark.parametrize(
        "value, expected",
        [
            (160.0, "超买"),
            (150.0, "强势"),   # 边界：150 不超买
            (100.0, "强势"),
            (50.0, "震荡"),    # 边界：50 不强势
            (0.0, "震荡"),
            (-50.0, "弱势"),   # 边界：-50 不震荡
            (-100.0, "弱势"),
            (-150.0, "超卖"),  # 边界：-150 不弱势
            (-160.0, "超卖"),
            (float("nan"), "N/A"),
        ],
    )
    def test_zones_and_boundaries(self, value, expected):
        assert momentum_zone(value) == expected
