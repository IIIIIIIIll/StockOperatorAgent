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
import threading
from datetime import date
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

# 缓存根：锚定仓库根（原 `Path("data/tdx_cache")` 随 CWD 漂移——换目录即整棵
# 缓存树失效；且 vendor 默认根 `DEFAULT_DATA_ROOT = Path('data')` 同样相对 CWD，
# 两者不一致会在现场并存两棵缓存树，2026-08-02 统一锚定）。本仓库所有
# TdxDownloader 构造都显式传入本常量；vendor 自身默认根不再被本仓库代码使用。
DEFAULT_PARQUET_ROOT = Path(__file__).resolve().parents[3] / "data" / "tdx_cache"

# 全市场证券名称索引（code → name），模块级缓存，进程内只拉一次。
# 键为 (market, code) 而非纯 code：SH 证券列表含指数，与 SZ 股票同码冲突
# （如 '000001'：SH=上证指数，SZ=平安银行），market 前缀区分。
# _NAME_INDEX_LOADED 仅在两市场都成功时才置 True——任一市场失败保持未加载，
# 下次 get_stock_name 重试（不固化部分索引）。
_NAME_INDEX: dict[tuple[int, str], str] = {}
_NAME_INDEX_LOADED = False


def is_bj_ticker(ticker: str) -> bool:
    """北交所（BJ）代码前缀判断（4/8 开头）——TDX 全链路不可用（无名称/无行情）。

    入口处显式拦截：logger.warning + 返回失败提示，避免静默 NaN
    （BJ 行情/概览/业绩走 akshare 备用路径，见 README）。
    """
    return ticker.startswith(("4", "8"))


class TdxSource:
    """pytdx 历史行情 / 快照的薄包装，方法级对应 tdx_quant TdxDownloader。

    ``parquet_root`` 是 TdxDownloader 的磁盘缓存目录（gitignored）；数据以
    parquet 分片落盘（``<root>/<domain>/ts_code=<...>/data.parquet``，写覆盖）。

    **缓存真相（2026-08-02 实测并声明，与 vendor 行为一致）**：parquet 缓存
    **只写不读**——daily/xdxr 等历史数据每次 fetch 都走网络（拉取后写回覆盖，
    从不读回）；fetch 返回的 DataFrame 契约（列序/类型）不受缓存影响。
    唯一例外：``fetch_security_list`` 当日快照（``security_list/market=<SZ|SH>/
    date=<YYYYMMDD>/data.parquet``，date 分区天然精确、无 max_bars 歧义）——
    当日分区已存在则直接读回，不重拉全市场证券列表。日K 读缓存优化（按
    symbol+max_bars+新鲜度）的可行性评估见 .trellis/spec/data_source/index.md
    待办段：vendor 落盘文件不记录 max_bars（且写覆盖），"当日新鲜"对盘中日K
    语义错误（早间写入的部分 bar 会被当新鲜数据读回），故未实现。
    """

    def __init__(self, parquet_root: Path = DEFAULT_PARQUET_ROOT):
        self.parquet_root = Path(parquet_root)
        self.downloader = TdxDownloader(self.parquet_root)

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

    def fetch_company_finance_raw(self, ticker: str) -> str | None:
        """F10 财务分析**原始文本**（company_info_raw 缓存，含完整四张子表）。

        **只读缓存，不触发网络**（08-02-fix-f10-quarterly-data）：vendor
        解析器把含季度的表 2 break 丢弃（tdx_company_info.py），非 vendor
        解析器（data_source/.../tdx/f10_parser.py）从 raw 文本把全部子表
        并入——本方法供 reports.build_reports 首选路径读取。

        文件缺失/空/损坏/无 text 列 → None（不 raise，error-handling 约定，
        调用方回退 vendor 解析 df）。路径与 vendor download_company_finance
        写入的 company_info_raw 同一契约：``<parquet_root>/company_info_raw/
        ts_code=<TS>/data.parquet`` 的 text 列。
        """
        from scripts.data_pipeline.code_mapping import market_code_to_ts_code  # noqa: E402
        ts_code = market_code_to_ts_code(infer_hq_market(ticker), ticker)
        cached = (
            self.parquet_root
            / "company_info_raw"
            / f"ts_code={ts_code}"
            / "data.parquet"
        )
        if not cached.exists():
            return None
        try:
            df = pd.read_parquet(cached)
            if df.empty or "text" not in df.columns:
                return None
            return df.iloc[0]["text"]
        except Exception:
            # 缓存损坏 → None（回退 vendor 解析 df，不阻断主流程）
            return None

    def fetch_security_list(self, market: int) -> "pd.DataFrame":
        """全市场证券列表快照（market: 0=SZ, 1=SH），返回原始 DataFrame。

        当日快照读缓存（vendored date 分区）：``<parquet_root>/security_list/
        market=<SZ|SH>/date=<YYYYMMDD>/data.parquet`` 存在 → 直接读回并补
        market 标签列（与 vendor ``download_security_list`` 写后读回完全同一
        契约），不重拉网络——全市场枚举 ~2.1 万行/市场是多页往返，当日重复
        构建（如 name 索引 + 多次分析）省掉大头。文件缺失/空/损坏 → 回退
        网络拉取（vendor 路径写回）。返回 DataFrame 列序/类型与网络路径一致。
        """
        label = "SZ" if market == 0 else "SH"
        today = date.today().strftime("%Y%m%d")
        cached = (
            self.parquet_root
            / "security_list"
            / f"market={label}"
            / f"date={today}"
            / "data.parquet"
        )
        if cached.exists():
            try:
                df = pd.read_parquet(cached)
                if not df.empty:
                    df["market"] = label
                    logger.debug("Security list cache hit for market {} ({})", market, cached)
                    return df
            except Exception:
                logger.warning("Security list cache unreadable at {}; falling back to network.", cached)
        logger.debug("Security list cache miss for market {} ({}); fetching from network.", market, cached)
        return self.downloader.download_security_list(market)

    def fetch_snapshot(self, ticker: str) -> "pd.DataFrame":
        """实时快照（不落盘），返回原始 DataFrame。"""
        return self.downloader.snapshot(ticker)

    def fetch_index(self, code: str, market: int, max_bars: int | None = None) -> "pd.DataFrame":
        """指数日 K（market 必须显式给出，指数代码不遵循股票前缀规则）。"""
        return self.downloader.download_index(code, market=market, max_bars=max_bars)

    # ------------------------------------------------------------------
    # 名称构建（按需单股）：get_stock_name（→ 名称索引，模块级缓存）
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
        return _NAME_INDEX.get((infer_hq_market(ticker), ticker), ticker)

    def _load_name_index(self) -> None:
        """拉取 SZ/SH 全市场证券列表，填充 ``_NAME_INDEX``。

        两市场都成功才置 ``_NAME_INDEX_LOADED=True``；任一市场失败 → 保持
        未加载，下次 get_stock_name 重试（不固化部分索引——否则失败市场
        的名称在进程内永久回退 ticker）。
        """
        global _NAME_INDEX_LOADED
        ok = True
        for market in (0, 1):
            try:
                df = self.fetch_security_list(market)
            except Exception:
                logger.warning("Security list unavailable for market {}; names fall back to ticker.", market)
                ok = False
                continue
            if df is None or df.empty or "code" not in df.columns or "name" not in df.columns:
                logger.warning("Security list for market {} lacks code/name columns; skipped.", market)
                ok = False
                continue
            for code, name in zip(df["code"], df["name"]):
                _NAME_INDEX[(market, str(code))] = str(name)
        if not _NAME_INDEX:
            logger.error("TDX security list name index is empty; names fall back to ticker.")
        if ok:
            _NAME_INDEX_LOADED = True


_instance = None
_instance_lock = threading.Lock()


def get_tdx_source() -> TdxSource:
    """进程级懒单例（照 get_zodb_storage 模式）：同一进程共享一个 TdxSource。

    生产链路收敛点（08-09-tdx-singleton-and-transactions）：TdxDownloader
    构造与 parquet_root 只在单例内发生一次——单次分析里 pytdx 连接/根路径
    不再反复重建，缓存树一致性更稳。幂等：同一进程多次调用返回同一实例。
    ``TdxSource()`` 直接构造仍可用（测试/独立路径不受限），单例只为生产
    链路收敛（DataAcquisition / overview / reports / 指标工具全部消费点
    经本函数获取）。
    """
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:
                _instance = TdxSource()
    return _instance
