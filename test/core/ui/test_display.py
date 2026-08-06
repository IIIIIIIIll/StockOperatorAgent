"""08-02-fix-data-correctness：UI key 检查只认 DEEPSEEK_API_KEY（修复 1）。

投资委员会永远构造 DeepSeekApi()（无 key 构造即抛 OpenAIError），旧检查
"DEEPSEEK 或 DASHSCOPE 任一存在"放行后构造崩溃。测试验证 _has_deepseek_key
只认 DEEPSEEK_API_KEY——操纵 os.environ 保存/恢复，不触碰用户真实配置。
"""

import os

from core.ui import display


class TestDisplayKeyCheck():

    def test_deepseek_key_passes_check(self):
        saved = os.environ.get("DEEPSEEK_API_KEY")
        os.environ["DEEPSEEK_API_KEY"] = "dummy"
        try:
            assert display._has_deepseek_key() is True
        finally:
            if saved is None:
                os.environ.pop("DEEPSEEK_API_KEY", None)
            else:
                os.environ["DEEPSEEK_API_KEY"] = saved

    def test_no_key_fails_check(self):
        saved = os.environ.get("DEEPSEEK_API_KEY")
        os.environ.pop("DEEPSEEK_API_KEY", None)
        try:
            assert display._has_deepseek_key() is False
        finally:
            if saved is not None:
                os.environ["DEEPSEEK_API_KEY"] = saved

    def test_dashscope_alone_fails_check(self):
        """只配 DASHSCOPE 不放行——与 make_investment_committee 永远构造
        DeepSeekApi 的实现对齐（旧检查放行但构造即崩）。"""
        saved_deepseek = os.environ.pop("DEEPSEEK_API_KEY", None)
        saved_dashscope = os.environ.get("DASHSCOPE_API_KEY")
        os.environ["DASHSCOPE_API_KEY"] = "dummy"
        try:
            assert display._has_deepseek_key() is False
        finally:
            if saved_deepseek is not None:
                os.environ["DEEPSEEK_API_KEY"] = saved_deepseek
            if saved_dashscope is None:
                os.environ.pop("DASHSCOPE_API_KEY", None)
            else:
                os.environ["DASHSCOPE_API_KEY"] = saved_dashscope


class TestDisplayEnrichmentWiring():

    def test_display_uses_shared_build_stock_information(self):
        """修复 1 验收：display 与 make_investment_decision 共用同一
        enrichment 组装点（原 display 直接用 get_stock_info，技术指标与
        实时情报段从未执行）。"""
        from core.investment_committee import build_stock_information
        assert display.build_stock_information is build_stock_information


class TestDisplayIncrementalRender():
    """08-02-ui-incremental-report-render：边算边渲染的纯函数映射。

    iter_report_items 是 dispatch 前的纯映射（节点 update → (key, title,
    content) 渲染项），离线喂合成 update 验证：五 key 映射与标题、顺序
    （= st.tabs 创建顺序）、bullish/bearish 的两种形态（stream 原始
    字符串 / 最终 state 的 add_messages 消息列表）、无报告 key 的
    update → 空。Streamlit 副作用不 mock（house style）。
    """

    def test_report_tabs_match_tab_creation_order(self):
        """REPORT_TABS 顺序 = write_ui 里 st.tabs 创建顺序（渲染契约）。"""
        assert [k for k, _ in display.REPORT_TABS] == [
            "fundamental_analysis", "trend_analysis",
            "bullish_opinions", "bearish_opinions", "final_decision",
        ]

    def test_fundamental_update_yields_item(self):
        items = list(display.iter_report_items(
            {"fundamental_analysis": "基本面结论：低估"}))
        assert items == [("fundamental_analysis", "基本面分析", "基本面结论：低估")]

    def test_opinions_plain_string_shape(self):
        """stream update 形态：bullish/bearish 是原始字符串（reducer 未应用）。"""
        items = list(display.iter_report_items({"bullish_opinions": "看多理由：共振"}))
        assert items == [("bullish_opinions", "看涨观点", "看多理由：共振")]

    def test_opinions_message_list_shape(self):
        """最终 state 形态：消息列表 → [-1].content（旧 get_state_history 语义）。"""
        from langchain_core.messages import AIMessage
        items = list(display.iter_report_items(
            {"bearish_opinions": [AIMessage(content="看空理由：高估")]}))
        assert items == [("bearish_opinions", "看跌观点", "看空理由：高估")]

    def test_messages_only_update_yields_nothing(self):
        assert list(display.iter_report_items({"messages": ["q", "r"]})) == []

    def test_full_update_yields_all_five_in_order(self):
        items = list(display.iter_report_items({
            "fundamental_analysis": "F", "trend_analysis": "T",
            "bullish_opinions": "B", "bearish_opinions": "B",
            "final_decision": "M",
        }))
        assert [k for k, _, _ in items] == [k for k, _ in display.REPORT_TABS]


class TestDisplayDataTab():
    """08-02-ui-collected-data-display：采集数据 Tab 的展示契约。

    数据 Tab 是 enrichment 后、stream 前的独立填充点（st.header +
    st.text 原文），不参与报告 dispatch——测试守住常量与"数据 Tab
    插入不破坏五报告相对顺序"契约（Streamlit 副作用不 mock，
    house style）。
    """

    def test_data_tab_title_constant(self):
        assert display.DATA_TAB_TITLE == "采集数据"

    def test_report_tabs_relative_order_unchanged(self):
        """数据 Tab 插入 st.tabs 最前，五报告相对顺序不变（渲染契约）。"""
        assert [k for k, _ in display.REPORT_TABS] == [
            "fundamental_analysis", "trend_analysis",
            "bullish_opinions", "bearish_opinions", "final_decision",
        ]

    def test_data_tab_is_first_in_tabs_list(self):
        """write_ui 的 st.tabs 六元组首项 = DATA_TAB_TITLE（数据在最前）。

        列表首元素在源码里是 DATA_TAB_TITLE 名称引用（非字面量），逐节点
        检查：首项 Name id == 常量名，其余字面量求值后 = REPORT_TABS 标题。
        """
        import ast
        import inspect
        source = inspect.getsource(display.write_ui)
        tree = ast.parse(source)
        tabs_calls = [node for node in ast.walk(tree)
                      if isinstance(node, ast.Call)
                      and isinstance(node.func, ast.Attribute)
                      and node.func.attr == "tabs"]
        assert len(tabs_calls) == 1
        labels = tabs_calls[0].args[0].elts
        assert isinstance(labels[0], ast.Name)
        assert labels[0].id == "DATA_TAB_TITLE"
        assert [ast.literal_eval(label) for label in labels[1:]] == [
            title for _, title in display.REPORT_TABS]


class TestDisplayChartWiring():
    """08-06-ui-data-charts:采集数据 Tab 图表接线(源码字符串断言,
    house style 同 test_theme 的 wiring 测试)。"""

    def test_data_tab_renders_charts_before_tables(self):
        """数据 Tab 图表在 markdown 表格**之前**(2026-08-06 用户反馈
        "把图往前提"——图表是视觉焦点)。纯函数解析文本、空数据空迭代
        不画图,st.altair_chart 交给 streamlit theme 适配亮暗。"""
        import inspect
        source = inspect.getsource(display.write_ui)
        assert "charts.iter_data_charts(stock_info)" in source
        assert "st.altair_chart(chart, use_container_width=True)" in source
        # 图表渲染在表格之前(语句级顺序;旧 08-02 注释也含
        # "to_markdown_tables" 字样,不能用 find 全文定位)
        assert (source.find("for title, chart in charts.iter_data_charts")
                < source.find("st.markdown(data_markdown.to_markdown_tables"))
