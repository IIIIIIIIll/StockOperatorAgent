"""离线 + live 测试：TDX 按需单股业绩报告构建（15 列序契约 + QoQ 自算）。

离线用例直接调用 reports 模块的纯函数 compose_reports，用合成 F10 tidy long
验证 golden values，不访问网络；live 用例在 TDX 可达时执行、不可达跳过
（沿用 test_tdx_overview.py 风格，不把网络不可达当失败）。
"""

from dataclasses import fields

import numpy as np
import pandas as pd
import pytest

from loguru import logger

from data_source.chinese_mainland.tdx.reports import REPORT_COLUMNS, compose_reports
from data_source.chinese_mainland.tdx.tdx_source import TdxSource
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport

# 合成 F10 三个报告期（与真实 vendor 输出同构：metric/period/value_num 列）。
_PERIODS = [
    {"period": "2025-09-30", "eps": 0.62, "total_income": 1.4e12, "income_yoy": 8.5,
     "net_profit": 4.0e11, "profit_yoy": 10.2, "nwps": 11.0, "roe": 12.3, "cps": 3.2},
    {"period": "2025-12-31", "eps": 0.68, "total_income": 1.5e12, "income_yoy": 9.1,
     "net_profit": 4.3e11, "profit_yoy": 11.0, "nwps": 11.2, "roe": 12.8, "cps": 3.5},
    {"period": "2026-03-31", "eps": 0.72, "total_income": 1.6e12, "income_yoy": 9.8,
     "net_profit": 4.5e11, "profit_yoy": 12.0, "nwps": 11.5, "roe": 13.1, "cps": 3.8},
]

# F10 metric 名（vendor 实际输出）→ _PERIODS 字典键。
_METRIC_MAP = [
    ("基本每股收益(元)", "eps"),
    ("营业总收入(元)", "total_income"),
    ("营业总收入增长率(%)", "income_yoy"),
    ("净利润(元)", "net_profit"),
    ("净利润增长率(%)", "profit_yoy"),
    ("每股净资产(元)", "nwps"),
    ("加权净资产收益率(%)", "roe"),
    ("每股经营现金流量(元)", "cps"),
]


def _make_f10(periods=_PERIODS, drop_metric=None):
    """合成 F10 tidy long（metric × period 两维）。"""
    rows = []
    for p in periods:
        for metric, key in _METRIC_MAP:
            if metric == drop_metric:
                continue
            value = p[key]
            rows.append({"metric": metric, "period": p["period"],
                         "value_raw": str(value), "value_num": value})
    return pd.DataFrame(rows)


class TestComposeReports:

    def test_columns_match_stock_performance_report_fields(self):
        """15 列序契约：列名 = StockPerformanceReport 字段名，位置构造零改动复用。"""
        assert len(REPORT_COLUMNS) == len(fields(StockPerformanceReport))
        assert REPORT_COLUMNS == [f.name for f in fields(StockPerformanceReport)]
        df = compose_reports("000001", "平安银行", _make_f10())
        assert df.columns.tolist() == REPORT_COLUMNS

    def test_positional_construction_aligns_with_stock_performance_report(self):
        # 忠实于消费者路径：DataFrame → to_dict(orient='records') → 位置构造
        # StockPerformanceReport(*list(row.values()))（与 akshare 路径同构，
        # 区别是 15 列不含序号列，无需 [1:] 切片）
        df = compose_reports("000001", "平安银行", _make_f10())
        row = df.to_dict(orient="records")[-1]  # 最新报告期
        report = StockPerformanceReport(*list(row.values()))
        assert report.ticker == "000001"
        assert report.name == "平安银行"
        assert report.eps == pytest.approx(0.72)
        assert report.total_income == pytest.approx(1.6e12)
        assert report.total_income_YoY_rate == pytest.approx(9.8)
        assert report.net_profit == pytest.approx(4.5e11)
        assert report.net_profit_YoY_rate == pytest.approx(12.0)
        assert report.net_worth_per_share == pytest.approx(11.5)
        assert report.net_worth_return_rate == pytest.approx(13.1)
        assert report.cash_flow_per_share == pytest.approx(3.8)
        assert report.report_date == "20260331"
        assert np.isnan(report.sales_gross_margin)
        assert report.industry == ""  # str 字段契约：F10 无行业 → 空串非 NaN
        assert isinstance(report.industry, str)

    def test_golden_values(self):
        df = compose_reports("000001", "平安银行", _make_f10())
        assert len(df) == 3
        first, second, third = df.iloc[0], df.iloc[1], df.iloc[2]
        # 报告期升序（ISO 字符串序）
        assert list(df["report_date"]) == ["20250930", "20251231", "20260331"]
        # 直接映射指标
        assert second["eps"] == pytest.approx(0.68)
        assert second["total_income"] == pytest.approx(1.5e12)
        assert second["total_income_YoY_rate"] == pytest.approx(9.1)
        assert second["net_profit"] == pytest.approx(4.3e11)
        assert second["net_profit_YoY_rate"] == pytest.approx(11.0)
        assert second["net_worth_per_share"] == pytest.approx(11.2)
        assert second["net_worth_return_rate"] == pytest.approx(12.8)
        assert second["cash_flow_per_share"] == pytest.approx(3.5)
        # QoQ 自算：(本期-上期)/上期×100；首期 NaN
        assert np.isnan(first["total_income_QoQ_rate"])
        assert np.isnan(first["net_profit_QoQ_rate"])
        assert second["total_income_QoQ_rate"] == pytest.approx((1.5e12 - 1.4e12) / 1.4e12 * 100)
        assert third["total_income_QoQ_rate"] == pytest.approx((1.6e12 - 1.5e12) / 1.5e12 * 100)
        assert second["net_profit_QoQ_rate"] == pytest.approx((4.3e11 - 4.0e11) / 4.0e11 * 100)
        assert third["net_profit_QoQ_rate"] == pytest.approx((4.5e11 - 4.3e11) / 4.3e11 * 100)
        # F10 无 → NaN（sales_gross_margin）/ 空串（industry: str 契约）；name/ticker 恒有值
        assert np.isnan(second["sales_gross_margin"])
        assert second["industry"] == ""
        assert second["name"] == "平安银行"
        assert second["ticker"] == "000001"

    def test_periods_sorted_ascending_before_qoq(self):
        # 输入乱序 → 输出按 period 升序，QoQ 用排序后的相邻期
        df = compose_reports("000001", "平安银行", _make_f10(list(reversed(_PERIODS))))
        assert list(df["report_date"]) == ["20250930", "20251231", "20260331"]
        assert df.iloc[1]["total_income_QoQ_rate"] == pytest.approx((1.5e12 - 1.4e12) / 1.4e12 * 100)
        assert df.iloc[2]["net_profit_QoQ_rate"] == pytest.approx((4.5e11 - 4.3e11) / 4.3e11 * 100)

    def test_qoq_no_divide_by_zero(self):
        # 上期营收为 0 → QoQ NaN（不除零、不 raise）；净利润可为负，负分母合法
        periods = [
            {"period": "2025-12-31", "eps": 0.1, "total_income": 0.0, "income_yoy": 5.0,
             "net_profit": -3.0e8, "profit_yoy": -10.0, "nwps": 1.0, "roe": 1.0, "cps": 0.1},
            {"period": "2026-03-31", "eps": 0.2, "total_income": 1.0e9, "income_yoy": 6.0,
             "net_profit": 2.0e8, "profit_yoy": 20.0, "nwps": 1.1, "roe": 2.0, "cps": 0.2},
        ]
        df = compose_reports("000001", "平安银行", _make_f10(periods))
        assert np.isnan(df.iloc[0]["total_income_QoQ_rate"])  # 首期无上期
        assert np.isnan(df.iloc[0]["net_profit_QoQ_rate"])
        assert np.isnan(df.iloc[1]["total_income_QoQ_rate"])  # 上期 0 → NaN，不除零
        assert df.iloc[1]["net_profit_QoQ_rate"] == pytest.approx(
            (2.0e8 - (-3.0e8)) / (-3.0e8) * 100
        )

    def test_qoq_with_quarterly_periods(self):
        """季度补齐（08-02-fix-f10-quarterly-data）：相邻季间隔 91 天 → QoQ
        正常计算；跨年边界（2024-12-31 → 2025-03-31）同为相邻季 → 也计算
        （此前 6 期无此相邻对，行为新增——季度齐全后的正确扩展）。"""
        periods = [
            {"period": "2024-12-31", "eps": 0.5, "total_income": 1.2e12, "income_yoy": 7.0,
             "net_profit": 3.5e11, "profit_yoy": 9.0, "nwps": 10.8, "roe": 11.5, "cps": 2.8},
            {"period": "2025-03-31", "eps": 0.55, "total_income": 1.3e12, "income_yoy": 8.0,
             "net_profit": 3.8e11, "profit_yoy": 9.5, "nwps": 10.9, "roe": 11.8, "cps": 2.9},
            {"period": "2025-06-30", "eps": 0.6, "total_income": 1.4e12, "income_yoy": 8.5,
             "net_profit": 4.0e11, "profit_yoy": 10.2, "nwps": 11.0, "roe": 12.3, "cps": 3.2},
            {"period": "2025-09-30", "eps": 0.62, "total_income": 1.42e12, "income_yoy": 8.8,
             "net_profit": 4.1e11, "profit_yoy": 10.5, "nwps": 11.1, "roe": 12.5, "cps": 3.3},
        ]
        df = compose_reports("000001", "平安银行", _make_f10(periods))
        assert list(df["report_date"]) == ["20241231", "20250331", "20250630", "20250930"]
        # 跨年边界：2024-12-31 → 2025-03-31 间隔 91 天 → QoQ 计算（新增行为）
        assert df.iloc[1]["net_profit_QoQ_rate"] == pytest.approx((3.8e11 - 3.5e11) / 3.5e11 * 100)
        # 季内相邻：Q1→Q2、Q2→Q3
        assert df.iloc[2]["net_profit_QoQ_rate"] == pytest.approx((4.0e11 - 3.8e11) / 3.8e11 * 100)
        assert df.iloc[3]["net_profit_QoQ_rate"] == pytest.approx((4.1e11 - 4.0e11) / 4.0e11 * 100)
        # 首期（2024-12-31）无上期 → NaN
        assert np.isnan(df.iloc[0]["net_profit_QoQ_rate"])

    def test_qoq_nan_when_period_missing(self):
        # 缺 2025-09-30 一期：2025-12-31 vs 2025-06-30 跨 2 季度（184 天）→
        # QoQ NaN（不静默按相邻期算环比）；2026-03-31 vs 2025-12-31 相邻
        # （91 天）→ 正常计算
        periods = [
            {"period": "2025-06-30", "eps": 0.5, "total_income": 1.2e12, "income_yoy": 7.0,
             "net_profit": 3.5e11, "profit_yoy": 9.0, "nwps": 10.8, "roe": 11.5, "cps": 2.8},
            {"period": "2025-12-31", "eps": 0.68, "total_income": 1.5e12, "income_yoy": 9.1,
             "net_profit": 4.3e11, "profit_yoy": 11.0, "nwps": 11.2, "roe": 12.8, "cps": 3.5},
            {"period": "2026-03-31", "eps": 0.72, "total_income": 1.6e12, "income_yoy": 9.8,
             "net_profit": 4.5e11, "profit_yoy": 12.0, "nwps": 11.5, "roe": 13.1, "cps": 3.8},
        ]
        df = compose_reports("000001", "平安银行", _make_f10(periods))
        # 2025-12-31 的 QoQ：上期 2025-06-30 跨期 → NaN（旧代码 shift(1) 会算出 25%）
        assert np.isnan(df.iloc[1]["total_income_QoQ_rate"])
        assert np.isnan(df.iloc[1]["net_profit_QoQ_rate"])
        # 2026-03-31 的 QoQ：与 2025-12-31 相邻 → 正常
        assert df.iloc[2]["total_income_QoQ_rate"] == pytest.approx((1.6e12 - 1.5e12) / 1.5e12 * 100)
        assert df.iloc[2]["net_profit_QoQ_rate"] == pytest.approx((4.5e11 - 4.3e11) / 4.3e11 * 100)

    def test_report_date_is_ymd_string(self):
        df = compose_reports("000001", "平安银行", _make_f10())
        for value in df["report_date"]:
            assert isinstance(value, str)
            assert len(value) == 8 and value.isdigit()

    def test_missing_metric_column_is_nan(self):
        df = compose_reports("000001", "平安银行", _make_f10(drop_metric="每股经营现金流量(元)"))
        assert np.isnan(df["cash_flow_per_share"]).all()
        assert df["eps"].iloc[-1] == pytest.approx(0.72)  # 其余指标不受影响

    def test_none_empty_or_unusable_input_returns_none(self):
        assert compose_reports("000001", "000001") is None
        assert compose_reports("000001", "000001", None) is None
        assert compose_reports("000001", "000001", pd.DataFrame()) is None
        # 只含未知指标（如"审计意见"）→ 无任何可映射指标 → None
        junk = pd.DataFrame([{"metric": "审计意见", "period": "2026-03-31",
                              "value_raw": "x", "value_num": float("nan")}])
        assert compose_reports("000001", "000001", junk) is None


class TestMetricHitRateWarning:
    """F10 metric 命中率告警：已知 8 指标命中 < 50% → logger.warning。"""

    def _capture_warnings(self, f10):
        messages = []
        sink_id = logger.add(messages.append, format="{level}: {message}", level="WARNING")
        try:
            compose_reports("000001", "平安银行", f10)
        finally:
            logger.remove(sink_id)
        return messages

    def test_low_hit_rate_logs_warning(self):
        # 8 个已知指标只出现 2 个（其余被 vendor 改名/缺失）→ 命中率 25% < 50% → warning
        f10 = _make_f10()
        f10 = f10[f10["metric"].isin(["基本每股收益(元)", "净利润(元)"])]
        messages = self._capture_warnings(f10)
        assert any("hit rate" in m and "50%" in m for m in messages), messages

    def test_full_hit_rate_no_warning(self):
        # 8 个已知指标全部命中（含未知指标行也不影响）→ 无 warning
        f10 = pd.concat([
            _make_f10(),
            pd.DataFrame([
                {"metric": m, "period": "2026-03-31", "value_raw": "x", "value_num": float("nan")}
                for m in ["审计意见", "董事会决议"]
            ]),
        ], ignore_index=True)
        messages = self._capture_warnings(f10)
        assert not any("hit rate" in m for m in messages), messages


class TestLiveBuildReports:
    """live：000001 F10 → ≥1 份报告；TDX 不可达（build_reports 返回 None）→ 跳过。"""

    def test_live_build_reports_000001(self):
        df = TdxSource().build_reports("000001")
        if df is None:
            pytest.skip("TDX unreachable in this environment (company_finance unavailable)")
        assert len(df) >= 1
        # report_date 为 '%Y%m%d' 字符串，且按报告期升序（add_performance_report 协议）
        assert (df["report_date"].str.match(r"^\d{8}$")).all()
        assert df["report_date"].is_monotonic_increasing
        assert (df["eps"].notna()).any() and (df["total_income"].notna()).any()
        latest = df.iloc[-1]
        assert np.isnan(latest["eps"]) or latest["eps"] > 0
        assert np.isnan(latest["total_income"]) or latest["total_income"] > 0

    def test_live_build_reports_includes_quarters(self):
        """08-02-fix-f10-quarterly-data：raw 路径含季度（2025 Q1-Q3 在表 2，
        vendor 解析器曾丢弃；本层非 vendor 解析器并入）。raw 缓存缺失 →
        回退 vendor 路径（无季度，跳过本断言）。"""
        df = TdxSource().build_reports("000001")
        if df is None:
            pytest.skip("TDX unreachable in this environment (company_finance unavailable)")
        import os
        raw_path = ("/home/tan/StockOperatorAgent/data/tdx_cache/company_info_raw/"
                    "ts_code=000001.SZ/data.parquet")
        if not os.path.exists(raw_path):
            pytest.skip("no cached raw text for 000001 (fallback path, quarterly not guaranteed)")
        dates = set(df["report_date"])
        assert {"20250331", "20250630", "20250930"} <= dates
