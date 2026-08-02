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
