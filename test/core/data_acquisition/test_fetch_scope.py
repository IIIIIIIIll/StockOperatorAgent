"""FetchScope 单元测试（review #2+#3）：离线，_FakeSrc 计数，不触网络/ZODB。

FetchScope 是纯内存 DataFrame 复用（core/data_acquisition.py），独立于
DataAcquisition 实例——直接构造测试，无需真实 ZODB/TDX。
"""

import pandas as pd

from core.data_acquisition import FetchScope


class _FakeSrc:
    """计数假数据源：fetch_* 返回可配置 DataFrame，记录调用次数。"""

    def __init__(self, n_rows=5):
        self.n_rows = n_rows
        self.calls = {}  # (method, ticker) -> count

    def _count(self, method, ticker):
        key = (method, ticker)
        self.calls[key] = self.calls.get(key, 0) + 1
        return key

    def fetch_daily(self, ticker, max_bars=None):
        self._count("fetch_daily", ticker)
        return pd.DataFrame({"close": [1.0] * (self.n_rows if max_bars is None else max_bars)})

    def fetch_snapshot(self, ticker):
        self._count("fetch_snapshot", ticker)
        return pd.DataFrame([{"price": 10.0}])

    def fetch_finance_capital(self, ticker):
        self._count("fetch_finance_capital", ticker)
        return pd.DataFrame([{"zongguben": 1e10}])

    def fetch_company_finance(self, ticker):
        self._count("fetch_company_finance", ticker)
        return pd.DataFrame([{"metric": "基本每股收益(元)", "period": "2026-03-31", "value_num": 0.5}])

    def fetch_xdxr(self, ticker):
        self._count("fetch_xdxr", ticker)
        return pd.DataFrame([{"trade_date": "2026-01-01"}])


def _count(scope, fake, method, ticker):
    return fake.calls.get((method, ticker), 0)


class TestFetchScope:

    def test_daily_larger_request_reuses_smaller_cache(self):
        """250 根缓存满足 ≤250 请求：fetch_daily 只拉一次。"""
        fake = _FakeSrc()
        scope = FetchScope(fake)
        scope.fetch_daily("000001", 250)
        assert _count(scope, fake, "fetch_daily", "000001") == 1
        scope.fetch_daily("000001", 3)
        assert _count(scope, fake, "fetch_daily", "000001") == 1

    def test_daily_full_request_refetches_after_partial_cache(self):
        """全量请求（None）不满足于 250 缓存：重拉一次（首建场景）。"""
        fake = _FakeSrc()
        scope = FetchScope(fake)
        scope.fetch_daily("000001", 250)
        scope.fetch_daily("000001", None)
        assert _count(scope, fake, "fetch_daily", "000001") == 2

    def test_daily_same_size_reuses(self):
        """相同尺寸请求（预播种 250 → 消费者 250）复用。"""
        fake = _FakeSrc()
        scope = FetchScope(fake)
        scope.fetch_daily("000001", 250)
        scope.fetch_daily("000001", 250)
        assert _count(scope, fake, "fetch_daily", "000001") == 1

    def test_single_consumer_sources_memoized(self):
        """snapshot/capital/f10/xdxr 同 key 复用（即使单一消费者，契约统一）。"""
        fake = _FakeSrc()
        scope = FetchScope(fake)
        for _ in range(2):
            scope.fetch_snapshot("000001")
            scope.fetch_finance_capital("000001")
            scope.fetch_company_finance("000001")
            scope.fetch_xdxr("000001")
        assert _count(scope, fake, "fetch_snapshot", "000001") == 1
        assert _count(scope, fake, "fetch_finance_capital", "000001") == 1
        assert _count(scope, fake, "fetch_company_finance", "000001") == 1
        assert _count(scope, fake, "fetch_xdxr", "000001") == 1

    def test_distinct_tickers_fetch_separately(self):
        """不同 ticker 不共享缓存。"""
        fake = _FakeSrc()
        scope = FetchScope(fake)
        scope.fetch_daily("000001", 250)
        scope.fetch_daily("000002", 250)
        assert _count(scope, fake, "fetch_daily", "000001") == 1
        assert _count(scope, fake, "fetch_daily", "000002") == 1

    def test_empty_source_marks_failed_and_returns_empty(self):
        """源返回空 → 标记 failed，后续请求直接空 DataFrame（消费者按空降级）。"""
        fake = _FakeSrc()
        fake.fetch_daily = lambda ticker, max_bars=None: (fake._count("fetch_daily", ticker), pd.DataFrame())[1]
        scope = FetchScope(fake)
        first = scope.fetch_daily("000001", 250)
        assert first.empty
        second = scope.fetch_daily("000001", 250)
        assert second.empty
        assert _count(scope, fake, "fetch_daily", "000001") == 1  # 第二次零调用

    def test_raise_marks_failed_and_propagates_then_empty(self):
        """源抛异常 → 标记 failed + 重新抛出（消费者 catch 处理）；后续请求空。"""
        fake = _FakeSrc()
        def _boom(ticker, max_bars=None):
            fake._count("fetch_daily", ticker)
            raise ValueError("boom")
        fake.fetch_daily = _boom
        scope = FetchScope(fake)
        try:
            scope.fetch_daily("000001", 250)
            assert False, "expected ValueError to propagate"
        except ValueError:
            pass
        assert scope.fetch_daily("000001", 250).empty
        assert _count(scope, fake, "fetch_daily", "000001") == 1  # 失败后零调用
