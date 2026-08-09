"""TDX 按需单股业绩报告构建层：F10 tidy long → 每报告期一行 15 列。

akshare 的业绩报表是全市场扫描（stock_yjbb_em），pytdx 无等效接口；本模块
改为按需单股构建：F10（``fetch_company_finance``，tidy long：metric × period
两维）按报告期 pivot 成每期一行，映射到 StockPerformanceReport 字段，QoQ 环比
自算。数据流见 .trellis/tasks/08-02-tdx-overview-reports design.md §3。

**15 列名契约**：输出 DataFrame 的 15 列与 StockPerformanceReport 的 15 个
字段序一一对应，列名即英文字段名（ticker/name/eps/.../report_date，见
data_structure/chinese_mainland/StockPerformanceReport.py）。消费者用
``StockPerformanceReport.from_row(row)`` 命名构造（08-09——列名已是字段
名 → from_row 恒等路径，无需 column_map）。

字段映射与派生（缺失留 NaN，不整块失败）：
- 8 个指标直接映射 F10 metric（名字见 METRIC_COLUMNS，与 overview.py 的
  ``latest_period_value`` 同一读取口径：metric/period/value_num 三列）
- total_income_QoQ_rate / net_profit_QoQ_rate：相邻报告期自算
  (本期-上期)/上期×100，首期 NaN，除零 → NaN（负分母合法——净利润可为负，
  与 overview._divide 的"分母 ≤0 → NaN"约定不同，环比只防除零）；仅当相邻
  period 间隔恰为一季度（3 个月 ± 容差）才计算，缺报告期 → NaN（见 _qoq_series）
- sales_gross_margin：F10 无 → NaN（float64）；industry：F10 无 → 空串
  ""（保持 str 字段契约——float NaN 写进 StockPerformanceReport.industry: str
  会污染类型）
- name：get_stock_name（失败回退 ticker，永不 NaN）
- report_date：period 'YYYY-MM-DD' → '%Y%m%d' 字符串（与
  ``add_performance_report`` 的字符串比较协议兼容，不转 datetime——见
  cross-layer-thinking-guide Mistake 4）

F10 拉取失败 / 无任何可映射指标 → 返回 None（调用方报错回 False/跳过）；
其余组合均可构建（缺指标字段为 NaN）。
"""

from __future__ import annotations

import pandas as pd
from loguru import logger

from data_source.chinese_mainland.tdx.tdx_source import get_tdx_source

NAN = float("nan")

# 输出列序 = StockPerformanceReport 字段序，列名即英文字段名（ticker,name,
# eps,...,report_date）——from_row 恒等路径（column_map=None）按字段名取值，
# 列序不再承重。顺序勿改（输出列序契约）；与字段数的对齐由 test_tdx_reports.py
# 钉死（REPORT_COLUMNS == [f.name for f in fields(StockPerformanceReport)]）。
REPORT_COLUMNS = [
    "ticker", "name", "eps", "total_income", "total_income_YoY_rate",
    "total_income_QoQ_rate", "net_profit", "net_profit_YoY_rate",
    "net_profit_QoQ_rate", "net_worth_per_share", "net_worth_return_rate",
    "cash_flow_per_share", "sales_gross_margin", "industry", "report_date",
]

# F10 metric（vendor 实际输出名，2026-08-02 实测确认与 design.md §3 一致）→
# 输出列名。顺序即 REPORT_COLUMNS 中 8 个指标列的顺序，勿改。
METRIC_COLUMNS = {
    "eps": "基本每股收益(元)",
    "total_income": "营业总收入(元)",
    "total_income_YoY_rate": "营业总收入增长率(%)",
    "net_profit": "净利润(元)",
    "net_profit_YoY_rate": "净利润增长率(%)",
    "net_worth_per_share": "每股净资产(元)",
    "net_worth_return_rate": "加权净资产收益率(%)",
    "cash_flow_per_share": "每股经营现金流量(元)",
}


def _qoq_series(s: pd.Series) -> pd.Series:
    """环比序列：(本期-上期)/上期×100；仅相邻报告期（间隔恰为一季度）计算。

    相邻性校验：period 索引（'YYYY-MM-DD' 字符串，ISO 升序）转日期后，
    相邻期间隔 ∈ [88, 93] 天（季度末间隔 90/91/92 天 + 容差）才视为相邻——
    缺报告期（跨 2+ 季度）位置 QoQ 置 NaN，不静默按"相邻期"算环比。
    首期（无上期）NaN，除零 → NaN；负分母合法（净利润可为负——与
    overview._divide 的"分母 ≤0 → NaN"约定不同，环比只防除零）。
    """
    prev = s.shift(1)
    ok = prev.notna() & (prev != 0) & s.notna()
    # 保持 s 的索引构造 delta（默认 RangeIndex 与 s 的 period 索引对齐后全 False）
    delta_days = pd.Series(pd.to_datetime(s.index), index=s.index).diff().dt.days
    ok = ok & delta_days.between(88, 93)  # 首期 delta NaN → False
    out = pd.Series(NAN, index=s.index)
    out.loc[ok] = (s[ok] - prev[ok]) / prev[ok] * 100
    return out


def compose_reports(
    ticker: str,
    name: str,
    f10_df: pd.DataFrame | None = None,
) -> pd.DataFrame | None:
    """纯函数：F10 tidy long → 每报告期一行 15 列 DataFrame（不访问网络）。

    ``f10_df`` 为 TdxSource.fetch_company_finance 的原始输出（None = 该源失败/
    缺失）；period 升序排序（ISO 字符串可排序）后计算 QoQ；报告期缺某指标 →
    该格 NaN。无任何可映射指标 / f10_df 缺失 → None。
    """
    if (
        f10_df is None
        or f10_df.empty
        or "metric" not in f10_df.columns
        or "period" not in f10_df.columns
        or "value_num" not in f10_df.columns
    ):
        return None

    known = set(METRIC_COLUMNS.values())
    # F10 metric 命中率告警：8 个指标名与 vendor 文本强耦合，vendor 改名即
    # 全部 NaN 无告警——命中率（已找到的已知指标 / 8）< 50% → warning。
    present_known = len(set(f10_df["metric"].dropna()) & known)
    hit_rate = present_known / len(known)
    if hit_rate < 0.5:
        logger.warning(
            "F10 metric hit rate for {} is {}/{} ({}%) — below 50%; vendor metric names may have changed, related fields will be NaN.",
            ticker, present_known, len(known), int(hit_rate * 100),
        )

    sub = f10_df[f10_df["metric"].isin(known)].dropna(subset=["period"])
    if sub.empty:
        return None

    wide = sub.pivot_table(index="period", columns="metric", values="value_num", aggfunc="first")
    wide = wide.rename(columns={value: key for key, value in METRIC_COLUMNS.items()})
    # 固定 8 列顺序；缺失指标列补 NaN（reindex 而非索引——F10 缺某指标不报错）
    wide = wide.reindex(columns=list(METRIC_COLUMNS))
    wide.index = wide.index.astype(str)
    wide = wide.sort_index()  # ISO 字符串升序 = 时间升序

    wide["total_income_QoQ_rate"] = _qoq_series(wide["total_income"])
    wide["net_profit_QoQ_rate"] = _qoq_series(wide["net_profit"])

    rows = []
    for period, row in wide.iterrows():
        rows.append({
            "ticker": ticker,
            "name": name,
            "eps": row["eps"],
            "total_income": row["total_income"],
            "total_income_YoY_rate": row["total_income_YoY_rate"],
            "total_income_QoQ_rate": row["total_income_QoQ_rate"],
            "net_profit": row["net_profit"],
            "net_profit_YoY_rate": row["net_profit_YoY_rate"],
            "net_profit_QoQ_rate": row["net_profit_QoQ_rate"],
            "net_worth_per_share": row["net_worth_per_share"],
            "net_worth_return_rate": row["net_worth_return_rate"],
            "cash_flow_per_share": row["cash_flow_per_share"],
            "sales_gross_margin": NAN,  # F10 无（float64 NaN）
            "industry": "",  # F10 无；空串保持 str 契约（float NaN 污染 industry: str）
            "report_date": str(period).replace("-", ""),  # 'YYYY-MM-DD' → '%Y%m%d'
        })
    return pd.DataFrame(rows, columns=REPORT_COLUMNS)


def build_reports(ticker: str, _scope=None) -> pd.DataFrame | None:
    """按需单股构建业绩报告 DataFrame（每报告期一行；列序契约见模块 docstring）。

    **首选 raw 文本路径（08-02-fix-f10-quarterly-data）**：vendor 解析器把
    F10 含季度的第二张子表 break 丢弃（tdx_company_info.py），本层改为优先
    读 company_info_raw 缓存文本 → 非 vendor 解析器（f10_parser，
    表 1+表 2 全部并入，季度齐全）；raw 缺失/解析失败 → 回退 vendor 解析
    df（现状 6 期，可用不阻断）。

    逐源降级：F10 拉取失败 / 无数据 → logger.warning + None（不 raise，调用方
    按失败处理，见 error-handling.md）；name 失败回退 ticker（永不 NaN）。

    _scope（review #2+#3）：FetchScope（core.data_acquisition）透传——给出时
    F10 拉取走 scope 复用（与概览共享同一 DataFrame）；None → 独立直拉。
    raw 文本读取绕过 scope 直读本地 parquet（无网络、无去重需求）。
    """
    from data_source.chinese_mainland.tdx.f10_parser import parse_finance_indicators_all_tables
    src = get_tdx_source()
    name = src.get_stock_name(ticker)
    fetcher = _scope or src

    # 首选：raw 缓存文本 → 非 vendor 解析器（含季度）
    raw = src.fetch_company_finance_raw(ticker)
    if raw:
        f10_df = parse_finance_indicators_all_tables(raw)
        if not f10_df.empty:
            reports = compose_reports(ticker, name, f10_df)
            if reports is not None:
                return reports

    # 回退：vendor 解析 df（无季度，可用不阻断）
    try:
        f10_df = fetcher.fetch_company_finance(ticker)
    except Exception:
        logger.warning("TDX company_finance fetch failed for {}; performance reports unavailable.", ticker)
        return None
    if f10_df is None or f10_df.empty:
        logger.warning("TDX company_finance returned no rows for {}; performance reports unavailable.", ticker)
        return None
    reports = compose_reports(ticker, name, f10_df)
    if reports is None:
        logger.warning("No usable F10 report metrics for {}; performance reports unavailable.", ticker)
        return None
    return reports
