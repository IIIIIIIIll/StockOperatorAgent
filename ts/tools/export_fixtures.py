#!/usr/bin/env python3
"""导出 TS 侧等价性测试 fixture（只读 Python 仓库作 oracle，零网络重跑）。

用法：cd ~/soa-ts-prototype && python3 tools/export_fixtures.py
产出（写入 test/fixtures/）：
- 600036_daily.json      { raw, adjusted, xdxr }  600036 全量日K（mapping 12 列 + qfq）
- 600036_indicators.json 最近 250 根 compute_all + extra 指标
- f10_tdx.txt            通达信格式 F10 文本（M0 拉取）
- f10_hk.txt             港澳资讯格式 F10 文本（项目缓存）
"""
import glob
import json
import sys

REPO = "/home/tan/StockOperatorAgent"
sys.path.insert(0, REPO)

import pandas as pd

from data_source.chinese_mainland.tdx.tdx_source import get_tdx_source, ensure_vendor_on_path
from data_source.chinese_mainland.tdx import mapping, adjust
from core.llms.tools.extra_indicators import calc_macd_vh, calc_liu_bias

ensure_vendor_on_path()
from scripts.data_pipeline.indicators import compute_all  # noqa: E402

FIX = "test/fixtures"


def num(v):
    """NaN/None → None（JSON 安全）。"""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if pd.isna(f) else f


def main():
    src = get_tdx_source()
    bars = src.fetch_daily("600036", max_bars=None)
    xdxr = src.fetch_xdxr("600036")
    bars12 = mapping.to_akshare_hist_schema(bars, "600036")

    raw = [
        {
            "date": r["日期"].strftime("%Y%m%d"),
            "open": num(r["开盘"]), "close": num(r["收盘"]),
            "high": num(r["最高"]), "low": num(r["最低"]),
            "volume": int(r["成交量"]) if pd.notna(r["成交量"]) else None,
            "amount": num(r["成交额"]),
        }
        for _, r in bars12.iterrows()
    ]
    adj_df = adjust.qfq_adjust(bars12, xdxr)
    adjusted = [
        {
            "date": r["日期"].strftime("%Y%m%d"),
            "open": round(float(r["开盘"]), 6), "close": round(float(r["收盘"]), 6),
            "high": round(float(r["最高"]), 6), "low": round(float(r["最低"]), 6),
            "volume": int(r["成交量"]),
        }
        for _, r in adj_df.iterrows()
    ]
    xdxr_events = [
        {
            "tradeDate": str(r["trade_date"]),
            "fenhong": num(r["fenhong"]), "peigujia": num(r["peigujia"]),
            "songzhuangu": num(r["songzhuangu"]), "peigu": num(r["peigu"]),
            "suogu": num(r["suogu"]),
        }
        for _, r in xdxr.iterrows()
        if pd.notna(r["trade_date"])
    ]
    with open(f"{FIX}/600036_daily.json", "w") as f:
        json.dump({"raw": raw, "adjusted": adjusted, "xdxr": xdxr_events}, f)
    print("600036_daily.json:", len(raw), "raw bars,", len(adjusted), "adjusted,", len(xdxr_events), "xdxr")

    # 指标：compute_all + extra，全序列算、固化最近 250 根
    df = pd.DataFrame(
        [
            {"datetime": pd.Timestamp(f"{b['date'][:4]}-{b['date'][4:6]}-{b['date'][6:]}"),
             "open": b["open"], "high": b["high"], "low": b["low"],
             "close": b["close"], "vol": b["volume"]}
            for b in raw
        ]
    )
    ind = compute_all(df, timeframe="daily")
    extra = pd.concat([calc_macd_vh(df), calc_liu_bias(df)], axis=1)
    cols = [c for c in ind.columns if c != "datetime"]
    rows = []
    for i in range(len(ind) - 250, len(ind)):
        row = {c: num(ind.iloc[i][c]) for c in cols}
        row.update({
            "MACD_V": num(extra.iloc[i]["MACD_V"]),
            "SIGNAL": num(extra.iloc[i]["SIGNAL"]),
            "MACD_VH": num(extra.iloc[i]["MACD_VH"]),
            "LIU_BIAS": num(extra.iloc[i]["LIU_BIAS"]),
        })
        rows.append(row)
    with open(f"{FIX}/600036_indicators.json", "w") as f:
        json.dump(rows, f)
    print("600036_indicators.json:", len(rows), "rows, cols:", cols + ["MACD_V", "SIGNAL", "MACD_VH", "LIU_BIAS"])

    # F10 双格式文本
    tdx = open("/tmp/f10_text.txt").read()
    open(f"{FIX}/f10_tdx.txt", "w").write(tdx)
    hk_files = glob.glob(f"{REPO}/data/tdx_cache/company_info_raw/**/data.parquet", recursive=True)
    hk = pd.read_parquet(hk_files[0]).iloc[0]["text"]
    open(f"{FIX}/f10_hk.txt", "w").write(hk)
    print("f10_tdx.txt:", len(tdx), "chars | f10_hk.txt:", len(hk), "chars")


if __name__ == "__main__":
    main()
