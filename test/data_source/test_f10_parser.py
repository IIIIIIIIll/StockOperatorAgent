"""离线测试：非 vendor F10 解析器（表 1 + 表 2 合并，含季度）。

08-02-fix-f10-quarterly-data：vendor 解析器遇第二个日期头行 break，含季度
的表 2 被丢弃；f10_parser.parse_finance_indicators_all_tables 把全部日期头
子表并入。离线喂合成文本（镜像真实 F10 页面：U+FF5C 分隔、日期头行、亿/万
单位、'-' 占位），断言 9 期齐全、去重、单位归一、NaN 语义、无节 → 空。
"""

import numpy as np
import pandas as pd
import pytest

from data_source.chinese_mainland.tdx.f10_parser import (
    F10_COLUMNS,
    parse_finance_indicators_all_tables,
)

PIPE = '｜'


def _table(header_periods, rows):
    """合成一张 F10 子表：header_periods = 日期列，rows = [(metric, values...)]。"""
    head = PIPE + PIPE.join(["财务指标"] + list(header_periods)) + PIPE
    lines = [head]
    for metric, values in rows:
        lines.append(PIPE + PIPE.join([metric] + list(values)) + PIPE)
    return "\n".join(lines)


# 表 1：最新期 + 历年年报（vendor 只解析到这张）
_TABLE1 = _table(
    ["2026-03-31", "2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31"],
    [
        ("净利润(元)", ["145.23亿", "426.33亿", "445.08亿", "464.55亿", "455.16亿", "363.36亿"]),
        ("营业总收入(元)", ["352.77亿", "1314.42亿", "1466.95亿", "1646.99亿", "1798.95亿", "1693.83亿"]),
        ("基本每股收益(元)", ["0.67", "2.07", "2.15", "2.25", "2.2", "1.73"]),
        ("资产负债比率(%)", ["90.983", "90.6985", "91.4228", "91.5461", "91.8316", "91.9647"]),
    ],
)

# 表 2：含季度（2025 Q1-Q3）——vendor break 丢弃、本解析器必须并入
_TABLE2 = _table(
    ["2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31", "2024-12-31"],
    [
        ("净利润(元)", ["145.23亿", "426.33亿", "383.39亿", "248.7亿", "140.96亿", "445.08亿"]),
        ("营业总收入(元)", ["352.77亿", "1314.42亿", "1006.68亿", "693.85亿", "337.09亿", "1466.95亿"]),
        ("基本每股收益(元)", ["0.67", "2.07", "1.87", "1.18", "0.62", "2.15"]),
        ("资产负债比率(%)", ["90.983", "90.6985", "91.0187", "91.318", "91.2405", "91.4228"]),
    ],
)

_TWO_TABLES = "【主要财务指标】\n" + _TABLE1 + "\n" + _TABLE2 + "\n备注：以上指标P为扭亏为盈。\n\n【盈利能力指标】\n后续分节不应被解析"


class TestParseAllTables:

    def test_merges_both_sub_tables_nine_periods(self):
        """表 1 + 表 2 合并：9 期齐全（6 年报 + 2025 Q1-Q3 + 2026Q1）。"""
        df = parse_finance_indicators_all_tables(_TWO_TABLES)
        periods = sorted(df["period"].unique())
        assert periods == [
            "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31",
            "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31",
        ]

    def test_quarterly_periods_have_values(self):
        """表 2 独占的季度期（2025 Q1-Q3）有净利润值（vendor 路径为缺失）。"""
        df = parse_finance_indicators_all_tables(_TWO_TABLES)
        net = df[df["metric"] == "净利润(元)"].set_index("period")["value_num"]
        assert net["2025-03-31"] == pytest.approx(140.96e8)
        assert net["2025-06-30"] == pytest.approx(248.7e8)
        assert net["2025-09-30"] == pytest.approx(383.39e8)

    def test_duplicate_metric_period_deduped(self):
        """同 (metric, period) 出现在两张表（如 2026-03-31）→ 只保留一行。"""
        df = parse_finance_indicators_all_tables(_TWO_TABLES)
        dup = df[df["period"] == "2026-03-31"].groupby("metric").size()
        assert (dup == 1).all()

    def test_unit_normalization(self):
        """'亿'/'万' 后缀归一（×1e8/×1e4）。日期头恒 ≥2 列（真实页面形态）。"""
        text = "【主要财务指标】\n" + _table(
            ["2025-12-31", "2024-12-31"],
            [("净利润(元)", ["1.23亿", "1.1亿"]), ("营业总收入(元)", ["5万", "4万"])],
        )
        df = parse_finance_indicators_all_tables(text)
        latest = df[df["period"] == "2025-12-31"].set_index("metric")["value_num"]
        assert latest["净利润(元)"] == pytest.approx(1.23e8)
        assert latest["营业总收入(元)"] == pytest.approx(5e4)

    def test_placeholder_text_is_nan(self):
        """'-'/'--'/'—'/空 → NaN（降级占位不被误解析）。"""
        text = "【主要财务指标】\n" + _table(
            ["2025-12-31", "2024-12-31"],
            [("净利润(元)", ["-", "-"]), ("营业总收入(元)", ["--", "--"]),
             ("资产负债比率(%)", ["—", "—"]), ("基本每股收益(元)", ["", ""])],
        )
        df = parse_finance_indicators_all_tables(text)
        assert df["value_num"].isna().all()

    def test_metric_names_carrying_percent_sign(self):
        """中文指标名含 (%) 正常保留（与 vendor 输出同构）。"""
        df = parse_finance_indicators_all_tables(_TWO_TABLES)
        assert "资产负债比率(%)" in set(df["metric"])

    def test_missing_section_returns_empty(self):
        """无【主要财务指标】节 → 空 DataFrame（与 vendor 同约定）。"""
        df = parse_finance_indicators_all_tables("【盈利能力指标】\n无财务分析节")
        assert df.empty
        assert list(df.columns) == F10_COLUMNS

    def test_single_table_only(self):
        """页面只有一张子表（无第二日期头）→ 正常解析，不误触发合并逻辑。"""
        text = "【主要财务指标】\n" + _TABLE1
        df = parse_finance_indicators_all_tables(text)
        assert sorted(df["period"].unique()) == [
            "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31", "2026-03-31",
        ]

    def test_next_section_not_parsed(self):
        """块截断：【盈利能力指标】等后续分节不进入输出。"""
        df = parse_finance_indicators_all_tables(_TWO_TABLES)
        # 若截断失败，'率(%)'（后续分节的行首 metric）会出现
        assert "率(%)" not in set(df["metric"])

    def test_real_cached_text_000001(self):
        """真实缓存文本（000001）→ 9 期（live 数据依赖，缓存缺失时跳过）。"""
        import os
        path = "/home/tan/StockOperatorAgent/data/tdx_cache/company_info_raw/ts_code=000001.SZ/data.parquet"
        if not os.path.exists(path):
            import pytest
            pytest.skip("no cached raw text for 000001")
        text = pd.read_parquet(path).iloc[0]["text"]
        df = parse_finance_indicators_all_tables(text)
        periods = sorted(df["period"].unique())
        assert "2025-03-31" in periods and "2025-06-30" in periods and "2025-09-30" in periods
