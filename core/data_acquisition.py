from datetime import datetime
import pandas as pd
from data_source.chinese_mainland.tdx.adjust import qfq_adjust
from data_source.chinese_mainland.tdx.mapping import to_akshare_hist_schema
from data_source.chinese_mainland.tdx.overview import build_overview as _build_overview_module
from data_source.chinese_mainland.tdx.reports import build_reports as _build_reports_module
from data_source.chinese_mainland.tdx.tdx_source import TdxSource, is_bj_ticker
from data_structure.chinese_mainland import ChinaStock, ChinaStockData
from data_structure.chinese_mainland.StockOverview import StockOverview
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport
from loguru import logger
from core.legacy_akshare import LegacyAksharePaths
from data_storage.chinese_mainland.ZODBStorage import get_zodb_storage
from utils.time_helper import asia_today, get_last_business_day


class FetchScope:
    """单次 get_stock_data 调用的拉取去重（review #2+#3）：每源每 ticker 只拉
    一次，三个消费者（概览 / 历史 / 业绩）共享同一 DataFrame。

    - daily 大小感知复用：缓存满足请求（len >= 请求根数）→ 复用；否则按本次
      请求重拉。全量请求（max_bars=None）只在首建出现、此时缓存必空 → 全量
      恰拉一次。
    - 失败标记：源抛异常 / 返回空 → 该 key 记 failed 并（异常时）重新抛出
      （消费者既有 catch 处理）；failed 后本 scope 内后续请求直接返回空
      DataFrame（与 _fetch_degraded 的 None 语义对齐，消费者按空降级）。
    - 不吞异常、不改变返回 DataFrame 的列序/类型——data_source 层契约不变。
    """

    def __init__(self, src):
        self._src = src
        # daily 缓存记 (df, requested_bars)：请求尺寸而非实际行数——
        # max_bars=250 的拉取返回 ≤250 行（新上市短历史可能仅 100 行），
        # 请求 250 复用 100 行是**正确**的（服务器已给全部）；按行数判
        # 定会错误重拉。requested_bars=None = 全量，覆盖一切请求。
        self._cache: dict[tuple[str, str], tuple[pd.DataFrame, int | None]] = {}
        self._failed: set[tuple[str, str]] = set()

    def _get(self, source: str, ticker: str, fetcher) -> pd.DataFrame:
        key = (source, ticker)
        if key in self._failed:
            return pd.DataFrame()
        if key in self._cache:
            return self._cache[key][0]
        try:
            df = fetcher()
        except Exception:
            self._failed.add(key)
            raise
        if df is None or df.empty:
            self._failed.add(key)
            return pd.DataFrame()
        self._cache[key] = (df, None)
        return df

    def fetch_daily(self, ticker: str, max_bars: int | None = None) -> pd.DataFrame:
        key = ("daily", ticker)
        if key in self._failed:
            return pd.DataFrame()
        cached = self._cache.get(key)
        if cached is not None:
            df, cached_bars = cached
            if cached_bars is None or (max_bars is not None and cached_bars >= max_bars):
                return df
        try:
            df = self._src.fetch_daily(ticker, max_bars=max_bars)
        except Exception:
            self._failed.add(key)
            raise
        if df is None or df.empty:
            self._failed.add(key)
            return pd.DataFrame()
        self._cache[key] = (df, max_bars)
        return df

    def fetch_snapshot(self, ticker: str) -> pd.DataFrame:
        return self._get("snapshot", ticker, lambda: self._src.fetch_snapshot(ticker))

    def fetch_finance_capital(self, ticker: str) -> pd.DataFrame:
        return self._get("capital", ticker, lambda: self._src.fetch_finance_capital(ticker))

    def fetch_company_finance(self, ticker: str) -> pd.DataFrame:
        return self._get("f10", ticker, lambda: self._src.fetch_company_finance(ticker))

    def fetch_xdxr(self, ticker: str) -> pd.DataFrame:
        return self._get("xdxr", ticker, lambda: self._src.fetch_xdxr(ticker))


class DataAcquisition(LegacyAksharePaths):
    def __init__(self):
        # 进程级单例连接（见 get_zodb_storage docstring：FileStorage flock 不可重入）
        self.storage = get_zodb_storage()

    def acquire_historical_data_tdx(self, ticker, _scope=None):
        """TDX(pytdx) 历史行情路径：akshare 路径的快速替代，失败返回 False。

        与 akshare 版本相同的约定：新鲜度优先、布尔结果协议、loguru {} 占位。
        数据链路：TdxSource(fetch_daily + fetch_xdxr + fetch_finance_capital)
        → mapping.to_akshare_hist_schema（12 列序，与 akshare 一致）
        → qfq_adjust（前复权，对齐 akshare qfq 口径）→ ChinaStockData 位置构造。

        异常处理约定（本方法为数据层唯一捕获点，见 spec 更新）：
        - finance_capital / xdxr 失败降级（换手率 NaN / 未复权），不阻断主路径
        - daily 拉取失败 → logger.error + return False——PRD 纯 TDX 无 akshare
          兜底；get_stock_data 忽略返回值记日志不阻断，返回已构建的 stock

        _scope（review #2+#3）：FetchScope 透传——给出时各源拉取走 scope
        复用（与概览/业绩共享同一 DataFrame）；None → 独立直拉（独立调用
        语义不变）。方法名与 TdxSource 同构，`_scope or TdxSource()` 直接
        作 fetcher。

        读写锁（review #5）：数据阶段全程持 `storage.lock`（RLock，get →
        mutate → commit 嵌套可重入）——单例连接非线程安全，Streamlit 多会话
        并发读写同一连接会 POSKeyError/ConflictError。锁不跨 LLM 调用
        （图阶段零 ZODB 访问）。
        """
        with self.storage.lock:
            stock = self.storage.get_stock(ticker)
            if stock is None:
                logger.error("Stock {} not found in database.", ticker)
                return False
            logger.debug("Stock {} found in database, last data date is {}.", ticker, stock.last_data_update)
            # 修复：date==date 比较（原 == datetime.today() 恒假，新鲜度短路死代码）
            if stock.last_data_update == asia_today():
                logger.info("Stock {} historical data is already up to date.", ticker)
                return True

            # 修复：缺口 > 120 自然日（含 1997-01-01 首次构建）→ max_bars=None
            # 全量回填一次，消除"120 根永久空洞"（原 120 截断 → add_data 拒绝
            # 补旧）。缺口 ≤ 120 → 增量拉 gap 根（自然日 ≥ 交易日，够覆盖）。
            gap_days = self._history_gap(stock)
            if not gap_days > 0:
                logger.info("Stock {} historical data is already up to date.", ticker)
                return True
            max_bars = None if gap_days > 120 else gap_days

            tdx_source = _scope or TdxSource()

            float_shares = None
            try:
                capital = tdx_source.fetch_finance_capital(ticker)
                if not capital.empty and "liutongguben" in capital.columns:
                    float_shares = float(capital["liutongguben"].iloc[0])
            except Exception:
                logger.warning("Finance capital unavailable for {}; turnover_rate will be NaN.", ticker)

            try:
                daily = tdx_source.fetch_daily(ticker, max_bars=max_bars)
            except Exception:
                logger.error("TDX daily fetch failed for {}; historical data unavailable.", ticker)
                return False

            xdxr = pd.DataFrame()
            try:
                xdxr = tdx_source.fetch_xdxr(ticker)
            except Exception:
                logger.warning("TDX xdxr fetch failed for {}; using unadjusted prices.", ticker)

            mapped = to_akshare_hist_schema(daily, ticker, float_shares=float_shares)
            adjusted = qfq_adjust(mapped, xdxr)
            # 批量追加（review #3）：先收集后一次 commit——首建全量回填数千行 = 1 个
            # 事务（原逐行 add_data 数千次 FileStorage tpc）
            rows = [
                ChinaStockData.ChinaStockData(*list(row.values()))
                for row in adjusted.to_dict(orient='records')
            ]
            stock.add_datas(rows)

            self.storage.put_stock(ticker, stock)
            logger.info("Historical data for stock {} updated until {}.", ticker, stock.last_data_update)
            return True

    def ensure_stock(self, ticker, _build_overview=None, _scope=None):
        """按需单股构建概览：storage 无该股票 → TDX build_overview → put_stock。

        已有股票分支的概览 freshness 门（review #1，2026-08-02）：storage
        已有 → 检查 `overview_last_update`，**早于当前交易日**（date 比较，
        与 storage 层 17:00 门精神一致但更简单：同日多次分析结果稳定，跨
        交易日必刷新）→ 重建概览；未命中 → 直接 True（幂等）。重建 best-
        effort：build_overview None（无价格来源）→ logger.warning + 保留旧
        概览，仍返回 True（刷新失败不阻断分析，与业绩 freshness 门的"跳过
        不失败"语义一致）。`overview_last_update` 由此从只写死字段变为真实
        freshness 标记（update_overview 同步 + commit）。

        构建失败（build_overview 返回 None，snapshot 与日K 均无价格来源）→
        logger.error + False——与 acquire_performance_report_tdx 的"无报告不算
        失败"语义区分（error-handling.md：expected absence 才回 False）。

        _build_overview：测试注入点（house style 无 mock 框架）——默认
        TdxSource().build_overview（远端 TDX），测试传计数包装验证门跳过/
        命中时不触发网络。

        _scope（review #2+#3）：FetchScope 透传——给出时构建/刷新走
        overview.build_overview(_scope=...) 复用共享拉取；None → 独立直拉
        （独立调用语义不变）。_build_overview 注入点优先级最高（完整替换）。

        读写锁（review #5）：数据阶段全程持 `storage.lock`（RLock 可重入）。
        """
        with self.storage.lock:
            if _build_overview is None:
                if _scope is not None:
                    _build_overview = lambda t: _build_overview_module(t, _scope=_scope)
                else:
                    _build_overview = TdxSource().build_overview
            stock = self.storage.get_stock(ticker)
            if stock is not None:
                if self._overview_stale(stock):
                    overview_df = _build_overview(ticker)
                    if overview_df is None:
                        logger.warning("Overview refresh failed for {}; keeping previous overview.", ticker)
                    else:
                        # 22 列序契约（overview.py OVERVIEW_COLUMNS == StockOverview 字段序）
                        row = overview_df.to_dict(orient='records')[0]
                        stock.update_overview(new_overview=StockOverview(*list(row.values())))
                        logger.info("Overview refreshed for {}.", ticker)
                return True
            # 北交所（4/8 前缀）：TDX 全链路不可用（无名称/无行情）——显式提示 +
            # 失败返回，不静默 NaN（BJ 走 akshare 备用路径，见 README）
            if is_bj_ticker(ticker):
                logger.warning(
                    "Ticker {} is a Beijing Stock Exchange (BJ) code; TDX does not serve BJ securities (no name/quotes). Use the akshare fallback path instead.",
                    ticker,
                )
                return False
            overview_df = _build_overview(ticker)
            if overview_df is None:
                logger.error("TDX overview build failed for {}.", ticker)
                return False
            # 22 列序契约（overview.py OVERVIEW_COLUMNS == StockOverview 字段序）：
            # 全量 22 值位置构造，无 [1:] 切片（与 akshare 路径不同，见 data_source spec）
            row = overview_df.to_dict(orient='records')[0]
            stock_overview = StockOverview(*list(row.values()))
            stock = ChinaStock.ChinaStock(stock_overview.name, stock_overview.ticker, stock_overview)
            self.storage.put_stock(stock_overview.ticker, stock)
            return True

    def _overview_stale(self, stock) -> bool:
        """概览 freshness（review #1 门基准）：overview_last_update 早于当前
        交易日 → True（需重建概览）。与历史/业绩门共用同一"当前交易日"
        来源（get_last_business_day + asia_today），协调器（get_stock_data
        预播种）与消费者方法不双份逻辑（review #2+#3）。"""
        return stock.overview_last_update.date() < get_last_business_day(asia_today())

    def _history_gap(self, stock) -> int:
        """历史数据缺口（自然日）：0 = 已最新（无需拉取）。"""
        return max((get_last_business_day(asia_today()) - stock.last_data_update).days, 0)

    def _reports_stale(self, stock) -> bool:
        """业绩 freshness 门：最新 report_date == 最近一个已到截止日的季度末
        → 已最新（False）；无报告或未达（披露滞后）→ True（需拉 F10）。"""
        latest_quarter_end = self._latest_past_quarter_end(asia_today())
        return not (stock.performance_reports and stock.performance_reports[-1].report_date == latest_quarter_end)

    def _latest_past_quarter_end(self, today=None):
        """最近一个已到截止日的季度末（'%Y%m%d' 字符串）——业绩 freshness 门基准。

        与 get_next_report_date / get_latest_possible_report_date 同一季度末
        推算（0331/0630/0930/1231）：1-3 月 → 上一年 1231；4-6 月 → 本年
        0331；7-9 月 → 本年 0630；10-12 月 → 本年 0930（今天 2026-08-02 →
        '20260630'）。返回字符串与 StockPerformanceReport.report_date
        （'%Y%m%d'）协议一致，可直接 == 比较。
        """
        today = today or asia_today()
        if today.month < 4:
            return datetime(today.year - 1, 12, 31).strftime('%Y%m%d')
        elif today.month < 7:
            return datetime(today.year, 3, 31).strftime('%Y%m%d')
        elif today.month < 10:
            return datetime(today.year, 6, 30).strftime('%Y%m%d')
        else:
            return datetime(today.year, 9, 30).strftime('%Y%m%d')

    def acquire_performance_report_tdx(self, ticker, _fetch_reports=None, _scope=None):
        """TDX F10 业绩报告路径：freshness 门 → build_reports 单表多行 → 批量入仓。

        布尔协议：storage 无该股票 → logger.error + False（expected absence）；
        有 → 批量 add_performance_reports（单次 commit，report_date 字符串
        递增去重）→ put_stock → True。build_reports 返回 None（F10 拉取失败/
        无报告）→ logger.warning + True——无报告不是失败，与 ensure_stock 的
        构建失败语义区分。

        Freshness 门（2026-08-02，对齐日K"先查再拉"）：调 build_reports（远端
        F10）前先读 ZODB 最新 report_date（performance_reports[-1]，无报告 →
        门未命中直接拉）。门命中 = 最新 report_date == 最近一个已到截止日的
        季度末（_latest_past_quarter_end）→ logger.debug + True（不拉远端）。
        披露滞后语义：公司未披露当期报告时 F10 最新期仍为上一季 → 门未命中
        → 照常拉取（拉到旧期由 add_performance_reports 去重；同季重复拉直到
        披露）——本门只承诺"该季截止日已过且已入库则不重复拉"，不引入跨季
        补拉。

        _fetch_reports：测试注入点（house style 无 mock 框架）——默认
        TdxSource().build_reports（远端 F10），测试传计数包装验证门跳过时
        不触发网络。

        _scope（review #2+#3）：FetchScope 透传——给出时 F10 拉取走
        reports.build_reports(_scope=...) 复用共享拉取；None → 独立直拉。

        读写锁（review #5）：数据阶段全程持 `storage.lock`（RLock 可重入）。
        """
        with self.storage.lock:
            stock = self.storage.get_stock(ticker)
            if stock is None:
                logger.error("Stock {} not found in database.", ticker)
                return False
            latest_quarter_end = self._latest_past_quarter_end(asia_today())
            if not self._reports_stale(stock):
                logger.debug("Performance reports for {} already include the latest quarter {}; skipping F10 fetch.", ticker, latest_quarter_end)
                return True
            if _fetch_reports is None:
                if _scope is not None:
                    _fetch_reports = lambda t: _build_reports_module(t, _scope=_scope)
                else:
                    _fetch_reports = TdxSource().build_reports
            reports = _fetch_reports(ticker)
            if reports is None:
                logger.warning("TDX performance reports unavailable for {}; skipped.", ticker)
                return True
            # 15 列序契约（reports.py REPORT_COLUMNS == StockPerformanceReport 字段序）；
            # 批量追加（review #3）：先收集后一次 commit
            rows = [
                StockPerformanceReport(*list(row.values()))
                for row in reports.to_dict(orient='records')
            ]
            stock.add_performance_reports(rows)
            self.storage.put_stock(ticker, stock)
            return True

    def get_stock_data(self, ticker, _scope=None):
        """纯 TDX 按需链路：ensure_stock → 历史(TDX) → 业绩(TDX)，无 akshare。

        ensure_stock 失败（无任何价格来源）→ None；历史/业绩失败各自记日志
        不阻断，返回已构建的 stock。akshare 方法（acquire_daily_overview /
        acquire_performance_report / acquire_historical_data）保留作备用，
        主流程不再调用（PRD：纯 TDX 不兜底）。

        单遍拉取（review #2+#3，2026-08-02）：创建 FetchScope 贯穿三个消费者，
        各源（daily/capital/F10/snapshot/xdxr）每次分析调用只拉一次。**预播种
        daily 必须在 ensure_stock 之前**（否则首建 overview 已按 250 拉过，
        全量需求再重拉一次）：
        - storage 无该股（首建，缺口必巨大）→ 全量 max_bars=None 预拉一次，
          覆盖 overview 250 窗口与 history 全量回填；
        - 已有股票 → 门判定（_overview_stale / _history_gap，与消费者共用
          同一 helper）算出本次需要的最大尺寸：gap>120 → 全量；否则 250
          覆盖 overview 250 与 history ≤120 缺口；两门都 fresh → 不拉
          （零拉取行为保持）。
        预播种失败 → warning + scope 标记 failed（消费者后续请求空 → 各自
        降级路径接管，保首建不阻断语义）。

        _scope：测试注入点——传计数 scope 验证各源恰一次。
        """
        scope = _scope or FetchScope(TdxSource())
        stock = self.storage.get_stock(ticker)
        if stock is None:
            try:
                scope.fetch_daily(ticker, max_bars=None)
            except Exception:
                logger.warning("Pre-seeded TDX daily fetch failed for {}; consumers will degrade.", ticker)
            if not self.ensure_stock(ticker, _scope=scope):
                return None
        else:
            gap = self._history_gap(stock)
            if self._overview_stale(stock) or gap > 0:
                try:
                    scope.fetch_daily(ticker, max_bars=None if gap > 120 else max(250, gap))
                except Exception:
                    logger.warning("Pre-seeded TDX daily fetch failed for {}; consumers will degrade.", ticker)
            self.ensure_stock(ticker, _scope=scope)
        self.acquire_historical_data_tdx(ticker, _scope=scope)
        self.acquire_performance_report_tdx(ticker, _scope=scope)
        return self.storage.get_stock(ticker)
