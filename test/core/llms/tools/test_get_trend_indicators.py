"""get_trend_indicators 测试：占位降级 + 指标输出结构。

真实堆栈风格（testing spec）：指标数据来自 ZODB（TDX 路径种子，见
test_data_acquisition_tdx），需要 TDX 服务器可达。
"""

from core.data_acquisition import DataAcquisition
from core.llms.tools.get_trend_indicators import get_trend_indicators


class TestGetTrendIndicators:

    def test_missing_stock_returns_placeholder(self):
        text = get_trend_indicators("999999")
        assert "跳过技术指标" in text

    def test_returns_indicators_with_real_data(self):
        da = DataAcquisition()
        stock = da.storage.get_stock("000001")
        if stock is None or len(stock.get_datas()) == 0:
            # 种子数据缺失（如 TDX 不可达的干净环境）→ 尝试播种
            assert da.acquire_historical_data_tdx("000001") is True
        text = get_trend_indicators("000001")
        for marker in ["MA5", "MACD", "RSI6", "KDJ", "BOLL", "ATR"]:
            assert marker in text
        # 换手率无流通股本 → N/A；其余指标不应出现 N/A
        assert text.count("N/A") == 1
        assert "换手率: N/A" in text
