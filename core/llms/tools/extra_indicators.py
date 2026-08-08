"""新增技术指标模块（08-08-technical-indicator-analyst）。

MACD-VH（Spiroglou 波动率归一化 MACD，SSRN #4099617）与刘晨明乖离率
（广发证券策略首席刘晨明，ln 与 20 日 EMA 偏离）。公式与研究来源见
.trellis/tasks/08-08-technical-indicator-analyst/research/indicators-macd-vh-liu-bias.md。

约束：vendor（data_source/.../tdx/vendor/，tdx_quant 快照 b95d8e9）零改动
（VENDOR.md 严禁与上游静默分叉）——复用 vendor 参数化 calc_ema / calc_atr，
只 import 不修改。本模块与本仓库代码同源，可自由演进。

约定（对齐 error-handling spec）：返回 pandas 序列，不 raise；调用方
（get_trend_indicators）负责占位降级。
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from data_source.chinese_mainland.tdx.tdx_source import ensure_vendor_on_path

ensure_vendor_on_path()
from scripts.data_pipeline.indicators.trend import calc_ema  # noqa: E402
from scripts.data_pipeline.indicators.volatility import calc_atr  # noqa: E402

# MACD-VH 动量生命周期阈值（Spiroglou 原文）：±50 震荡区界 / ±150 风险区界。
# ±100 稀有信号与 ±200 极端阈值语义较宽，快照行只用 5 区简化；完整解读在
# prompt（analyst 的知识层）。
_OVERBOUGHT = 150
_STRONG = 50
_WEAK = -50
_OVERSOLD = -150


def calc_macd_vh(
    df: pd.DataFrame,
    fast: int = 12,
    slow: int = 26,
    atr_len: int = 26,
    signal: int = 9,
) -> pd.DataFrame:
    """MACD-VH 三列（全序列）：MACD_V / SIGNAL / MACD_VH。

    MACD-V  = (EMA12 − EMA26) / ATR26 × 100  —— 波动率归一化动量，×100 使
    阈值（±50/±150）成立；SIGNAL = EMA9(MACD-V)；VH = MACD-V − SIGNAL。
    ATR 为 0（一字板等极端）时 MACD_V 置 NaN（fmt_number 渲染 N/A，避免
    除零 inf 进入 LLM 上下文）。
    """
    ema_fast = calc_ema(df, (fast,), column="close")[f"EMA{fast}"]
    ema_slow = calc_ema(df, (slow,), column="close")[f"EMA{slow}"]
    atr = calc_atr(df, atr_len)
    macd_v = np.where(atr > 0, (ema_fast - ema_slow) / atr * 100, np.nan)
    macd_v = pd.Series(macd_v, index=df.index, name="MACD_V")
    signal = macd_v.ewm(span=signal, adjust=False).mean().rename("SIGNAL")
    vh = (macd_v - signal).rename("MACD_VH")
    return pd.DataFrame({"MACD_V": macd_v, "SIGNAL": signal, "MACD_VH": vh})


def calc_liu_bias(df: pd.DataFrame, n: int = 20) -> pd.Series:
    """刘晨明乖离率：ln(close) − ln(EMA n)——对数化使数据平稳、不受绝对
    价格影响（旧版除法式对低价标的敏感已弃用）。
    """
    ema = calc_ema(df, (n,), column="close")[f"EMA{n}"]
    bias = (np.log(df["close"]) - np.log(ema)).rename("LIU_BIAS")
    return bias


def macd_vh_state(vh: float, prev_vh: float) -> str:
    """柱态四色语义：正扩张（>0 且放大）/ 正衰减（>0 且缩小）/ 负扩张
    （<0 且更负）/ 负衰减（<0 且回升）。输入 NaN → "N/A"。
    """
    if vh is None or prev_vh is None or pd.isna(vh) or pd.isna(prev_vh):
        return "N/A"
    if vh > 0:
        return "正扩张" if vh > prev_vh else "正衰减"
    return "负扩张" if vh < prev_vh else "负衰减"


def momentum_zone(macd_v: float) -> str:
    """动量区（5 区简化）：超买>150 / 强势50~150 / 震荡-50~50 / 弱势
    -150~-50 / 超卖<-150。NaN → "N/A"。
    """
    if macd_v is None or pd.isna(macd_v):
        return "N/A"
    if macd_v > _OVERBOUGHT:
        return "超买"
    if macd_v > _STRONG:
        return "强势"
    if macd_v > _WEAK:
        return "震荡"
    if macd_v > _OVERSOLD:
        return "弱势"
    return "超卖"
