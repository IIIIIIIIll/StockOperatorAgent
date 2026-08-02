"""get_market_intel 测试：无 TDX_API_KEY 时优雅降级。

有 key 的实时查询路径为 live（本环境无 key，不跑；行为由 tdx_quant 自带
test_tdx_mcp_client.py 覆盖）。本测试验证降级契约：不 raise、返回占位文本。
"""

import os

from core.llms.tools.get_market_intel import _FALLBACK_TEXT, get_market_intel


class TestGetMarketIntel:

    def test_no_key_returns_placeholder(self):
        # 显式清除环境变量，保证测试与开发者本机 key 无关
        saved = os.environ.pop("TDX_API_KEY", None)
        try:
            text = get_market_intel("000001")
            assert text == _FALLBACK_TEXT
        finally:
            if saved is not None:
                os.environ["TDX_API_KEY"] = saved

    def test_placeholder_does_not_break_enrichment(self):
        # make_investment_decision 的拼接契约：任何降级文本可直接追加
        stock_information = "基本面数据…\n【技术指标…】"
        enriched = stock_information + "\n" + get_market_intel("000001")
        assert "实时市场情报" not in enriched or "未配置 TDX_API_KEY" in enriched
