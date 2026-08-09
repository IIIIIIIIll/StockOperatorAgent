"""pytdx bars → akshare 日K 列序映射层.

目的：输出 DataFrame 的列名/列序与 akshare ``stock_zh_a_hist`` **完全一致**，
使既有构造 ``ChinaStockData.from_row(row, column_map=AKSHARE_HIST_COLUMN_MAP)``
零改动复用（08-09 命名行构造替代原 ``ChinaStockData(*list(row.values()))``
位置构造——列名承重，列序不再承重，见 .trellis/spec/data_source/index.md）。

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

from dataclasses import fields

import pandas as pd

from data_structure.chinese_mainland.ChinaStockData import ChinaStockData

# akshare stock_zh_a_hist 列名（顺序即输出列序，勿改——test_tdx_mapping.py 钉死）
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

# 列名契约（08-09 命名行构造）：ChinaStockData 字段名 → 行内列名。与
# AKSHARE_HIST_COLUMNS 同源（zip(fields(ChinaStockData), AKSHARE_HIST_COLUMNS)）——
# 字段序与列序对齐由 test_tdx_mapping.py 钉死，两处不可能漂移。from_row
# 按列名取值，akshare 侧列序漂移 → KeyError（响亮失败）。
AKSHARE_HIST_COLUMN_MAP = {
    f.name: col for f, col in zip(fields(ChinaStockData), AKSHARE_HIST_COLUMNS)
}

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
    out["成交量"] = df["vol"].fillna(0).astype("int64")  # NaN vol → 0（astype 遇 NaN 抛错）
    out["成交额"] = df["amount"]

    prev_close = df["close"].shift(1)
    out["振幅"] = (df["high"] - df["low"]) / prev_close * 100
    out["涨跌幅"] = (df["close"] - prev_close) / prev_close * 100
    out["涨跌额"] = df["close"] - prev_close
    # 0.0 是显式传入（数据说流通股本为 0），走计算路径而非静默 NaN——
    # `if float_shares:` 在 0.0 时 falsy，与"未传"不可区分（修复边界）
    if float_shares is not None:
        out["换手率"] = df["vol"] * LOT_SIZE / float_shares * 100
    else:
        out["换手率"] = float("nan")

    return out[AKSHARE_HIST_COLUMNS]
