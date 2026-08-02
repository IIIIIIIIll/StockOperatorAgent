from datetime import datetime, timedelta
import pandas as pd
from data_source.chinese_mainland.tdx.adjust import qfq_adjust
from data_source.chinese_mainland.tdx.mapping import to_akshare_hist_schema
from data_source.chinese_mainland.tdx.tdx_source import TdxSource, is_bj_ticker
from data_structure.chinese_mainland import ChinaStock, ChinaStockData
from data_structure.chinese_mainland.StockOverview import StockOverview
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport
from loguru import logger
from data_storage.chinese_mainland.ZODBStorage import get_zodb_storage
from utils.time_helper import asia_today, get_last_business_day

# akshare stock_yjbb_em 列名 → StockPerformanceReport 字段映射（备用路径
# 列名契约，prd 位置构造例外授权）。yjbb_em 列序曾在 akshare 版本间插入过
# '_' 占位列（旧版位置构造把占位吃到 eps..QoQ、行业吃到净资产收益率，静默
# 写垃圾）；按列名映射 + 存在性断言对列序变化健壮。report_date 由调用方
# 赋值（'%Y%m%d'），不在映射内。1.18.81 源码实测列名见 data_source spec。
YJBB_COLUMN_MAP = {
    "股票代码": "ticker",
    "股票简称": "name",
    "每股收益": "eps",
    "营业总收入-营业总收入": "total_income",
    "营业总收入-同比增长": "total_income_YoY_rate",
    "营业总收入-季度环比增长": "total_income_QoQ_rate",
    "净利润-净利润": "net_profit",
    "净利润-同比增长": "net_profit_YoY_rate",
    "净利润-季度环比增长": "net_profit_QoQ_rate",
    "每股净资产": "net_worth_per_share",
    "净资产收益率": "net_worth_return_rate",
    "每股经营现金流量": "cash_flow_per_share",
    "销售毛利率": "sales_gross_margin",
    "所处行业": "industry",
}

class DataAcquisition:
    def __init__(self):
        # 进程级单例连接（见 get_zodb_storage docstring：FileStorage flock 不可重入）
        self.storage = get_zodb_storage()

    def acquire_daily_overview(self):
        """deprecated（备用路径，主流程不调用）：akshare 全市场概览刷新。

        主流程为纯 TDX 按需单股构建（get_stock_data → ensure_stock），
        不经过本方法；保留供 akshare 备用路径使用。
        """
        # AKShareSource 惰性导入：纯 TDX 启动不付出 akshare 重依赖成本
        from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource
        if self.storage.check_need_update_overview():
            logger.info("Updating stock overview data...")
            self.update_shex_overview()
            self.update_szex_overview()
            self.update_bjex_overview()
            self.storage.set_overview_updated_now()
        return True

    def update_shex_overview(self):
        """deprecated（备用路径，主流程不调用）：akshare 沪市概览。"""
        from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource
        for row in AKShareSource().fetch_shex_stocks().to_dict(orient='records'):
            self.update_overview_in_storage(row)
        return True

    def update_szex_overview(self):
        """deprecated（备用路径，主流程不调用）：akshare 深市概览。"""
        from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource
        for row in AKShareSource().fetch_szex_stocks().to_dict(orient='records'):
            self.update_overview_in_storage(row)
        return True

    def update_bjex_overview(self):
        """deprecated（备用路径，主流程不调用）：akshare 北交所概览。"""
        from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource
        for row in AKShareSource().fetch_bjex_stocks().to_dict(orient='records'):
            self.update_overview_in_storage(row)
        return True

    def update_overview_in_storage(self, row):
        """deprecated（备用路径，主流程不调用）：akshare 概览行 → storage。"""
        stock_overview = StockOverview(*list(row.values())[1:])
        if self.storage.get_stock(stock_overview.ticker) is None:
            logger.debug(f"Stock overview for {stock_overview.ticker} not found in database.")
            stock = ChinaStock.ChinaStock(stock_overview.name, stock_overview.ticker, stock_overview)
            self.storage.put_stock(stock_overview.ticker, stock)
        else:
            logger.debug(f"Stock overview for {stock_overview.ticker} found in database, updating.")
            stock = self.storage.get_stock(stock_overview.ticker)
            stock.update_overview(new_overview=stock_overview)
            self.storage.put_stock(stock_overview.ticker, stock)
        logger.info(stock_overview)
        return True

    def acquire_historical_data(self, ticker):
        """deprecated（备用路径，主流程不调用）：akshare 历史日K。

        主流程用 acquire_historical_data_tdx（TDX 按需增量）；本方法保留
        供 akshare 备用路径使用（既有测试引用）。
        """
        from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource
        stock = self.storage.get_stock(ticker)
        if stock is None:
            logger.error(f"Stock {ticker} not found in database.")
            return False
        else:
            logger.debug(f"Stock {ticker} found in database, last data date is {stock.last_data_update}.")
            # 修复：date==date 比较（原 == datetime.today() 恒假，新鲜度短路
            # 是死代码，每次无谓重拉靠 add_data 去重掩盖）
            if stock.last_data_update == asia_today():
                logger.info(f"Stock {ticker} historical data is already up to date.")
                return True

        # 修复：缺口不再截断 120 自然日——缺口多大拉多大（含 1997-01-01
        # 首次构建的全量回填），消除"缺口 > 120 → 永久空洞"问题。窗口按
        # 自然日（fetch_stock_history 内部 ×7//5 折算交易日余量）。
        last_bd = get_last_business_day(asia_today())
        gap_days = (last_bd - stock.last_data_update).days
        if not gap_days > 0:
            logger.info(f"Stock {ticker} historical data is already up to date.")
            return True

        for row in AKShareSource().fetch_stock_history(ticker, look_back_days=gap_days).to_dict(orient='records'):
            stock_data = ChinaStockData.ChinaStockData(*list(row.values()))
            logger.debug(stock_data)
            stock.add_data(stock_data)

        self.storage.put_stock(ticker, stock)
        logger.info(f"Historical data for stock {ticker} updated until {stock.last_data_update}.")
        return True

    def acquire_historical_data_tdx(self, ticker):
        """TDX(pytdx) 历史行情路径：akshare 路径的快速替代，失败返回 False 走兜底。

        与 akshare 版本相同的约定：新鲜度优先、布尔结果协议、loguru {} 占位。
        数据链路：TdxSource(fetch_daily + fetch_xdxr + fetch_finance_capital)
        → mapping.to_akshare_hist_schema（12 列序，与 akshare 一致）
        → qfq_adjust（前复权，对齐 akshare qfq 口径）→ ChinaStockData 位置构造。

        异常处理约定（本方法为数据层唯一捕获点，见 spec 更新）：
        - finance_capital / xdxr 失败降级（换手率 NaN / 未复权），不阻断主路径
        - daily 拉取失败 → logger.error + return False → 调用方回退 akshare
        """
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
        last_bd = get_last_business_day(asia_today())
        gap_days = (last_bd - stock.last_data_update).days
        if not gap_days > 0:
            logger.info("Stock {} historical data is already up to date.", ticker)
            return True
        max_bars = None if gap_days > 120 else gap_days

        tdx_source = TdxSource()

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
        for row in adjusted.to_dict(orient='records'):
            stock_data = ChinaStockData.ChinaStockData(*list(row.values()))
            stock.add_data(stock_data)

        self.storage.put_stock(ticker, stock)
        logger.info("Historical data for stock {} updated until {}.", ticker, stock.last_data_update)
        return True

    def get_next_report_date(self, last_report_date):
        """deprecated（备用路径，主流程不调用）：业绩报表报告期步进。"""
        year = last_report_date.year
        month = last_report_date.month
        if month <= 3:
            return datetime(year, 6, 30).date()
        elif month <= 6:
            return datetime(year, 9, 30).date()
        elif month <= 9:
            return datetime(year, 12, 31).date()
        else:
            return datetime(year+1, 3, 31).date()


    def get_latest_possible_report_date(self, today=None):
        """deprecated（备用路径，主流程不调用）：最近一个已结束报告期（acquire_performance_report 轮询上限）。

        1-3 月 → 上一年年报（1231）：当年 1231 尚未发生，用它拉未来报告期
        且永远漏掉去年年报（原 '1230' 还差一天）；4-6 月 → 本年 0331；
        7-9 月 → 本年 0630；10-12 月 → 本年 0930（30/31 均已核对无误）。
        返回 datetime.date。
        """
        today = today or asia_today()
        year = today.year
        if today.month < 4:
            return datetime(year - 1, 12, 31).date()
        elif today.month < 7:
            return datetime(year, 3, 31).date()
        elif today.month < 10:
            return datetime(year, 6, 30).date()
        else:
            return datetime(year, 9, 30).date()

    def build_performance_report_from_row(self, row, report_date):
        """deprecated（备用路径，主流程不调用）：yjbb_em 行 → StockPerformanceReport（按列名映射，位置构造例外）。

        列名存在性断言：任一必需列缺失 → logger.error + 返回 None（调用方
        acquire_performance_report 据此 return False，不静默写垃圾——位置
        构造在 yjbb 列序变化时会静默错位）。report_date 为 '%Y%m%d' 字符串。
        """
        missing = [col for col in YJBB_COLUMN_MAP if col not in row]
        if missing:
            logger.error("yjbb_em 列名缺失 {}，期望列名契约 {}；跳过写入。", missing, list(YJBB_COLUMN_MAP))
            return None
        return StockPerformanceReport(
            ticker=row["股票代码"], name=row["股票简称"], eps=row["每股收益"],
            total_income=row["营业总收入-营业总收入"],
            total_income_YoY_rate=row["营业总收入-同比增长"],
            total_income_QoQ_rate=row["营业总收入-季度环比增长"],
            net_profit=row["净利润-净利润"],
            net_profit_YoY_rate=row["净利润-同比增长"],
            net_profit_QoQ_rate=row["净利润-季度环比增长"],
            net_worth_per_share=row["每股净资产"],
            net_worth_return_rate=row["净资产收益率"],
            cash_flow_per_share=row["每股经营现金流量"],
            sales_gross_margin=row["销售毛利率"],
            industry=row["所处行业"],
            report_date=report_date,
        )

    def acquire_performance_report(self, ticker='601988'):
        """deprecated（备用路径，主流程不调用）：akshare 拉取业绩报表。

        主流程用 acquire_performance_report_tdx（TDX F10）。'601988' 为
        历史遗留演示默认值（硬编码参数化：签名兼容，旧调用不传参仍可用）；
        每次调用 logger.warning 显式提示这是演示代码 + 备用路径。
        """
        from data_source.chinese_mainland.akshare.fetch_stcok_data import AKShareSource
        logger.warning("acquire_performance_report: legacy akshare fallback (demo ticker {}); main flow uses acquire_performance_report_tdx.", ticker)
        stock = self.storage.get_stock(ticker)
        if stock is None:
            logger.error(f"Stock {ticker} not found in database.")
            return False

        last_report_year = (asia_today() - timedelta(6*365)).year
        last_report_date = datetime.strptime(f"{last_report_year}1231", '%Y%m%d').date()
        if  len(stock.performance_reports) == 0:
            logger.debug(f"Stocks has no performance reports in database.")
        else:
            logger.debug(f"Stocks last report date is {stock.performance_reports[-1].report_date}.")
            last_report_date = datetime.strptime(stock.performance_reports[-1].report_date, '%Y%m%d').date()

        # 修复：latest_possible_date 纯函数（1-3 月 → 上一年 1231，不拉未来）
        latest_possible_date = self.get_latest_possible_report_date()

        next_report_date = self.get_next_report_date(last_report_date)
        logger.debug(f"Lastest report date is {latest_possible_date}.")
        while next_report_date <= latest_possible_date:
            logger.info(f"Fetching report for {next_report_date}.")
            report_df = AKShareSource().fetch_performance_report(next_report_date.strftime('%Y%m%d'))
            # 列名契约断言：yjbb 列序曾在版本间变化，位置构造会静默错位写垃圾
            if not set(YJBB_COLUMN_MAP).issubset(report_df.columns):
                logger.error("yjbb_em 列名契约不符：缺 {}（期望 {}）；不写库。", set(YJBB_COLUMN_MAP) - set(report_df.columns), list(YJBB_COLUMN_MAP))
                return False
            for row in report_df.to_dict(orient='records'):
                stock_performance = self.build_performance_report_from_row(row, next_report_date.strftime('%Y%m%d'))
                if stock_performance is None:
                    return False
                self.add_performance_report_in_storage(stock_performance)

            next_report_date = self.get_next_report_date(next_report_date)

        return True


    def add_performance_report_in_storage(self, stock_performance):
        """deprecated（备用路径，主流程不调用）：业绩报告行 → storage。"""
        if self.storage.get_stock(stock_performance.ticker) is None:
            logger.error(f"Stock {stock_performance.ticker} not found in database.")
            return False
        else:
            logger.debug(f"Stock {stock_performance.ticker} found in database, adding performance report.")
            stock = self.storage.get_stock(stock_performance.ticker)
            stock.add_performance_report(performance_report=stock_performance)
            self.storage.put_stock(stock.ticker, stock)
        return True

    def ensure_stock(self, ticker, _build_overview=None):
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
        """
        stock = self.storage.get_stock(ticker)
        if stock is not None:
            if stock.overview_last_update.date() < get_last_business_day(asia_today()):
                if _build_overview is None:
                    _build_overview = TdxSource().build_overview
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
        overview_df = TdxSource().build_overview(ticker)
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

    def acquire_performance_report_tdx(self, ticker, _fetch_reports=None):
        """TDX F10 业绩报告路径：freshness 门 → build_reports 单表多行 → 逐行入仓。

        布尔协议：storage 无该股票 → logger.error + False（expected absence）；
        有 → 每份 add_performance_report（内部已 commit，report_date 字符串
        比较去重）→ put_stock → True。build_reports 返回 None（F10 拉取失败/
        无报告）→ logger.warning + True——无报告不是失败，与 ensure_stock 的
        构建失败语义区分。

        Freshness 门（2026-08-02，对齐日K"先查再拉"）：调 build_reports（远端
        F10）前先读 ZODB 最新 report_date（performance_reports[-1]，无报告 →
        门未命中直接拉）。门命中 = 最新 report_date == 最近一个已到截止日的
        季度末（_latest_past_quarter_end）→ logger.debug + True（不拉远端）。
        披露滞后语义：公司未披露当期报告时 F10 最新期仍为上一季 → 门未命中
        → 照常拉取（拉到旧期由 add_performance_report 去重；同季重复拉直到
        披露）——本门只承诺"该季截止日已过且已入库则不重复拉"，不引入跨季
        补拉。

        _fetch_reports：测试注入点（house style 无 mock 框架）——默认
        TdxSource().build_reports（远端 F10），测试传计数包装验证门跳过时
        不触发网络。
        """
        stock = self.storage.get_stock(ticker)
        if stock is None:
            logger.error("Stock {} not found in database.", ticker)
            return False
        latest_quarter_end = self._latest_past_quarter_end(asia_today())
        if stock.performance_reports and stock.performance_reports[-1].report_date == latest_quarter_end:
            logger.debug("Performance reports for {} already include the latest quarter {}; skipping F10 fetch.", ticker, latest_quarter_end)
            return True
        if _fetch_reports is None:
            _fetch_reports = TdxSource().build_reports
        reports = _fetch_reports(ticker)
        if reports is None:
            logger.warning("TDX performance reports unavailable for {}; skipped.", ticker)
            return True
        # 15 列序契约（reports.py REPORT_COLUMNS == StockPerformanceReport 字段序）
        for row in reports.to_dict(orient='records'):
            report = StockPerformanceReport(*list(row.values()))
            stock.add_performance_report(report)
        self.storage.put_stock(ticker, stock)
        return True

    def get_stock_data(self, ticker):
        """纯 TDX 按需链路：ensure_stock → 历史(TDX) → 业绩(TDX)，无 akshare。

        ensure_stock 失败（无任何价格来源）→ None；历史/业绩失败各自记日志
        不阻断，返回已构建的 stock。akshare 方法（acquire_daily_overview /
        acquire_performance_report / acquire_historical_data）保留作备用，
        主流程不再调用（PRD：纯 TDX 不兜底）。
        """
        if not self.ensure_stock(ticker):
            return None
        self.acquire_historical_data_tdx(ticker)
        self.acquire_performance_report_tdx(ticker)
        return self.storage.get_stock(ticker)
