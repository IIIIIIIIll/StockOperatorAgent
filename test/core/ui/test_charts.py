"""08-06-ui-data-charts:图表纯函数测试(altair spec 断言,无渲染)。

charts.py 无 Streamlit import(见 test_module_has_no_streamlit_import)
——构造 altair spec 不渲染,to_dict() 断言 mark 类型、encoding 字段、
涨跌语义色(红涨绿跌)、tooltip;iter_data_charts 断言标题顺序与空输入。
合成输入镜像真实格式(与 test_data_markdown 的 _daily_line/_report_line
同形态,自包含不跨测试模块 import)。
"""

import inspect

from core.ui import charts
from core.ui import data_markdown as dm

_OVERVIEW = [
    "-----------",
    "Stock: 平安银行 (000001)",
    "Latest price: 11.11",
    "Dynamic PE: 5.20",
    "Pb: 0.55",
    "Momentum: 3.25%",
]


def _daily_line(date, direction=1):
    # 涨(direction=1): Close ≥ Open;跌(direction=-1): Close < Open
    if direction >= 0:
        open_, close = "11.00", "11.11"
    else:
        open_, close = "11.00", "10.90"
    return (f"  Date: {date}, Open:{open_}, Close: {close}, High: 11.20, "
            f"Low: 10.98, Change Percent: 1.23%, Volume: 123456.00lots, "
            f"Turnover Rate: 1.20%")


def _report_line(date):
    return (f"  Report Date: {date}, EPS: 0.50, Net Profit: 1000.00, "
            f"Net Profit YoY percent 1.23, Net Profit QoQ percent -0.50, "
            f"Net worth per share 2.10, Return on Equity percent 3.33, "
            f"Cash flow per share 0.42, Sales gross margin percent 15.00")


def _sample(n_daily=5, n_fin=3):
    lines = _OVERVIEW + ["Last 60 days prices:"] + [
        _daily_line(f"2026-07-{30 - i % 30:02d}", direction=i % 2) for i in range(n_daily)
    ] + ["Last 20 financial abstracts:"] + [
        _report_line(f"202603{31 - i % 28:02d}") for i in range(n_fin)
    ]
    return "\n".join(lines) + "\n-----------\n"


def _daily_rows():
    return dm.parse_daily_rows(_sample())


def _fin_rows():
    return dm.parse_financial_rows(_sample())


class TestChartBuilders():

    def test_module_has_no_streamlit_import(self):
        src = inspect.getsource(charts)
        assert "import streamlit" not in src

    def test_candlestick_rule_and_bar_marks(self):
        spec = charts.candlestick_chart(_daily_rows()).to_dict()
        marks = {layer["mark"]["type"] for layer in spec["layer"]}
        assert marks == {"rule", "bar"}

    def test_candlestick_red_up_green_down(self):
        """A 股约定:涨(Close≥Open)红、跌绿——两图层共享同一语义色板。"""
        spec = charts.candlestick_chart(_daily_rows()).to_dict()
        layers = [l for l in spec["layer"] if l["mark"]["type"] == "bar"]
        scale = layers[0]["encoding"]["color"]["scale"]
        assert scale["domain"] == ["涨", "跌"]
        assert scale["range"] == [charts.UP_COLOR, charts.DOWN_COLOR]
        # 影线层同色板(涨跌色不只用于实体)
        rule = [l for l in spec["layer"] if l["mark"]["type"] == "rule"][0]
        assert rule["encoding"]["color"]["scale"] == scale

    def test_candlestick_encodes_ohlc(self):
        spec = charts.candlestick_chart(_daily_rows()).to_dict()
        layers = {l["mark"]["type"]: l["encoding"] for l in spec["layer"]}
        assert layers["rule"]["y"]["field"] == "Low"
        assert layers["rule"]["y2"]["field"] == "High"
        assert layers["bar"]["y"]["field"] == "Open"
        assert layers["bar"]["y2"]["field"] == "Close"

    def test_candlestick_price_axis_not_zero_based(self):
        """2026-08-06 修复:y 轴 zero=False + 共享——价格域铺满绘图区,
        消除零基比例的顶部大留白(10~11 的价格画在 0~12.5 轴上)。"""
        spec = charts.candlestick_chart(_daily_rows()).to_dict()
        assert spec["resolve"]["scale"]["y"] == "shared"
        for layer in spec["layer"]:
            assert layer["encoding"]["y"].get("scale", {}).get("zero") is False

    def test_volume_bar_chart(self):
        spec = charts.volume_chart(_daily_rows()).to_dict()
        assert spec["mark"]["type"] == "bar"
        assert spec["encoding"]["y"]["field"] == "Volume"

    def test_close_line_single_series_no_legend(self):
        """单系列:标题即图例,不画图例框(dataviz)。"""
        spec = charts.close_line_chart(_daily_rows()).to_dict()
        assert spec["mark"]["type"] == "line"
        assert spec["encoding"]["y"]["field"] == "Close"
        assert spec["encoding"]["color"] == {"value": charts.UP_COLOR}

    def test_change_percent_bar_chart(self):
        spec = charts.change_percent_chart(_daily_rows()).to_dict()
        assert spec["mark"]["type"] == "bar"
        assert spec["encoding"]["y"]["field"] == "Change Percent"

    def test_financial_charts_three_single_series(self):
        items = charts.financial_charts(_fin_rows())
        assert [t for t, _ in items] == ["净利润", "销售毛利率", "每股收益"]
        for title, chart in items:
            spec = chart.to_dict()
            assert spec["mark"]["type"] == "line"
            assert spec["encoding"]["y"]["title"] == title

    def test_empty_rows_yield_nothing(self):
        assert charts.candlestick_chart([]) is None
        assert charts.volume_chart([]) is None
        assert charts.close_line_chart([]) is None
        assert charts.change_percent_chart([]) is None
        assert charts.financial_charts([]) == []

    def test_all_na_close_skips_close_chart(self):
        rows = _daily_rows()
        for r in rows:
            r["Close"] = None
        assert charts.close_line_chart(rows) is None


class TestIterDataCharts():
    """08-09 结构化边界：iter_data_charts 入口从文本改为 ParsedStockInfo
    ——用例先 parse_stock_info 再传入（断言性修改；图表结构断言不变——
    同一解析器，行结构同构）。"""

    def test_yields_charts_in_order(self):
        items = list(charts.iter_data_charts(dm.parse_stock_info(_sample())))
        assert [t for t, _ in items] == [
            "K线", "成交量", "收盘价", "涨跌幅",
            "净利润", "销售毛利率", "每股收益",
        ]

    def test_empty_input_yields_nothing(self):
        assert list(charts.iter_data_charts(dm.parse_stock_info(""))) == []
        assert list(charts.iter_data_charts(
            dm.parse_stock_info("（无行情数据，跳过技术指标）"))) == []

    def test_no_financial_section_skips_financial_charts(self):
        text = "\n".join(_OVERVIEW + ["Last 60 days prices:"] +
                         [_daily_line("2026-07-30")])
        assert [t for t, _ in charts.iter_data_charts(
            dm.parse_stock_info(text))] == [
            "K线", "成交量", "收盘价", "涨跌幅",
        ]

    def test_no_text_parsing_in_charts(self):
        """图表不再接触文本：解析只在 data_markdown（parse_stock_info）
        发生一次；charts 只消费结构化行（源码断言，08-09 边界）。"""
        src = inspect.getsource(charts)
        assert "parse_daily_rows" not in src
        assert "parse_financial_rows" not in src
        assert "iter_sections" not in src
