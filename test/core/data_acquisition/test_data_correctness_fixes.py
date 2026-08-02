"""08-02-fix-data-correctness 离线测试：akshare 备用路径修复项。

全部离线（合成数据、不联网）：
- yjbb_em 列名映射构造（位置构造例外授权）+ 列名存在性断言；
- latest_possible_date 纯函数（1-3 月 → 上一年 1231，不拉未来）；
- acquire_performance_report ticker 参数化（'601988' 硬编码移除）。

TDX 主链路修复（全量回填 / 新鲜度 date==date）在
test_data_acquisition_tdx.py（live smoke，TDX 可达）。本文件不触碰
真实 DB 数据（'999999' 从未入仓，storage 返回 None 即短路）。
"""

from datetime import date

import pandas as pd

from core.data_acquisition import DataAcquisition, YJBB_COLUMN_MAP


def _yjbb_row(**overrides):
    """按 akshare 1.18.81 stock_yjbb_em 列名构造一行（16 列中的 14 列契约）。

    与 YJBB_COLUMN_MAP 键对齐；report_date 由调用方赋值不在行内。
    """
    row = {
        "股票代码": "601988",
        "股票简称": "中国银行",
        "每股收益": 0.21,
        "营业总收入-营业总收入": 15600000000.0,
        "营业总收入-同比增长": 3.5,
        "营业总收入-季度环比增长": -1.2,
        "净利润-净利润": 5600000000.0,
        "净利润-同比增长": 4.1,
        "净利润-季度环比增长": -0.8,
        "每股净资产": 7.62,
        "净资产收益率": 2.75,
        "每股经营现金流量": 1.23,
        "销售毛利率": 0.0,
        "所处行业": "银行",
    }
    row.update(overrides)
    return row


class TestYjbbColumnNameMapping():

    def test_row_maps_by_column_name(self):
        da = DataAcquisition()
        report = da.build_performance_report_from_row(_yjbb_row(), "20251231")
        assert report is not None
        assert report.ticker == "601988"
        assert report.name == "中国银行"
        assert report.eps == 0.21
        assert report.total_income == 15600000000.0
        assert report.total_income_YoY_rate == 3.5
        assert report.total_income_QoQ_rate == -1.2
        assert report.net_profit == 5600000000.0
        assert report.net_profit_YoY_rate == 4.1
        assert report.net_profit_QoQ_rate == -0.8
        assert report.net_worth_per_share == 7.62
        assert report.net_worth_return_rate == 2.75
        assert report.cash_flow_per_share == 1.23
        assert report.sales_gross_margin == 0.0
        assert report.industry == "银行"
        assert report.report_date == "20251231"

    def test_row_with_missing_column_returns_none(self):
        """列序变化（列名替换）→ 断言拦截，返回 None 而非静默错位写垃圾。"""
        da = DataAcquisition()
        # 模拟旧版列序：'每股收益' 被 '_' 占位替代
        shifted = _yjbb_row()
        del shifted["每股收益"]
        shifted["_"] = 0.21
        assert da.build_performance_report_from_row(shifted, "20251231") is None
        # 列名少了 '所处行业'
        missing_industry = _yjbb_row()
        del missing_industry["所处行业"]
        assert da.build_performance_report_from_row(missing_industry, "20251231") is None

    def test_dataframe_column_guard(self):
        """DataFrame 级列名契约：正确列序通过，变化列序被 issubset 拦截。

        与 acquire_performance_report 内联断言同一表达式（列名契约是
        YJBB_COLUMN_MAP 的键集）。
        """
        good_df = pd.DataFrame([_yjbb_row()])
        assert set(YJBB_COLUMN_MAP).issubset(good_df.columns)
        bad_df = pd.DataFrame([{"股票代码": "601988", "股票简称": "中国银行"}])
        assert not set(YJBB_COLUMN_MAP).issubset(bad_df.columns)


class TestLatestPossibleReportDate():

    def test_january_uses_last_year_annual(self):
        da = DataAcquisition()
        # 2026-02 模拟 → 上限为 2025-12-31（原实现拉 2026-1230 未来报告期）
        assert da.get_latest_possible_report_date(date(2026, 2, 15)) == date(2025, 12, 31)
        assert da.get_latest_possible_report_date(date(2026, 1, 1)) == date(2025, 12, 31)
        assert da.get_latest_possible_report_date(date(2026, 3, 31)) == date(2025, 12, 31)

    def test_other_quarters(self):
        da = DataAcquisition()
        assert da.get_latest_possible_report_date(date(2026, 4, 1)) == date(2026, 3, 31)
        assert da.get_latest_possible_report_date(date(2026, 6, 30)) == date(2026, 3, 31)
        assert da.get_latest_possible_report_date(date(2026, 7, 1)) == date(2026, 6, 30)
        assert da.get_latest_possible_report_date(date(2026, 9, 30)) == date(2026, 6, 30)
        assert da.get_latest_possible_report_date(date(2026, 10, 1)) == date(2026, 9, 30)
        assert da.get_latest_possible_report_date(date(2026, 12, 31)) == date(2026, 9, 30)

    def test_last_year_annual_is_within_polling_range(self):
        """2026-02 模拟：轮询链能走到 2025 年报（20251231 ≤ 上限 20251231）。"""
        da = DataAcquisition()
        latest = da.get_latest_possible_report_date(date(2026, 2, 15))
        # 2025-09-30 三季报 → 下一期是 2025 年报，且 ≤ 上限 → 在轮询范围内
        next_date = da.get_next_report_date(date(2025, 9, 30))
        assert next_date == date(2025, 12, 31)
        assert next_date <= latest


class TestAcquirePerformanceReportParameterized():

    def test_ticker_parameterized(self):
        """'601988' 硬编码已参数化：调用方可传 ticker（签名兼容，默认值保留）。"""
        import inspect
        params = inspect.signature(DataAcquisition.acquire_performance_report).parameters
        assert "ticker" in params
        assert params["ticker"].default == "601988"

    def test_missing_stock_returns_false(self):
        """stock 不存在 → False（在 fetch 之前短路，不联网）。"""
        da = DataAcquisition()
        assert da.acquire_performance_report("999999") is False
