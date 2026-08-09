"""08-09-named-row-constructors 离线测试：from_row 命名行构造。

防护目标（PRD R4）：列序/列名漂移从"位置错位静默写垃圾" → **响亮失败
（KeyError）**。语义细则（design.md）：
- 恒等路径（column_map=None）：字段名即列名；
- 映射路径：字段名 → 行内列名；缺列 → KeyError；多余列忽略（akshare
  "序号"列不再需要 [1:] 切片）；overrides 映射后覆写；
- 与位置构造输出**逐字段等价**（含 NaN 语义）——既有 data_source/
  data_structure 测试全绿即等价证明，本文件补显式断言；
- **列序打乱不抛错**（按列名取值天然免疫，这正是命名构造的防护点——
  位置构造在打乱列序下静默错位）；缺列/列名漂移才抛 KeyError。
"""

from dataclasses import fields

import pandas as pd
import pytest

from core.legacy_akshare import YJBB_COLUMN_MAP
from data_source.chinese_mainland.tdx.mapping import (
    AKSHARE_HIST_COLUMN_MAP,
    AKSHARE_HIST_COLUMNS,
)
from data_source.chinese_mainland.tdx.overview import OVERVIEW_COLUMN_MAP, OVERVIEW_COLUMNS
from data_source.chinese_mainland.tdx.reports import REPORT_COLUMNS
from data_structure.chinese_mainland.ChinaStockData import ChinaStockData
from data_structure.chinese_mainland.StockOverview import StockOverview
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport


def _assert_same_fields(a, b):
    """逐字段等价断言（dataclass __eq__ 对 NaN 恒假，需 NaN == NaN 视为相等）。"""
    assert type(a) is type(b)
    for f in fields(a):
        va, vb = getattr(a, f.name), getattr(b, f.name)
        if pd.isna(va) and pd.isna(vb):
            continue
        assert va == vb, f"field {f.name}: {va!r} != {vb!r}"


class TestChinaStockDataFromRow:

    def test_identity_equals_positional(self):
        """恒等路径（column_map=None）：字段名即列名，与位置构造逐字段等价。"""
        row = {
            "date": pd.Timestamp("2026-07-29").date(), "ticker": "000001",
            "open": 11.3, "close": 11.4, "high": 11.6, "low": 11.1,
            "volume": 1200000, "turnover": 1.37e9, "amplitude": 4.3,
            "percentage_gain": 2.6, "price_change": 0.3, "turnover_rate": 1.2,
        }
        positional = ChinaStockData(*list(row.values()))
        _assert_same_fields(ChinaStockData.from_row(row), positional)

    def test_mapped_equals_positional(self):
        """映射路径：中文列名（AKSHARE_HIST_COLUMNS 序）→ 与位置构造等价。"""
        values = {
            "日期": pd.Timestamp("2026-07-29").date(), "股票代码": "000001",
            "开盘": 11.3, "收盘": 11.4, "最高": 11.6, "最低": 11.1,
            "成交量": 1200000, "成交额": 1.37e9, "振幅": 4.3,
            "涨跌幅": 2.6, "涨跌额": 0.3, "换手率": 1.2,
        }
        positional = ChinaStockData(*list(values.values()))
        _assert_same_fields(
            ChinaStockData.from_row(values, column_map=AKSHARE_HIST_COLUMN_MAP), positional
        )

    def test_column_map_is_bijection_with_fields(self):
        """AKSHARE map 与 AKSHARE_HIST_COLUMNS 同源（zip 显式化）：键 = 全部
        字段，值 = 全部列名——字段增删/列序漂移立即在测试层暴露。"""
        assert set(AKSHARE_HIST_COLUMN_MAP) == {f.name for f in fields(ChinaStockData)}
        assert set(AKSHARE_HIST_COLUMN_MAP.values()) == set(AKSHARE_HIST_COLUMNS)
        assert len(AKSHARE_HIST_COLUMN_MAP) == len(AKSHARE_HIST_COLUMNS) == len(fields(ChinaStockData))

    def test_series_row_works(self):
        """row 为 pd.Series 同样支持（缺列 KeyError 语义一致）。"""
        row = pd.Series({
            "日期": pd.Timestamp("2026-07-29").date(), "股票代码": "000001",
            "开盘": 11.3, "收盘": 11.4, "最高": 11.6, "最低": 11.1,
            "成交量": 1200000, "成交额": 1.37e9, "振幅": 4.3,
            "涨跌幅": 2.6, "涨跌额": 0.3, "换手率": 1.2,
        })
        out = ChinaStockData.from_row(row, column_map=AKSHARE_HIST_COLUMN_MAP)
        assert out.ticker == "000001"
        assert out.close == 11.4

    def test_missing_column_raises_keyerror(self):
        """缺列 → KeyError（响亮失败，替代位置构造的静默错位）。"""
        row = {
            "日期": pd.Timestamp("2026-07-29").date(), "股票代码": "000001",
            "开盘": 11.3, "收盘": 11.4, "最高": 11.6, "最低": 11.1,
            "成交量": 1200000, "成交额": 1.37e9, "振幅": 4.3,
            "涨跌幅": 2.6, "涨跌额": 0.3, "换手率": 1.2,
        }
        del row["收盘"]
        with pytest.raises(KeyError):
            ChinaStockData.from_row(row, column_map=AKSHARE_HIST_COLUMN_MAP)
        # 恒等路径缺列同样 KeyError
        with pytest.raises(KeyError):
            ChinaStockData.from_row({"ticker": "000001", "open": 1.0})

    def test_renamed_column_raises_keyerror(self):
        """列名漂移（'开盘' → '开盘价'）→ KeyError——列序漂移从静默损坏响亮化。"""
        row = {
            "日期": pd.Timestamp("2026-07-29").date(), "股票代码": "000001",
            "开盘价": 11.3, "收盘": 11.4, "最高": 11.6, "最低": 11.1,
            "成交量": 1200000, "成交额": 1.37e9, "振幅": 4.3,
            "涨跌幅": 2.6, "涨跌额": 0.3, "换手率": 1.2,
        }
        with pytest.raises(KeyError):
            ChinaStockData.from_row(row, column_map=AKSHARE_HIST_COLUMN_MAP)

    def test_reordered_columns_still_correct(self):
        """列序打乱 → 按列名取值**仍然正确**（位置构造此时已静默错位）。"""
        row = {
            "日期": pd.Timestamp("2026-07-29").date(), "股票代码": "000001",
            "开盘": 11.3, "收盘": 11.4, "最高": 11.6, "最低": 11.1,
            "成交量": 1200000, "成交额": 1.37e9, "振幅": 4.3,
            "涨跌幅": 2.6, "涨跌额": 0.3, "换手率": 1.2,
        }
        shuffled = {k: row[k] for k in reversed(list(row))}
        assert ChinaStockData.from_row(shuffled, column_map=AKSHARE_HIST_COLUMN_MAP).close == 11.4

    def test_extra_columns_ignored(self):
        """多余列忽略（akshare 序号列场景：不再需要 [1:] 切片）。"""
        row = {
            "序号": 1,
            "日期": pd.Timestamp("2026-07-29").date(), "股票代码": "000001",
            "开盘": 11.3, "收盘": 11.4, "最高": 11.6, "最低": 11.1,
            "成交量": 1200000, "成交额": 1.37e9, "振幅": 4.3,
            "涨跌幅": 2.6, "涨跌额": 0.3, "换手率": 1.2,
        }
        out = ChinaStockData.from_row(row, column_map=AKSHARE_HIST_COLUMN_MAP)
        assert out.ticker == "000001"
        assert out.close == 11.4

    def test_nan_passes_through(self):
        """row 缺失值（NaN）原样进字段（float64 注解不强制，与位置构造一致）。"""
        row = {f: 0.0 for f in AKSHARE_HIST_COLUMNS}
        row["日期"] = pd.Timestamp("2026-07-29").date()
        row["股票代码"] = "000001"
        row["成交量"] = 1000
        row["换手率"] = float("nan")
        out = ChinaStockData.from_row(row, column_map=AKSHARE_HIST_COLUMN_MAP)
        assert pd.isna(out.turnover_rate)
        assert out.volume == 1000


class TestStockOverviewFromRow:

    @staticmethod
    def _values(extra: dict | None = None):
        """22 列中文列名行（OVERVIEW_COLUMNS 序）。"""
        row = {
            "代码": "000001", "名称": "平安银行", "最新价": 11.63,
            "涨跌幅": 0.17, "涨跌额": 0.02, "成交量": 2024978,
            "成交额": 2.32e9, "振幅": 1.72, "最高": 11.66, "最低": 11.46,
            "今开": 11.52, "昨收": 11.61, "量比": float("nan"),
            "换手率": 0.24, "市盈率-动态": 5.1, "市净率": 0.62,
            "总市值": 2.25e11, "流通市值": 2.24e11, "涨速": float("nan"),
            "5分钟涨跌": float("nan"), "60日涨跌幅": 8.3, "年初至今涨跌幅": 12.4,
        }
        if extra:
            row.update(extra)
        return row

    def test_mapped_equals_positional(self):
        row = self._values()
        positional = StockOverview(*list(row.values()))
        _assert_same_fields(StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP), positional)

    def test_index_column_ignored(self):
        """akshare 行首"序号"列 → map 天然忽略（原 [1:] 切片消除）。"""
        row = {"序号": 42, **self._values()}
        out = StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)
        assert out.ticker == "000001"
        assert out.name == "平安银行"

    def test_missing_column_raises_keyerror(self):
        row = self._values()
        del row["代码"]
        with pytest.raises(KeyError):
            StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)

    def test_reordered_columns_still_correct(self):
        row = {k: v for k, v in reversed(list(self._values().items()))}
        out = StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)
        assert out.ticker == "000001"
        assert out.change_percent == 0.17

    def test_nan_passthrough(self):
        row = self._values()
        out = StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)
        assert pd.isna(out.volume_ratio)  # 量比 NaN 原样进字段
        assert out.previous_close == 11.61

    def test_column_map_is_bijection_with_fields(self):
        """map 与 OVERVIEW_COLUMNS 同源（zip 显式化）：键 = 全部字段，值 = 全部列名。"""
        assert set(OVERVIEW_COLUMN_MAP) == {f.name for f in fields(StockOverview)}
        assert set(OVERVIEW_COLUMN_MAP.values()) == set(OVERVIEW_COLUMNS)
        assert len(OVERVIEW_COLUMN_MAP) == len(OVERVIEW_COLUMNS) == len(fields(StockOverview))


class TestStockPerformanceReportFromRow:

    @staticmethod
    def _values(extra: dict | None = None):
        row = {
            "ticker": "601988", "name": "中国银行", "eps": 0.21,
            "total_income": 15600000000.0, "total_income_YoY_rate": 3.5,
            "total_income_QoQ_rate": -1.2, "net_profit": 5600000000.0,
            "net_profit_YoY_rate": 4.1, "net_profit_QoQ_rate": -0.8,
            "net_worth_per_share": 7.62, "net_worth_return_rate": 2.75,
            "cash_flow_per_share": 1.23, "sales_gross_margin": float("nan"),
            "industry": "银行", "report_date": "20251231",
        }
        if extra:
            row.update(extra)
        return row

    def test_identity_equals_positional(self):
        """恒等路径：REPORT_COLUMNS 即字段名（TDX 业绩路径）。"""
        row = self._values()
        positional = StockPerformanceReport(*list(row.values()))
        _assert_same_fields(StockPerformanceReport.from_row(row), positional)

    def test_missing_column_raises_keyerror(self):
        row = self._values()
        del row["eps"]
        with pytest.raises(KeyError):
            StockPerformanceReport.from_row(row)

    def test_override_report_date(self):
        """overrides 生效：YJBB 映射不含 report_date → 调用方覆写（akshare 业绩路径）。"""
        row = {v: self._values()[k] for k, v in YJBB_COLUMN_MAP.items()}
        out = StockPerformanceReport.from_row(row, column_map=YJBB_COLUMN_MAP, report_date="20260331")
        assert out.report_date == "20260331"
        assert out.ticker == "601988"
        assert out.eps == 0.21

    def test_override_wins_over_row_value(self):
        row = self._values()
        out = StockPerformanceReport.from_row(row, report_date="20260630")
        assert out.report_date == "20260630"

    def test_yjbb_map_equals_explicit_construction(self):
        """YJBB_COLUMN_MAP + report_date overrides == 原显式关键字构造（等价证明）。"""
        row = {v: self._values()[k] for k, v in YJBB_COLUMN_MAP.items()}
        row["序号"] = 1  # 多余列（序号）忽略
        out = StockPerformanceReport.from_row(row, column_map=YJBB_COLUMN_MAP, report_date="20251231")
        assert out.ticker == "601988"
        assert out.name == "中国银行"
        assert out.eps == 0.21
        assert out.industry == "银行"
        assert out.report_date == "20251231"

    def test_column_maps_cover_all_fields_except_report_date(self):
        """YJBB map 键集 = 全部字段 − report_date（overrides 补位）。"""
        assert set(YJBB_COLUMN_MAP) == {f.name for f in fields(StockPerformanceReport)} - {"report_date"}
        assert REPORT_COLUMNS == [f.name for f in fields(StockPerformanceReport)]
