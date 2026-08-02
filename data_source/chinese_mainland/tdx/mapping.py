"""pytdx bars → akshare 日K 列序映射层.

目的：输出 DataFrame 的列名/列序与 akshare ``stock_zh_a_hist`` **完全一致**，
使既有位置构造 ``ChinaStockData(*list(row.values()))`` 零改动复用
（见 .trellis/spec/data_source/index.md 的列序耦合约定）。

输入：tdx_quant ``TdxDownloader.download_daily`` 的原始输出
（列：datetime/open/high/low/close/vol/amount/market/code/ts_code/trade_date）。

输出列序（与 akshare 相同，值顺序即位置构造顺序）：
日期, 股票代码, 开盘, 收盘, 最高, 最低, 成交量, 成交额, 振幅, 涨跌幅, 涨跌额, 换手率

单位约定（实测核对过）：
- pytdx vol 单位为手（100 股），与 akshare 成交量一致
- pytdx amount 单位为元，与 akshare 成交额一致
- 换手率(%) = 成交量(手) * 100 / 流通股本(股) * 100

已知差异：首行无前收盘价，振幅/涨跌幅/涨跌额为 NaN（akshare 取窗口外的前收盘，
本层不越界取数；前复权后由 adjust.py 重算，见该模块文档）。

日期类型契约：日期列输出 ``datetime.date`` 对象（非字符串）——ChinaStock.add_data
按 ``data.date > last_data_update`` 去重/推进，要求与 ``datetime.date`` 可比较
（data_structure spec 的 "datetime-like object" 约定）。
"""

from __future__ import annotations

import pandas as pd

# akshare stock_zh_a_hist 列名（顺序即位置构造顺序，勿改）
AKSHARE_HIST_COLUMNS = [
    "日期",
    "股票代码",
    "开盘",
    "收盘",
    "最高",
    "最低",
    "成交量",
    "成交额",
    "振幅",
    "涨跌幅",
    "涨跌额",
    "换手率",
]

LOT_SIZE = 100  # 1 手 = 100 股


def to_akshare_hist_schema(
    df: pd.DataFrame,
    ticker: str,
    float_shares: float | None = None,
) -> pd.DataFrame:
    """把 pytdx 日K DataFrame 转换为 akshare 12 列序 DataFrame。

    :param df: tdx_quant 日K原始输出（含 datetime/open/high/low/close/vol/amount）
    :param ticker: 6 位股票代码（去后缀，如 '000001'）
    :param float_shares: 流通股本（股），来自 fetch_finance_capital 的 liutongguben；
        缺省时换手率为 NaN
    """
    out = pd.DataFrame(index=df.index)
    out["日期"] = pd.to_datetime(df["datetime"]).dt.date
    out["股票代码"] = str(ticker)
    out["开盘"] = df["open"]
    out["收盘"] = df["close"]
    out["最高"] = df["high"]
    out["最低"] = df["low"]
    out["成交量"] = df["vol"].astype("int64")
    out["成交额"] = df["amount"]

    prev_close = df["close"].shift(1)
    out["振幅"] = (df["high"] - df["low"]) / prev_close * 100
    out["涨跌幅"] = (df["close"] - prev_close) / prev_close * 100
    out["涨跌额"] = df["close"] - prev_close
    if float_shares:
        out["换手率"] = df["vol"] * LOT_SIZE / float_shares * 100
    else:
        out["换手率"] = float("nan")

    return out[AKSHARE_HIST_COLUMNS]
