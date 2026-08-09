"""08-02-mcp-intel-cache：MCP 情报缓存测试。

离线（house style 无 mock 框架——monkeypatch 注入 + 临时目录）：
- mcp_intel_cache 读写往返 / 损坏 / 空 / 缺失 / 原子写。
- get_market_intel 缓存行为：patch utils.market_time.is_trading_time
  （get_market_intel 函数内 import，运行时解析模块属性）+ 计数包装
  core.llms.tools.get_market_intel._query_mcp（模块级定义可 patch），
  注入缓存根（patch mcp_intel_cache.DEFAULT_CACHE_ROOT——get_market_intel
  函数内 import 常量，运行时解析）。
"""

import json

import pytest

from core.llms.tools import get_market_intel as gmi
from core.llms.tools import mcp_intel_cache as mic
from utils import runtime_config


class TestCacheReadWrite:

    def test_write_then_read_roundtrip(self, tmp_path):
        assert mic.write_cache(tmp_path, "000001", "【实时市场情报】\n名称: 平安银行") is True
        assert mic.read_cache(tmp_path, "000001") == "【实时市场情报】\n名称: 平安银行"

    def test_cache_file_location_and_schema(self, tmp_path):
        mic.write_cache(tmp_path, "000001", "text")
        path = tmp_path / "mcp_intel" / "ticker=000001" / "data.json"
        assert path.exists()
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["text"] == "text"
        assert "fetched_at" in data

    def test_missing_returns_none(self, tmp_path):
        assert mic.read_cache(tmp_path, "999999") is None

    def test_corrupt_json_returns_none(self, tmp_path):
        path = tmp_path / "mcp_intel" / "ticker=000001" / "data.json"
        path.parent.mkdir(parents=True)
        path.write_text("{not json", encoding="utf-8")
        assert mic.read_cache(tmp_path, "000001") is None

    def test_empty_text_returns_none(self, tmp_path):
        mic.write_cache(tmp_path, "000001", "")
        assert mic.read_cache(tmp_path, "000001") is None

    def test_tmp_file_not_left_behind(self, tmp_path):
        """原子写：成功后无 .tmp 残留。"""
        mic.write_cache(tmp_path, "000001", "text")
        assert not list(tmp_path.rglob("*.tmp"))


class TestMCPDisabledSwitch:
    """08-02-disable-tdx-mcp：TDX_MCP_DISABLED 开关——占位文本、零查询、
    零缓存文件；恢复路径（显式假值）不误禁用。"""

    def test_disabled_with_key_returns_placeholder_no_query(self, tmp_path, monkeypatch):
        """设开关 + 有 key → 占位文本，_query_mcp 零调用、无缓存文件。"""
        _reset_count()
        monkeypatch.setenv("TDX_API_KEY", "dummy")
        monkeypatch.setattr(gmi, "_query_mcp", _counting_query)
        monkeypatch.setattr("utils.market_time.is_trading_time", lambda now=None: False)
        monkeypatch.setattr(mic, "DEFAULT_CACHE_ROOT", tmp_path)
        monkeypatch.setenv("TDX_MCP_DISABLED", "1")

        text = gmi.get_market_intel("000001")
        assert text == gmi._DISABLED_TEXT
        assert _counting_query.calls == 0
        assert not (tmp_path / "mcp_intel").exists()

    def test_disabled_truthy_forms(self, monkeypatch):
        """常见真值形式都禁用（"true"/"yes"/随意非空值）。"""
        for value in ("1", "true", "yes", "anything"):
            monkeypatch.setenv("TDX_MCP_DISABLED", value)
            assert gmi._mcp_disabled() is True

    def test_falsey_forms_do_not_disable(self, monkeypatch):
        """显式假值（"0"/"false"/"no"）与未设置 → 不禁用（恢复路径）。"""
        for value in ("0", "false", "no"):
            monkeypatch.setenv("TDX_MCP_DISABLED", value)
            assert gmi._mcp_disabled() is False
        monkeypatch.delenv("TDX_MCP_DISABLED", raising=False)
        assert gmi._mcp_disabled() is False

    def test_disabled_without_key_returns_placeholder(self, tmp_path, monkeypatch):
        """设开关 + 无 key → 占位文本（开关优先，语义一致）。"""
        monkeypatch.setattr(mic, "DEFAULT_CACHE_ROOT", tmp_path)
        monkeypatch.setenv("TDX_MCP_DISABLED", "1")
        saved = __import__("os").environ.pop("TDX_API_KEY", None)
        try:
            assert gmi.get_market_intel("000001") == gmi._DISABLED_TEXT
        finally:
            if saved is not None:
                __import__("os").environ["TDX_API_KEY"] = saved
        assert not (tmp_path / "mcp_intel").exists()

    def test_override_true_enables_over_env_disabled(self, monkeypatch):
        """env 反例：env 禁用 + 覆盖 TDX_MCP_ENABLED=True → 不禁用（覆盖优先）。"""
        runtime_config.set_runtime_overrides({"TDX_MCP_ENABLED": True})
        try:
            monkeypatch.setenv("TDX_MCP_DISABLED", "1")
            assert gmi._mcp_disabled() is False
        finally:
            runtime_config.clear_runtime_overrides()

    def test_override_false_disables_even_without_env(self, monkeypatch):
        """覆盖 False → 禁用（env 未禁用也关）。"""
        runtime_config.set_runtime_overrides({"TDX_MCP_ENABLED": False})
        try:
            monkeypatch.delenv("TDX_MCP_DISABLED", raising=False)
            assert gmi._mcp_disabled() is True
        finally:
            runtime_config.clear_runtime_overrides()

    def test_override_true_queries_despite_env_disabled(self, tmp_path, monkeypatch):
        """集成：env 禁用 + 覆盖开 → 走真实查询路径（开关消费点在
        get_market_intel 入口生效）。"""
        _reset_count()
        monkeypatch.setenv("TDX_API_KEY", "dummy")
        runtime_config.set_runtime_overrides({"TDX_MCP_ENABLED": True})
        try:
            monkeypatch.setattr(gmi, "_query_mcp", _counting_query)
            monkeypatch.setattr("utils.market_time.is_trading_time", lambda now=None: False)
            monkeypatch.setattr(mic, "DEFAULT_CACHE_ROOT", tmp_path)
            monkeypatch.setenv("TDX_MCP_DISABLED", "1")

            text = gmi.get_market_intel("000001")
            assert text == _counting_query.RESULT
            assert _counting_query.calls == 1
        finally:
            runtime_config.clear_runtime_overrides()


class TestGetMarketIntelCaching:

    def test_after_hours_uses_cache_without_query(self, tmp_path, monkeypatch):
        """非交易时段 + 缓存存在 → 返回缓存，零查询。"""
        _reset_count()
        monkeypatch.setenv("TDX_API_KEY", "dummy")
        mic.write_cache(tmp_path, "000001", "【实时市场情报】\n缓存文本")
        monkeypatch.setattr(gmi, "_query_mcp", _counting_query)
        monkeypatch.setattr("utils.market_time.is_trading_time", lambda now=None: False)
        monkeypatch.setattr(mic, "DEFAULT_CACHE_ROOT", tmp_path)

        text = gmi.get_market_intel("000001")
        assert text == "【实时市场情报】\n缓存文本"
        assert _counting_query.calls == 0

    def test_after_hours_no_cache_queries_and_writes(self, tmp_path, monkeypatch):
        """非交易时段 + 无缓存 → 实时查询一次并写缓存。"""
        _reset_count()
        monkeypatch.setenv("TDX_API_KEY", "dummy")
        monkeypatch.setattr(gmi, "_query_mcp", _counting_query)
        monkeypatch.setattr("utils.market_time.is_trading_time", lambda now=None: False)
        monkeypatch.setattr(mic, "DEFAULT_CACHE_ROOT", tmp_path)

        text = gmi.get_market_intel("000001")
        assert text == _counting_query.RESULT
        assert _counting_query.calls == 1
        assert mic.read_cache(tmp_path, "000001") == _counting_query.RESULT

    def test_trading_hours_queries_even_with_cache(self, tmp_path, monkeypatch):
        """交易时段 → 实时查询（不读缓存），成功写缓存。"""
        _reset_count()
        monkeypatch.setenv("TDX_API_KEY", "dummy")
        mic.write_cache(tmp_path, "000001", "旧缓存")
        monkeypatch.setattr(gmi, "_query_mcp", _counting_query)
        monkeypatch.setattr("utils.market_time.is_trading_time", lambda now=None: True)
        monkeypatch.setattr(mic, "DEFAULT_CACHE_ROOT", tmp_path)

        text = gmi.get_market_intel("000001")
        assert text == _counting_query.RESULT
        assert _counting_query.calls == 1
        assert mic.read_cache(tmp_path, "000001") == _counting_query.RESULT  # 缓存已更新

    def test_no_key_does_not_touch_cache(self, tmp_path, monkeypatch):
        """无 TDX_API_KEY → 占位文本，不读写缓存文件。"""
        monkeypatch.setattr(mic, "DEFAULT_CACHE_ROOT", tmp_path)
        saved = __import__("os").environ.pop("TDX_API_KEY", None)
        try:
            assert gmi.get_market_intel("000001") == gmi._FALLBACK_TEXT
        finally:
            if saved is not None:
                __import__("os").environ["TDX_API_KEY"] = saved
        assert not (tmp_path / "mcp_intel").exists()

    def test_query_failure_after_hours_writes_placeholder(self, tmp_path, monkeypatch):
        """非交易时段 + 无缓存 + 查询失败 → 占位文本仍写缓存（可缓存降级
        信息，下次非交易时段直接命中——不重复失败查询）。"""
        monkeypatch.setenv("TDX_API_KEY", "dummy")
        def failing_query(ticker, api_key):
            return "（通达信 MCP 查询异常，跳过000001的实时情报）"
        monkeypatch.setattr(gmi, "_query_mcp", failing_query)
        monkeypatch.setattr("utils.market_time.is_trading_time", lambda now=None: False)
        monkeypatch.setattr(mic, "DEFAULT_CACHE_ROOT", tmp_path)

        text = gmi.get_market_intel("000001")
        assert "查询异常" in text
        assert mic.read_cache(tmp_path, "000001") == text


def _reset_count():
    """每个测试开头重置模块级计数（跨测试累积会误判）。"""
    _counting_query.calls = 0


def _counting_query(ticker, api_key):
    _counting_query.calls = getattr(_counting_query, "calls", 0) + 1
    return _counting_query.RESULT


_counting_query.RESULT = "【实时市场情报】\n名称: 平安银行, 最新价: 11.11"
_counting_query.calls = 0
