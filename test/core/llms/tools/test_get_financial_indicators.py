"""08-02-f10-financial-indicator-sections：盈利能力指标工具测试。

get_financial_indicators 从 F10 raw 缓存解析【盈利能力指标】节 → 最新
报告期中文摘要。离线：真实缓存（600519 通用 6 项 / 000001 银行特有项）
断言输出形态；降级路径（无缓存/无分节）→ 占位文本不 raise。house style
无 mock 框架——用 monkeypatch 替换 TdxSource.fetch_company_finance_raw
模拟缓存缺失。
"""

import os

import pytest

from core.llms.tools.get_financial_indicators import get_financial_indicators

_RAW_CACHE = "/home/tan/StockOperatorAgent/data/tdx_cache/company_info_raw"


def _require_cache(ticker_ts_code: str):
    """真实缓存依赖用例：缓存缺失 → skip（不把环境差异当失败）。"""
    if not os.path.exists(f"{_RAW_CACHE}/ts_code={ticker_ts_code}/data.parquet"):
        pytest.skip(f"no cached raw text for {ticker_ts_code}")


class TestGetFinancialIndicators:

    def test_generic_stock_has_six_indicators(self):
        """600519（非银行股）：6 项通用指标，百分数格式，最新报告期。"""
        _require_cache("600519.SH")
        out = get_financial_indicators("600519")
        assert "【盈利能力指标（2026-03-31）】" in out
        for metric in ["营业毛利率", "营业净利率", "营业利润率",
                       "成本费用利润率", "总资产报酬率", "加权净资产收益率"]:
            assert f"{metric}:" in out
        assert "营业毛利率: 89.76%" in out  # 实测 golden 值

    def test_bank_stock_includes_specific_indicators(self):
        """000001（银行股）：含净息差/净利差等银行特有项 + 通用项。"""
        _require_cache("000001.SZ")
        out = get_financial_indicators("000001")
        assert "净息差:" in out
        assert "净利差:" in out
        assert "营业毛利率:" in out
        # 折行残缺指标（'手续费及佣金净收入占营'/'业收入比'）已按 NaN 滤除
        assert "业收入比" not in out

    def test_missing_raw_cache_returns_placeholder(self, monkeypatch):
        """raw 缓存缺失 → 占位文本不 raise（error-handling 约定）。

        get_financial_indicators 函数内 import TdxSource——patch 方法本身
        即可（monkeypatch 在调用前生效）。
        """
        from data_source.chinese_mainland.tdx.tdx_source import TdxSource
        monkeypatch.setattr(TdxSource, "fetch_company_finance_raw",
                            lambda self, ticker: None)
        out = get_financial_indicators("999999")
        assert "（无 999999 的盈利能力指标，跳过）" == out
