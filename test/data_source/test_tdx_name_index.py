"""TdxSource 名称索引测试（离线合成，不访问网络）：部分市场失败不固化，下次重试。

对齐 08-02-fix-tdx-correctness 修复 8：`_NAME_INDEX_LOADED` 仅在两市场都成功
时才置 True；任一市场失败保持未加载 → 下次 get_stock_name 重试（不固化部分
索引，否则失败市场名称进程内永久回退 ticker）。

实现用普通子类覆写 fetch_security_list（可控失败开关），符合 house style
（无 fixtures/mocking 框架；参照 test_display.py 的 os.environ 保存/恢复手法）。
"""

import pandas as pd

from data_source.chinese_mainland.tdx import tdx_source as tdx_mod
from data_source.chinese_mainland.tdx.tdx_source import TdxSource


class _FlakySecurityListSource(TdxSource):
    """fetch_security_list 可控失败源：fail_markets 中 → 抛 ConnectionError。

    成功返回合成 SZ/SH 列表（code/name 两列，真实 vendor 输出同构）。
    """

    def __init__(self, fail_markets=()):
        super().__init__()
        self.fail_markets = set(fail_markets)
        self.market_calls = []

    def fetch_security_list(self, market):
        self.market_calls.append(market)
        if market in self.fail_markets:
            raise ConnectionError(f"simulated security list failure for market {market}")
        return pd.DataFrame({"code": ["000001", "600000"], "name": ["平安银行", "浦发银行"]})


class TestNameIndexRetry:

    def _reset(self):
        tdx_mod._NAME_INDEX.clear()
        tdx_mod._NAME_INDEX_LOADED = False

    def test_partial_failure_not_solidified_and_retried(self):
        self._reset()
        src = _FlakySecurityListSource(fail_markets={1})
        # SZ 成功、SH 失败 → SZ 名称可解析，但不置 LOADED
        assert src.get_stock_name("000001") == "平安银行"
        assert tdx_mod._NAME_INDEX_LOADED is False
        # 失败市场（SH）名称回退 ticker
        assert src.get_stock_name("600000") == "600000"
        # 下次调用重试：SH 恢复 → 两市场全部加载成功，SH 名称可解析
        src2 = _FlakySecurityListSource()
        assert src2.get_stock_name("600000") == "浦发银行"
        assert tdx_mod._NAME_INDEX_LOADED is True
        assert src2.market_calls == [0, 1]  # 重试确实重新拉取了两市场

    def test_both_markets_fail_never_solidified(self):
        self._reset()
        src = _FlakySecurityListSource(fail_markets={0, 1})
        assert src.get_stock_name("000001") == "000001"
        assert tdx_mod._NAME_INDEX_LOADED is False

    def test_bj_ticker_prefix_detection(self):
        # 北交所（4/8 前缀，prd 定义范围）与沪深（0/3/6 前缀）区分
        for code in ["430047", "830799", "870001"]:
            assert tdx_mod.is_bj_ticker(code) is True, code
        for code in ["000001", "300750", "600000", "688001"]:
            assert tdx_mod.is_bj_ticker(code) is False, code
