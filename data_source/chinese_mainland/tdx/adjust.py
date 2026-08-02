"""qfq 前复权：xdxr 除权除息事件 → 复权因子，对齐 akshare adjust="qfq" 口径.

背景：akshare 历史路径存的是前复权价；pytdx 裸 bar 是未复权价，混存会破坏
指标连续性。本模块把 12 列序 DataFrame 的价格/成交量按事件逐级前复权。

算法（标准 qfq，事件从最新到最旧遍历，因子向后累乘）：
- **单位约定（pytdx xdxr）**：fenhong/songzhuangu/peigu 均为"每10股"单位
  （实测：比亚迪 002594 2025-07-29 事件 fenhong=39.74、songzhuangu=20.0
  即 10转20派39.74元），换算为每股时除 10；peigujia（配股价）为元/股。
- 每个事件用**事件日前最后一根 bar 的未复权收盘价**（prev_close）计算：
  价格因子 = (prev_close - 每股分红 + 每股配股数*配股价) / (prev_close * (1 + 每股送转 + 每股配股))
  股本因子 = 1 + 每股送转 + 每股配股 - 每股缩股
- **先累乘因子、再应用**：最新事件之后的 bar 是基准（因子 1）；事件日之前的
  bar 乘"更新后"的累计因子（遍历序：新→旧，因子逐步累乘）
- 成交量按股本因子调整（前复权以当前股本为基准），成交额不动（文档约定）
- 复权后重算 振幅/涨跌幅/涨跌额（除权日跳空在 qfq 口径下会消除，原始值失真）
- 换手率保持 mapping.py 计算值（原始成交量/当前流通股本）；送转事件之前的
  bar 该值仅为近似——如需精确需历史股本数据，超出本项目范围

输入约定：bars 为 mapping.to_akshare_hist_schema 的输出（升序），xdxr 为
TdxSource.fetch_xdxr 的输出（含 trade_date YYYYMMDD + fenhong/songzhuangu/
peigu/peigujia/suogu）。xdxr 为空或事件全在窗口外时返回原样（恒等变换）。
"""

from __future__ import annotations

import pandas as pd

PRICE_COLUMNS = ["开盘", "收盘", "最高", "最低"]


def qfq_adjust(
    bars: pd.DataFrame,
    xdxr: pd.DataFrame,
) -> pd.DataFrame:
    """把 12 列序日K DataFrame 前复权，返回复权后的 12 列序 DataFrame。"""
    if bars.empty or xdxr.empty:
        return bars.copy()

    raw = bars.copy()
    # 原始收盘价快照：事件 prev_close 必须用未复权价（.astype 产生副本，不受后续修改影响）
    close_series = raw["收盘"].astype(float)
    date_idx = pd.to_datetime(raw["日期"])

    events = xdxr.sort_values("trade_date", ascending=False)
    factor_price = 1.0
    factor_vol = 1.0
    for _, ev in events.iterrows():
        event_date = pd.Timestamp(str(ev["trade_date"]))
        before = date_idx < event_date
        if not before.any():
            continue

        prev_close = close_series[before].iloc[-1]
        # pytdx xdxr 字段：songzhuangu（送转股，每10股），旧版命名 songgu（兼容读取）
        songgu_ps = float(ev.get("songzhuangu", ev.get("songgu")) or 0) / 10
        peigu_ps = float(ev.get("peigu") or 0) / 10
        peigujia = float(ev.get("peigujia") or 0)
        fenhong_ps = float(ev.get("fenhong") or 0) / 10
        suogu_ps = float(ev.get("suogu") or 0) / 10
        denominator = prev_close * (1 + songgu_ps + peigu_ps)
        if denominator and denominator > 0:
            ratio_price = (prev_close - fenhong_ps + peigu_ps * peigujia) / denominator
        else:
            ratio_price = 1.0
        ratio_vol = 1 + songgu_ps + peigu_ps - suogu_ps

        # 先累乘因子，再应用到事件日之前的 bar（处理下一个更旧的事件时因子已包含本次）
        factor_price *= ratio_price
        factor_vol *= ratio_vol
        raw.loc[before, PRICE_COLUMNS] *= factor_price
        raw.loc[before, "成交量"] *= factor_vol

    # 复权后重算指标列（除权跳空消除后，涨跌幅等应基于复权价）
    prev_close = raw["收盘"].shift(1)
    raw["振幅"] = (raw["最高"] - raw["最低"]) / prev_close * 100
    raw["涨跌幅"] = (raw["收盘"] - prev_close) / prev_close * 100
    raw["涨跌额"] = raw["收盘"] - prev_close
    return raw
