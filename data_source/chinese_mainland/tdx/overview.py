"""TDX 按需单股概览构建层：个股概览由 pytdx 原始数据 + 派生计算生成。

akshare 的 overview 是全市场行情扫描，pytdx 无等效接口；本模块改为按需单股
构建（分析哪只构建哪只）。数据流见 .trellis/tasks/08-02-tdx-overview-reports
design.md §1/§2。

**22 列名契约**：输出 DataFrame 的 22 列与 akshare ``stock_*_a_spot_em``
去掉序号列后的 22 值列序一致（代码/名称/最新价/.../年初至今涨跌幅），列名
即 ``OVERVIEW_COLUMNS``。消费者用 ``StockOverview.from_row(row,
column_map=OVERVIEW_COLUMN_MAP)`` 命名构造（08-09——列名承重，列序不再
承重）——注意与 akshare 路径不同：akshare 行首有"序号"列需 ``[1:]`` 丢弃，
本层输出的 22 列**不含序号列**；from_row 按列名取值，akshare 侧多余的
"序号"列自然被忽略（无需切片）。

数据源与派生（逐源降级，单项失败 → 该源字段 NaN + logger.warning，不整块失败）：
- snapshot：price/open/high/low（实时；失败 → latest_price 回退日K末根收盘）
- finance_capital：zongguben/liutongguben（总/流通股本，市值与换手率派生）
- company_finance（F10 tidy long）：最新报告期 eps/每股净资产 → PE/PB 派生
- daily（最近 250 根，覆盖 60 交易日前 + 年初窗口）：prev_close、60日/ytd
  涨跌幅基准、volume/成交额（仅当末根 bar 是当日时取值，盘中为 NaN）
- security_list 名称索引（get_stock_name，模块级缓存；失败回退 ticker）

整体无任何价格来源（snapshot 与 daily 都失败）→ 返回 None（调用方报错回
False）；其余组合均可构建（缺源字段为 NaN）。
"""

from __future__ import annotations

from dataclasses import fields
from datetime import date

import pandas as pd
from loguru import logger

from data_source.chinese_mainland.tdx.mapping import LOT_SIZE
from data_source.chinese_mainland.tdx.tdx_source import TdxSource
from data_structure.chinese_mainland.StockOverview import StockOverview
from utils.time_helper import asia_today

# akshare stock_*_a_spot_em 22 值列序（去掉序号列），与 StockOverview 字段序
# 一一对应（ticker=代码, name=名称, latest_price=最新价, ...）。顺序即输出
# 列序（勿改，test_tdx_overview.py 钉死）；构造走列名契约见下。
OVERVIEW_COLUMNS = [
    "代码", "名称", "最新价", "涨跌幅", "涨跌额",
    "成交量", "成交额", "振幅", "最高", "最低",
    "今开", "昨收", "量比", "换手率", "市盈率-动态",
    "市净率", "总市值", "流通市值", "涨速", "5分钟涨跌",
    "60日涨跌幅", "年初至今涨跌幅",
]

# 列名契约（08-09 命名行构造）：StockOverview 字段名 → 行内列名。与
# OVERVIEW_COLUMNS 同源（zip(fields(StockOverview), OVERVIEW_COLUMNS)）——
# 字段序与列序对齐由 test_tdx_overview.py 钉死，两处不可能漂移。from_row
# 按列名取值：akshare 侧（23 列含"序号"）无需 [1:] 切片，列序漂移 →
# KeyError（响亮失败，替代位置构造的静默错位写垃圾）。
OVERVIEW_COLUMN_MAP = {
    f.name: col for f, col in zip(fields(StockOverview), OVERVIEW_COLUMNS)
}

NAN = float("nan")

# 60日涨跌幅的窗口参数：60 个交易日前（相对末根 bar）
LOOKBACK_DAYS = 60
# 日K 拉取上限：一年约 243 个交易日，250 根足以覆盖"60 交易日前"与"年初首个
# 交易日"两个窗口（年初首根距今最多约 243 根）。
OVERVIEW_DAILY_MAX_BARS = 250


def _to_float(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return NAN


def _cell(df: pd.DataFrame | None, col: str) -> float:
    """单行 DataFrame 的单元格取值；空/缺列/NaN → NaN。"""
    if df is None or df.empty or col not in df.columns:
        return NAN
    return _to_float(df.iloc[0][col])


def _divide(numerator: float, denominator: float) -> float:
    """a/b；b 缺失或 ≤0 → NaN（除零保护；PE/PB 分母 ≤0 时 NaN 的约定）。"""
    if denominator is None or pd.isna(denominator) or denominator <= 0:
        return NAN
    if numerator is None or pd.isna(numerator):
        return NAN
    return numerator / denominator


def _daily_last(daily_df: pd.DataFrame | None, col: str) -> float:
    """日K 末根 bar 的列值；空/缺列 → NaN。"""
    if daily_df is None or daily_df.empty or col not in daily_df.columns:
        return NAN
    return _to_float(daily_df[col].iloc[-1])


def _daily_prev_close(daily_df: pd.DataFrame | None) -> float:
    """昨收 = 日K 倒数第二根 bar 收盘；不足 2 根 → NaN。"""
    if daily_df is None or len(daily_df) < 2 or "close" not in daily_df.columns:
        return NAN
    return _to_float(daily_df["close"].iloc[-2])


def _close_n_bars_ago(daily_df: pd.DataFrame | None, n: int) -> float:
    """末根 bar 前 n 个交易日的收盘价；bar 不足 n+1 根 → NaN。"""
    if daily_df is None or "close" not in daily_df.columns or len(daily_df) <= n:
        return NAN
    return _to_float(daily_df["close"].iloc[len(daily_df) - 1 - n])


def _ytd_base_close(daily_df: pd.DataFrame | None, today: date) -> float:
    """年初 YTD 基准收盘（未复权窗口内）：

    - 窗口内含上年末 bar → 用上年最后一根收盘（年初首个交易日不把当日自身
      当基准，否则 YTD 恒 0 漏首日；标准 YTD 口径 = 相对上年末收盘）；
    - 末根 bar 年份 ≠ 当年（长期停牌停留在去年）→ NaN（跨年比较无意义）；
    - 窗口内无上年 bar（如当年新上市）→ 退而求其次用当年首根收盘（首日
      YTD 仍为 0；OVERVIEW_DAILY_MAX_BARS=250 通常覆盖上年末）。
    """
    if daily_df is None or daily_df.empty or "datetime" not in daily_df.columns or "close" not in daily_df.columns:
        return NAN
    dt = pd.to_datetime(daily_df["datetime"])
    last_year = dt.iloc[-1].year
    if last_year != today.year:
        return NAN  # 跨年停牌：末根 bar 停在去年，与今年价格比较无意义
    prev_year_mask = dt.dt.year == last_year - 1
    if prev_year_mask.any():
        return _to_float(daily_df.loc[prev_year_mask, "close"].iloc[-1])
    this_year_mask = dt.dt.year == last_year
    if not this_year_mask.any():
        return NAN
    return _to_float(daily_df.loc[this_year_mask, "close"].iloc[0])


def _last_bar_is_today(daily_df: pd.DataFrame | None, today: date) -> bool:
    """末根 bar 是否为"当日"（盘中/收盘后当日 bar 已存在）；周末/盘前 → False。"""
    if daily_df is None or daily_df.empty or "datetime" not in daily_df.columns:
        return False
    last = pd.to_datetime(daily_df["datetime"]).iloc[-1]
    return last.date() == today


def latest_period_value(f10_df: pd.DataFrame | None, metric: str) -> float:
    """F10 tidy long → 指定指标在**最新报告期**的 value_num。

    period 为 'YYYY-MM-DD' 字符串，字典序即时间序（ISO 可排序），取最大者；
    无该指标 / 无有效 period → NaN。period 为 NaN 的行先剔除——否则
    astype(str) 得 'nan' 字典序最大，掩盖真实最新报告期。
    """
    if (
        f10_df is None
        or f10_df.empty
        or "metric" not in f10_df.columns
        or "period" not in f10_df.columns
        or "value_num" not in f10_df.columns
    ):
        return NAN
    sub = f10_df[f10_df["metric"] == metric].dropna(subset=["period"])
    if sub.empty:
        return NAN
    latest_idx = sub["period"].astype(str).idxmax()
    return _to_float(sub.loc[latest_idx, "value_num"])


def compose_overview(
    ticker: str,
    name: str,
    snapshot_df: pd.DataFrame | None = None,
    capital_df: pd.DataFrame | None = None,
    f10_df: pd.DataFrame | None = None,
    daily_df: pd.DataFrame | None = None,
    today: date | None = None,
) -> pd.Series:
    """纯函数：由各源原始 DataFrame 合成单行 22 列概览 Series（不访问网络）。

    各源 DataFrame 为 TdxSource.fetch_* 的原始输出（None = 该源失败/缺失）。
    ``today`` 用于判定"当日"日K bar（volume/成交额/换手率的盘中语义），
    离线测试可注入固定日期。
    """
    today = today or asia_today()  # 北京时间"今天"（时区统一，见 utils/time_helper）

    price = _cell(snapshot_df, "price")
    if pd.isna(price):
        price = _daily_last(daily_df, "close")

    prev_close = _daily_prev_close(daily_df)
    high = _cell(snapshot_df, "high")
    low = _cell(snapshot_df, "low")
    open_ = _cell(snapshot_df, "open")

    if _last_bar_is_today(daily_df, today):
        volume = _daily_last(daily_df, "vol")
        amount = _daily_last(daily_df, "amount")
    else:
        volume = NAN
        amount = NAN

    zongguben = _cell(capital_df, "zongguben")
    liutongguben = _cell(capital_df, "liutongguben")
    eps = latest_period_value(f10_df, "基本每股收益(元)")
    net_worth_per_share = latest_period_value(f10_df, "每股净资产(元)")

    change_percent = _divide(price - prev_close, prev_close) * 100
    change_amount = price - prev_close
    amplitude = _divide(high - low, prev_close) * 100
    # 换手率(%) = 成交量(手) * 100(股/手) / 流通股本(股) * 100，与 mapping.py 口径一致
    turnover_rate = _divide(volume * LOT_SIZE, liutongguben) * 100

    close_60d = _close_n_bars_ago(daily_df, LOOKBACK_DAYS)
    change_percent_60d = _divide(price - close_60d, close_60d) * 100
    ytd_close = _ytd_base_close(daily_df, today)
    change_percent_ytd = _divide(price - ytd_close, ytd_close) * 100

    values = [
        str(ticker), name, price, change_percent, change_amount,
        volume, amount, amplitude, high, low, open_, prev_close,
        NAN,  # 量比：pytdx 无
        turnover_rate,
        _divide(price, eps), _divide(price, net_worth_per_share),
        price * zongguben, price * liutongguben,
        NAN,  # 涨速/动量：pytdx 无
        NAN,  # 5分钟涨跌：pytdx 无
        change_percent_60d, change_percent_ytd,
    ]
    return pd.Series(values, index=OVERVIEW_COLUMNS)


def _fetch_degraded(fetch, source_name: str, ticker: str) -> pd.DataFrame | None:
    """拉取一个数据源；失败/空 → logger.warning + None（逐源降级）。"""
    try:
        df = fetch()
    except Exception:
        logger.warning("TDX {} fetch failed for {}; related overview fields will be NaN.", source_name, ticker)
        return None
    if df is None or df.empty:
        logger.warning("TDX {} returned no rows for {}; related overview fields will be NaN.", source_name, ticker)
        return None
    return df


def build_overview(ticker: str, _scope=None) -> pd.DataFrame | None:
    """按需单股构建 22 列概览 DataFrame（单行；列序 = OVERVIEW_COLUMNS）。

    逐源降级：snapshot/F10/股本/日K 单项失败 → 该源字段 NaN + warning；
    name 失败回退 ticker（永不 NaN）。snapshot 与日K 都失败（无任何价格来源）
    → 返回 None（调用方按失败处理）。

    _scope（review #2+#3）：FetchScope（core.data_acquisition）透传——给出时
    各源拉取走 scope 复用（与历史/业绩共享同一 DataFrame）；None → 独立直拉
    （独立调用语义不变）。FetchScope 与 TdxSource 方法名同构（fetch_*），
    `_scope or src` 直接作 fetcher。
    """
    src = TdxSource()
    name = src.get_stock_name(ticker)
    fetcher = _scope or src

    snapshot_df = _fetch_degraded(lambda: fetcher.fetch_snapshot(ticker), "snapshot", ticker)
    daily_df = _fetch_degraded(
        lambda: fetcher.fetch_daily(ticker, max_bars=OVERVIEW_DAILY_MAX_BARS), "daily", ticker
    )
    capital_df = _fetch_degraded(lambda: fetcher.fetch_finance_capital(ticker), "finance_capital", ticker)
    f10_df = _fetch_degraded(lambda: fetcher.fetch_company_finance(ticker), "company_finance", ticker)

    if snapshot_df is None and daily_df is None:
        logger.error(
            "TDX overview build failed for {}: no price source (snapshot and daily both unavailable).", ticker
        )
        return None

    row = compose_overview(ticker, name, snapshot_df, capital_df, f10_df, daily_df)
    return pd.DataFrame([row])
