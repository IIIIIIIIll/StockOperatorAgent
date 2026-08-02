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
