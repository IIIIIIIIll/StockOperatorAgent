"""runtime_config 运行时覆盖层测试（离线，不碰 env/网络）。

覆盖：set/clear 语义（全量替换）、键大小写归一、bool/int 值归一、
默认空 → env_fallback、覆盖优先、非法 int 丢弃、env 隔离（覆盖层
操作前后 os.environ 零改动）。

注意：覆盖层是模块级全局——每个用例结束必须 clear（finally），防
跨用例/跨文件泄漏翻转后续开关断言。
"""

import os

from utils import runtime_config


def _snapshot_environ() -> dict:
    return dict(os.environ)


class TestSetClear:

    def test_default_empty_returns_env_fallback(self):
        runtime_config.clear_runtime_overrides()
        try:
            assert runtime_config.runtime_bool("WEB_SEARCH_ENABLED", True) is True
            assert runtime_config.runtime_bool("WEB_SEARCH_ENABLED", False) is False
            assert runtime_config.runtime_int("BILLIONS_SEARCH_MAX_CALLS", 3) == 3
        finally:
            runtime_config.clear_runtime_overrides()

    def test_override_takes_priority_over_env_fallback(self):
        runtime_config.set_runtime_overrides({"WEB_SEARCH_ENABLED": False})
        try:
            # env 兜底为 True（启用）也被覆盖为 False
            assert runtime_config.runtime_bool("WEB_SEARCH_ENABLED", True) is False
        finally:
            runtime_config.clear_runtime_overrides()

    def test_set_is_full_replace(self):
        # 第二次 set 清空旧键（整组替换语义，非增量合并）
        runtime_config.set_runtime_overrides({"TDX_MCP_ENABLED": True})
        try:
            runtime_config.set_runtime_overrides({"WEB_SEARCH_ENABLED": False})
            assert runtime_config.runtime_bool("TDX_MCP_ENABLED", False) is False
            assert runtime_config.runtime_bool("WEB_SEARCH_ENABLED", True) is False
        finally:
            runtime_config.clear_runtime_overrides()

    def test_clear_restores_env_behavior(self):
        runtime_config.set_runtime_overrides({"TDX_MCP_ENABLED": True})
        runtime_config.clear_runtime_overrides()
        assert runtime_config.runtime_bool("TDX_MCP_ENABLED", False) is False

    def test_key_case_insensitive(self):
        # 小写键 set、大写键读，反之亦然——存储恒为大写
        runtime_config.set_runtime_overrides({"web_search_enabled": True})
        try:
            assert runtime_config.runtime_bool("WEB_SEARCH_ENABLED", False) is True
        finally:
            runtime_config.clear_runtime_overrides()
        runtime_config.set_runtime_overrides({"WEB_SEARCH_ENABLED": False})
        try:
            assert runtime_config.runtime_bool("web_search_enabled", True) is False
        finally:
            runtime_config.clear_runtime_overrides()

    def test_env_unchanged_by_set_clear(self):
        # env 隔离：覆盖层只动内存 dict，os.environ 零改动
        before = _snapshot_environ()
        runtime_config.set_runtime_overrides(
            {"WEB_SEARCH_ENABLED": False, "BILLIONS_SEARCH_MAX_CALLS": 5}
        )
        runtime_config.clear_runtime_overrides()
        assert _snapshot_environ() == before


class TestValueNormalization:

    def test_bool_string_truthy_semantics(self):
        # 字符串按 env truthy 语义：""/"0"/"false"/"no" → False，其余 True
        try:
            for value in ("true", "1", "yes", "anything", "True", "FALSE"):
                runtime_config.set_runtime_overrides({"WEB_SEARCH_ENABLED": value})
                assert runtime_config.runtime_bool("WEB_SEARCH_ENABLED", False) is (
                    value.lower() not in ("", "0", "false", "no")
                )
            for value in ("0", "false", "no", ""):
                runtime_config.set_runtime_overrides({"WEB_SEARCH_ENABLED": value})
                assert runtime_config.runtime_bool("WEB_SEARCH_ENABLED", True) is False
        finally:
            runtime_config.clear_runtime_overrides()

    def test_bool_non_string_value(self):
        runtime_config.set_runtime_overrides({"WEB_SEARCH_ENABLED": 1})
        try:
            assert runtime_config.runtime_bool("WEB_SEARCH_ENABLED", False) is True
        finally:
            runtime_config.clear_runtime_overrides()

    def test_int_string_normalized(self):
        runtime_config.set_runtime_overrides({"BILLIONS_SEARCH_MAX_CALLS": "7"})
        try:
            assert runtime_config.runtime_int("BILLIONS_SEARCH_MAX_CALLS", 3) == 7
        finally:
            runtime_config.clear_runtime_overrides()

    def test_invalid_int_dropped_falls_back(self):
        # 非法上限值（非整数）set 时丢弃 → runtime_int 回退 env 兜底
        runtime_config.set_runtime_overrides({"BILLIONS_SEARCH_MAX_CALLS": "abc"})
        try:
            assert runtime_config.runtime_int("BILLIONS_SEARCH_MAX_CALLS", 3) == 3
        finally:
            runtime_config.clear_runtime_overrides()

    def test_zero_allowed(self):
        # 显式 0（禁用该工具）是合法上限，不被误判丢弃
        runtime_config.set_runtime_overrides({"BILLIONS_SEARCH_MAX_CALLS": 0})
        try:
            assert runtime_config.runtime_int("BILLIONS_SEARCH_MAX_CALLS", 3) == 0
        finally:
            runtime_config.clear_runtime_overrides()
