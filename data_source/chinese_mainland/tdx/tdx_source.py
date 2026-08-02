"""TdxSource — thin wrapper over vendored tdx_quant (pytdx / TDX MCP).

Follows the local data-source pattern (see .trellis/spec/data_source/index.md):
one method per endpoint, returns the raw pandas DataFrame untouched, no
business logic. Consumers (DataAcquisition) do the conversion.

The vendored upstream lives under ``vendor/`` and uses absolute imports rooted
at ``scripts.*``; the module-level sys.path insertion (once per process) makes
those imports resolve without touching the upstream code.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
from loguru import logger

VENDOR_ROOT = Path(__file__).parent / "vendor"


def ensure_vendor_on_path() -> None:
    """把 vendor 根加入 sys.path（幂等），使 ``scripts.*`` 上游绝对导入可解析。"""
    if str(VENDOR_ROOT) not in sys.path:
        sys.path.insert(0, str(VENDOR_ROOT))


ensure_vendor_on_path()

from scripts.data_pipeline.tdx_client import TdxDownloader  # noqa: E402
from scripts.data_pipeline.fetch_realtime_watchlist import infer_hq_market  # noqa: E402

DEFAULT_PARQUET_ROOT = Path("data/tdx_cache")

# 全市场证券名称索引（code → name），模块级缓存，进程内只拉一次。
# 键为 (market, code) 而非纯 code：SH 证券列表含指数，与 SZ 股票同码冲突
# （如 '000001'：SH=上证指数，SZ=平安银行），market 前缀区分。
_NAME_INDEX: dict[tuple[int, str], str] = {}
_NAME_INDEX_LOADED = False


class TdxSource:
    """pytdx 历史行情 / 快照的薄包装，方法级对应 tdx_quant TdxDownloader。

    ``parquet_root`` 是 TdxDownloader 的磁盘缓存目录（gitignored）；历史数据
    以 parquet 分片落盘，重复拉取直接读缓存。
    """

    def __init__(self, parquet_root: Path = DEFAULT_PARQUET_ROOT):
        self.downloader = TdxDownloader(parquet_root)

    def fetch_daily(self, ticker: str, max_bars: int | None = None) -> "pd.DataFrame":
        """日 K 全历史（自动翻页），返回原始 DataFrame。"""
        return self.downloader.download_daily(ticker, max_bars=max_bars)

    def fetch_minute(self, ticker: str, freq: int = 5, max_bars: int | None = None) -> "pd.DataFrame":
        """分钟 K 线（freq: 5/15/30/60），返回原始 DataFrame。"""
        return self.downloader.download_minute(ticker, freq=freq, max_bars=max_bars)

    def fetch_xdxr(self, ticker: str) -> "pd.DataFrame":
        """除权除息事件（前复权因子来源），返回原始 DataFrame。"""
        return self.downloader.download_xdxr(ticker)

    def fetch_finance_capital(self, ticker: str) -> "pd.DataFrame":
        """股本结构快照（含 liutongguben 流通股本），返回原始 DataFrame。"""
        return self.downloader.download_finance_capital(ticker)

    def fetch_company_finance(self, ticker: str) -> "pd.DataFrame":
        """F10 财务分析指标（tidy long 格式），返回原始 DataFrame。"""
        return self.downloader.download_company_finance(ticker)

    def fetch_security_list(self, market: int) -> "pd.DataFrame":
        """全市场证券列表快照（market: 0=SZ, 1=SH），返回原始 DataFrame。"""
        return self.downloader.download_security_list(market)

    def fetch_snapshot(self, ticker: str) -> "pd.DataFrame":
        """实时快照（不落盘），返回原始 DataFrame。"""
        return self.downloader.snapshot(ticker)

    def fetch_index(self, code: str, market: int, max_bars: int | None = None) -> "pd.DataFrame":
        """指数日 K（market 必须显式给出，指数代码不遵循股票前缀规则）。"""
        return self.downloader.download_index(code, market=market, max_bars=max_bars)

    # ------------------------------------------------------------------
    # 概览构建（按需单股）：get_stock_name + build_overview（→ overview.py）
    # ------------------------------------------------------------------
    def get_stock_name(self, ticker: str) -> str:
        """code → 名称：security_list 全市场名称索引，模块级缓存一次。

        索引键 (market, code)，market 由代码前缀推断（0=SZ/1=SH，见
        ``infer_hq_market``）——避免 SH 指数与 SZ 股票同码冲突
        （'000001'：SH=上证指数，SZ=平安银行）。
        名称表为全市场轻量快照（仅 code/name 两列）；拉取失败 → 返回 ticker
        本身（name 永不 NaN）。
        """
        global _NAME_INDEX_LOADED
        if not _NAME_INDEX_LOADED:
            self._load_name_index()
            _NAME_INDEX_LOADED = True
        return _NAME_INDEX.get((infer_hq_market(ticker), ticker), ticker)

    def _load_name_index(self) -> None:
        """拉取 SZ/SH 全市场证券列表，填充 ``_NAME_INDEX``（失败市场跳过）。"""
        for market in (0, 1):
            try:
                df = self.fetch_security_list(market)
            except Exception:
                logger.warning("Security list unavailable for market {}; names fall back to ticker.", market)
                continue
            if df is None or df.empty or "code" not in df.columns or "name" not in df.columns:
                logger.warning("Security list for market {} lacks code/name columns; skipped.", market)
                continue
            for code, name in zip(df["code"], df["name"]):
                _NAME_INDEX[(market, str(code))] = str(name)
        if not _NAME_INDEX:
            logger.error("TDX security list name index is empty; names fall back to ticker.")

    def build_overview(self, ticker: str) -> "pd.DataFrame | None":
        """按需单股构建 22 列概览 DataFrame（单行；列序契约见 overview.py）。"""
        from data_source.chinese_mainland.tdx.overview import build_overview as _build_overview

        return _build_overview(ticker)

    def build_reports(self, ticker: str) -> "pd.DataFrame | None":
        """按需单股构建业绩报告 DataFrame（每报告期一行；列序契约见 reports.py）。"""
        from data_source.chinese_mainland.tdx.reports import build_reports as _build_reports

        return _build_reports(ticker)
