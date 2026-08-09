"""存量 F10 季度数据重灌（08-02-fix-f10-quarterly-data）。

背景：vendor 解析器把 F10 含季度的表 2 break 丢弃，存量 ZODB 只有
6 期（5 年报 + 最新季）。本脚本用非 vendor 解析器（f10_parser，表 1 +
表 2 全部并入，9 期）重灌**已有 raw 缓存**的股票——零网络。

**绕过 freshness 门**：直接走 reports.build_reports + ZODB 替换，不走
acquire_performance_report_tdx（其门会因"最新期已到季度末"跳过重拉）。

**为什么直接替换 performance_reports 而非 add_performance_reports**：
add_performance_reports 是**递增去重**（只追加比最后一份新的）——库里
已有 20260331（比要补的 20250331/20250630/20250930 大），递增语义会
把季度期全部挡住。脚本按 report_date 升序合并替换（新 ∪ 旧去重），
天然幂等（重跑 = 同一集合）。

用法：
    python3 scripts/backfill_f10_quarters.py              # 全部有 raw 缓存的股票
    python3 scripts/backfill_f10_quarters.py --ticker 000001   # 单只
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from loguru import logger  # noqa: E402

from data_source.chinese_mainland.tdx.reports import build_reports  # noqa: E402
from data_source.chinese_mainland.tdx.tdx_source import DEFAULT_PARQUET_ROOT  # noqa: E402
from data_storage.chinese_mainland.ZODBStorage import get_zodb_storage  # noqa: E402
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport  # noqa: E402
from persistent.list import PersistentList  # noqa: E402


def _ticker_from_ts_code(ts_code: str) -> str | None:
    """'000001.SZ' / '600519.SH' → 6 位 ticker（TDX 只覆盖沪深主板/创业板）。"""
    code, _, suffix = ts_code.partition(".")
    if len(code) == 6 and suffix in ("SZ", "SH"):
        return code
    return None


def _cached_tickers() -> list[str]:
    """有 company_info_raw 缓存的全部 ticker（零网络重灌的前提）。"""
    raw_root = DEFAULT_PARQUET_ROOT / "company_info_raw"
    if not raw_root.exists():
        return []
    tickers = []
    for entry in raw_root.iterdir():
        ticker = _ticker_from_ts_code(entry.name.partition("=")[2])
        if ticker and (entry / "data.parquet").exists():
            tickers.append(ticker)
    return sorted(tickers)


def backfill_one(ticker: str) -> int:
    """重灌单只：build_reports（raw 路径，含季度）→ 合并替换 ZODB。

    返回新报告总数；build_reports 返回 None（无 raw 缓存/解析失败，走
    回退路径也无数据）→ 记 warning 返回 -1（不阻断批量）。
    """
    storage = get_zodb_storage()
    stock = storage.get_stock(ticker)
    if stock is None:
        logger.warning("Stock {} not in storage; skipped.", ticker)
        return -1

    reports = build_reports(ticker)
    if reports is None or reports.empty:
        logger.warning("No reports for {} (no raw cache?); skipped.", ticker)
        return -1

    # 命名行构造（08-09）：REPORT_COLUMNS 即字段名 → from_row 恒等路径
    rows = [
        StockPerformanceReport.from_row(row)
        for row in reports.to_dict(orient="records")
    ]
    # 合并替换（绕过 add_performance_reports 的递增去重，见模块 docstring）：
    # 新 ∪ 旧按 report_date 去重排序——重灌季度期不会被库里已有的
    # 20260331 挡住；重跑幂等（同一集合）。
    merged = {
        r.report_date: r
        for r in list(stock.get_performance_reports()) + rows
    }
    # PersistentList 保持持久化容器契约（原属性是 PersistentList，直接赋
    # 普通 list 破坏 ZODB 跟踪语义）
    stock.performance_reports = PersistentList(merged[d] for d in sorted(merged))
    storage.put_stock(ticker, stock)
    logger.info(
        "Backfilled {} with {} reports (merged); dates: {}",
        ticker, len(stock.performance_reports),
        [r.report_date for r in stock.performance_reports[-12:]],
    )
    return len(stock.performance_reports)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill F10 quarterly reports from raw cache")
    parser.add_argument("--ticker", default=None, help="single ticker; default: all cached")
    args = parser.parse_args()

    if args.ticker:
        tickers = [args.ticker]
    else:
        tickers = _cached_tickers()
        logger.info("Found {} cached tickers", len(tickers))

    done = skipped = 0
    for ticker in tickers:
        n = backfill_one(ticker)
        if n < 0:
            skipped += 1
        else:
            done += 1
    logger.info("Backfill done: {} ok, {} skipped", done, skipped)


if __name__ == "__main__":
    main()
