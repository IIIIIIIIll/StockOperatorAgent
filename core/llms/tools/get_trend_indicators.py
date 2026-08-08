"""技术指标工具：把 ZODB 中的日K数据转换为通达信口径指标摘要文本。

数据链：ZODB ChinaStockData（TDX/akshare 路径写入）→ DataFrame(ohlcv)
→ vendor compute_all（MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比，通达信口径）
→ 最近一根 bar 的中文摘要，供 agent 阅读。

约定（对齐 error-handling spec）：失败不 raise，返回占位文本（图可继续）。
换手率需要流通股本（TdxSource.fetch_finance_capital），此处不重复拉取，
值为 NaN 时显示 N/A——如需精确换手率请走 M1 路径的 float_shares 参数。
"""

from __future__ import annotations

import pandas as pd

from core.data_acquisition import DataAcquisition
from core.llms.tools.extra_indicators import (
    calc_liu_bias,
    calc_macd_vh,
    macd_vh_state,
    momentum_zone,
)
from data_source.chinese_mainland.tdx.tdx_source import ensure_vendor_on_path
from utils.formatting import fmt_number

ensure_vendor_on_path()
from scripts.data_pipeline.indicators import compute_all  # noqa: E402

# (标签, 列名, 小数位)
_INDICATOR_ROWS = [
    ("MA5/10/20/60", ["MA5", "MA10", "MA20", "MA60"], 2),
    ("EMA5/10/20/60", ["EMA5", "EMA10", "EMA20", "EMA60"], 2),
    ("MACD", ["DIF", "DEA", "MACD"], 3),
    ("RSI6/12/24", ["RSI6", "RSI12", "RSI24"], 2),
    ("KDJ", ["K", "D", "J"], 2),
    ("BOLL", ["BOLL_UP", "BOLL_MB", "BOLL_DN"], 2),
    ("ATR", ["ATR"], 2),
    ("量比/VOL_MA5", ["VOL_RATIO", "VOL_MA5"], 2),
    ("换手率", ["TURNOVER_RATE"], 3),
]


def _to_indicator_frame(stock) -> pd.DataFrame:
    """ChinaStockData 列表 → compute_all 输入（datetime/open/high/low/close/vol）。"""
    datas = stock.get_datas()
    rows = [
        {
            "datetime": d.date,
            "open": float(d.open),
            "high": float(d.high),
            "low": float(d.low),
            "close": float(d.close),
            "vol": float(d.volume),
        }
        for d in datas
    ]
    df = pd.DataFrame(rows)
    df["datetime"] = pd.to_datetime(df["datetime"])
    return df


def _fmt(value, digits):
    # 单点实现：utils.formatting.fmt_number（与 StockOutputFormatter 共用，
    # NaN/None → "N/A"，数值保留指定小数位——见 code-reuse-thinking-guide）
    return fmt_number(value, digits)


def get_trend_indicators(ticker: str) -> str:
    """返回目标股票最近交易日的技术指标摘要文本（通达信口径 + 新指标）。

    新指标（08-08-technical-indicator-analyst）：MACD-VH（Spiroglou 波动率
    归一化 MACD）与刘晨明乖离率——见 extra_indicators.py，vendor 零改动。
    柱态四色需相邻 bar 比较（全序列算好取末两根）。
    """
    stock = DataAcquisition().storage.get_stock(ticker)
    if stock is None or len(stock.get_datas()) == 0:
        return f"（无 {ticker} 的行情数据，跳过技术指标）"

    df = _to_indicator_frame(stock)
    indicators = compute_all(df, timeframe="daily")
    extra = pd.concat([calc_macd_vh(df), calc_liu_bias(df)], axis=1)
    last = indicators.iloc[-1]
    last_extra = extra.iloc[-1]
    prev_vh = extra.iloc[-2]["MACD_VH"] if len(extra) >= 2 else None
    lines = [f"【技术指标（{str(last['datetime'])[:10]} 收盘）】"]
    for label, columns, digits in _INDICATOR_ROWS:
        if len(columns) == 1:
            values = _fmt(last.get(columns[0]), digits)
        else:
            values = ", ".join(f"{col}={_fmt(last.get(col), digits)}" for col in columns)
        lines.append(f"{label}: {values}")
    lines.append(
        "MACD-VH: "
        f"MACD_V={_fmt(last_extra['MACD_V'], 2)}  "
        f"Signal={_fmt(last_extra['SIGNAL'], 2)}  "
        f"VH={_fmt(last_extra['MACD_VH'], 2)}  "
        f"柱态={macd_vh_state(last_extra['MACD_VH'], prev_vh)}  "
        f"动量区={momentum_zone(last_extra['MACD_V'])}"
    )
    lines.append(f"刘晨明乖离率(20日EMA): {_fmt(last_extra['LIU_BIAS'] * 100, 2)}%")
    return "\n".join(lines)
