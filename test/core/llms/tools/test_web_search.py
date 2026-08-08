"""web_search 工具测试：开关判定 + 降级契约 + _searcher 注入（离线，不碰网络）。

house style 无 mock 框架——注入 stub searcher 验证成功路径；降级路径
（查询失败/空结果）用抛错 stub 验证占位文本不 raise（error-handling
spec：失败返回占位文本，图可继续）。开关三态（真值/假值/未设置）逐字
对齐 get_market_intel._mcp_disabled() 的测试语义。
"""

import os

from core.llms.tools.web_search import make_web_search_tool, web_search_enabled
from utils import runtime_config


def _invoke(searcher, query="贵州茅台 最新公告"):
    tool = make_web_search_tool(_searcher=searcher)
    return tool.invoke({"query": query})


class TestWebSearchEnabled:

    def test_enabled_by_default(self):
        saved = os.environ.pop("WEB_SEARCH_DISABLED", None)
        try:
            assert web_search_enabled() is True
        finally:
            if saved is not None:
                os.environ["WEB_SEARCH_DISABLED"] = saved

    def test_truthy_values_disable(self):
        saved = os.environ.pop("WEB_SEARCH_DISABLED", None)
        try:
            for value in ("1", "true", "yes", "anything"):
                os.environ["WEB_SEARCH_DISABLED"] = value
                assert web_search_enabled() is False
        finally:
            if saved is not None:
                os.environ["WEB_SEARCH_DISABLED"] = saved

    def test_falsey_values_keep_enabled(self):
        saved = os.environ.pop("WEB_SEARCH_DISABLED", None)
        try:
            for value in ("0", "false", "no"):
                os.environ["WEB_SEARCH_DISABLED"] = value
                assert web_search_enabled() is True
        finally:
            if saved is not None:
                os.environ["WEB_SEARCH_DISABLED"] = saved

    def test_override_false_disables_even_without_env(self):
        # 覆盖层 False → 关（env 未禁用也关）；finally 清理防泄漏
        runtime_config.set_runtime_overrides({"WEB_SEARCH_ENABLED": False})
        saved = os.environ.pop("WEB_SEARCH_DISABLED", None)
        try:
            assert web_search_enabled() is False
        finally:
            runtime_config.clear_runtime_overrides()
            if saved is not None:
                os.environ["WEB_SEARCH_DISABLED"] = saved

    def test_override_true_enables_even_with_env_disabled(self):
        # env 反例：env 禁用 + 覆盖 True → 开（覆盖优先）
        runtime_config.set_runtime_overrides({"WEB_SEARCH_ENABLED": True})
        saved = os.environ.get("WEB_SEARCH_DISABLED")
        os.environ["WEB_SEARCH_DISABLED"] = "1"
        try:
            assert web_search_enabled() is True
        finally:
            runtime_config.clear_runtime_overrides()
            if saved is None:
                os.environ.pop("WEB_SEARCH_DISABLED", None)
            else:
                os.environ["WEB_SEARCH_DISABLED"] = saved

    def test_clear_restores_env_behavior(self):
        runtime_config.set_runtime_overrides({"WEB_SEARCH_ENABLED": False})
        runtime_config.clear_runtime_overrides()
        saved = os.environ.pop("WEB_SEARCH_DISABLED", None)
        try:
            assert web_search_enabled() is True
        finally:
            if saved is not None:
                os.environ["WEB_SEARCH_DISABLED"] = saved


class TestMakeWebSearchTool:

    def test_success_path_returns_chinese_summary(self):
        results = [{
            "title": "贵州茅台发布半年报",
            "link": "https://example.com/moutai",
            "snippet": "上半年营收同比增长",
            "date": "2026-07-31",
        }]
        text = _invoke(lambda q: results)
        assert "【联网搜索结果】" in text
        assert "标题：贵州茅台发布半年报" in text
        assert "链接：https://example.com/moutai" in text
        assert "摘要：上半年营收同比增长" in text
        assert "日期：2026-07-31" in text

    def test_dirty_entries_skipped(self):
        # 空 dict 等无有效字段条目跳过；无标题条目（仅链接）不丢弃
        text = _invoke(lambda q: [
            {"title": "a", "link": "u1", "snippet": "s1"},
            {},
            {"link": "u2"},
            {"title": "b", "link": "u3"},
        ])
        assert "标题：a" in text and "标题：b" in text
        assert text.count("标题：") == 2

    def test_failure_returns_placeholder(self):
        def boom(query):
            raise RuntimeError("ddgs 反爬拦截")
        assert _invoke(boom) == "（联网搜索失败：ddgs 反爬拦截）"

    def test_empty_results_returns_placeholder(self):
        assert _invoke(lambda q: []) == "（联网搜索失败：无返回结果）"

    def test_tool_shape_bindable(self):
        tool = make_web_search_tool(_searcher=lambda q: [])
        assert tool.name == "web_search"
        assert "query" in tool.args_schema.model_json_schema()["properties"]
