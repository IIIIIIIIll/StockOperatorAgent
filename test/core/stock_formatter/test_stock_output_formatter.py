"""StockOutputFormatter 测试：live 冒烟 + 离线 golden NaN 渲染（修复 1）。

live：真实 ZODB（test_format，沿用原风格）；
离线：全合成数据构造 ChinaStock，验证 TDX 路径恒有的 NaN 字段（量比/涨速/
5分钟、盘中换手率、历史首行振幅/涨跌幅、F10 缺失指标）渲染为 N/A——prompt
不再出现 nan%/nanlots 字面。数值统一保留两位小数（utils.formatting.fmt_number
单点实现，与 get_trend_indicators 共用）。
"""

import re
from datetime import date

from numpy import float64, int64

from core.stock_output_formatter import StockOutputFormatter
from core.data_acquisition import DataAcquisition
from data_structure.chinese_mainland.ChinaStock import ChinaStock
from data_structure.chinese_mainland.ChinaStockData import ChinaStockData
from data_structure.chinese_mainland.StockOverview import StockOverview
from data_structure.chinese_mainland.StockPerformanceReport import StockPerformanceReport
from loguru import logger


class TestStockOutputFormatter():

    def test_format(self):
        da = DataAcquisition()
        stock = da.storage.get_stock('002714')
        assert stock is not None
        assert len(stock.get_performance_reports()) > 0
        logger.info(StockOutputFormatter.format_stock_output(stock))


def _synthetic_stock():
    """合成 ChinaStock：概览含 NaN 字段（量比/涨速/5分钟）、历史首行指标
    NaN、业绩报告 sales_gross_margin NaN——覆盖 prompt 的全部 nan 污染源。"""
    overview = StockOverview(
        "000001", "平安银行",
        float64(11.63),   # latest_price
        float64(0.17),    # change_percent
        float64(0.02),    # change_amount
        float64(2024978), # volume
        float64(2.31884e9),  # turnover(成交额)
        float64(3.01),    # amplitude
        float64(11.63),   # high
        float64(11.28),   # low
        float64(11.50),   # open
        float64(11.61),   # previous_close
        float64("nan"),   # volume_ratio（pytdx 无）
        float64(1.04),    # turnover_rate
        float64(16.15),   # pe_dynamic
        float64(1.01),    # pb
        float64(2.256e10),  # market_cap
        float64(2.256e10),  # circulating_market_cap
        float64("nan"),   # momentum（pytdx 无）
        float64("nan"),   # change_percent_5min（pytdx 无）
        float64(30.97),   # change_percent_60days
        float64(22.42),   # change_percent_ytd
    )
    stock = ChinaStock("平安银行", "000001", overview)
    # 首根 bar：振幅/涨跌幅/涨跌额/换手率 NaN（mapping 首行无前收盘 + 无流通股本）
    stock.datas.append(ChinaStockData(
        date(2026, 7, 31), "000001",
        float64(11.50), float64(11.63), float64(11.63), float64(11.28),
        int64(2024978), float64(2.31884e9),
        float64("nan"), float64("nan"), float64("nan"), float64("nan"),
    ))
    # 业绩报告：sales_gross_margin NaN（TDX 路径恒 NaN），industry 空串
    stock.performance_reports.append(StockPerformanceReport(
        "000001", "平安银行",
        float64(0.72), float64(1.6e12), float64(9.8), float64(6.67),
        float64(4.5e11), float64(12.0), float64(4.65),
        float64(11.5), float64(13.1), float64(3.8),
        float64("nan"), "", "20260331",
    ))
    return stock


class TestFormatterNanRendering:
    """离线 golden：TDX 路径 NaN 字段 → N/A，输出无字面 'nan'。"""

    def test_no_literal_nan_in_output(self):
        text = StockOutputFormatter.format_stock_output(_synthetic_stock())
        # 词边界断言：'financial' 等英文单词天然含 'nan' 子串，不算；
        # 独立 'nan' 字面（nan%/nanlots/percent nan 等 NaN 渲染形态）禁止出现
        assert re.search(r"\bnan\b", text.lower()) is None

    def test_golden_na_rendering(self):
        text = StockOutputFormatter.format_stock_output(_synthetic_stock())
        # 概览行：数值两位小数；pytdx 无的 NaN 字段 → N/A
        assert "Latest price: 11.63" in text
        assert "Dynamic PE: 16.15" in text
        assert "Momentum: N/A%" in text
        # 历史行：首根 bar 振幅/涨跌幅/换手率 NaN → N/A；成交量两位小数
        assert "Change Percent: N/A%" in text
        assert "Volume: 2024978.00lots" in text
        assert "Turnover Rate: N/A%" in text
        # 业绩报告行：F10 缺失指标 NaN → N/A；report_date 原样
        assert "Sales gross margin percent N/A" in text
        assert "Report Date: 20260331" in text
