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


class TestEnvPrimitives:
    """env_disabled / env_int（08-09-unify-config-parsing，Step 1）。

    env_disabled 是全库唯一负极性判定（消费点一律取反算正布尔）——真假
    值/未设置三态真值表与既有消费点语义逐字一致（""/"0"/"false"/"no"
    显式假值，大小写敏感）；env_int 非法值回退默认（配置错误不阻断）。
    """

    _KEYS = ("TEST_DISABLED", "TEST_MAX_CALLS")

    def _with_env(self, pairs, fn):
        """临时设置 env（None = 清除），fn 执行后恢复原状（house style，
        先全量清除再应用——防开发者 shell/.env 残留翻转断言）。"""
        saved = {key: os.environ.get(key) for key in self._KEYS}
        try:
            for key in self._KEYS:
                os.environ.pop(key, None)
            for key, value in pairs.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            return fn()
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_disabled_unset_and_falsey_are_false(self):
        # 未设置（三态 1）与显式假值（三态 2）→ 不 disabled
        assert self._with_env(
            {}, lambda: runtime_config.env_disabled("TEST_DISABLED")) is False
        for value in ("", "0", "false", "no"):
            assert self._with_env(
                {"TEST_DISABLED": value},
                lambda: runtime_config.env_disabled("TEST_DISABLED")) is False

    def test_disabled_truthy_any_value_is_true(self):
        # 其余任意值（三态 3）→ disabled；大小写敏感（"FALSE"/"No" 也禁用）
        for value in ("1", "true", "yes", "anything", "FALSE", "No"):
            assert self._with_env(
                {"TEST_DISABLED": value},
                lambda: runtime_config.env_disabled("TEST_DISABLED")) is True

    def test_int_missing_returns_default(self):
        assert self._with_env(
            {}, lambda: runtime_config.env_int("TEST_MAX_CALLS", 3)) == 3

    def test_int_valid_parsed(self):
        assert self._with_env(
            {"TEST_MAX_CALLS": "7"},
            lambda: runtime_config.env_int("TEST_MAX_CALLS", 3)) == 7

    def test_int_invalid_falls_back(self):
        # 非法值（非整数/空串/小数）→ 回退默认，配置错误不阻断
        for value in ("abc", "", "3.5"):
            assert self._with_env(
                {"TEST_MAX_CALLS": value},
                lambda: runtime_config.env_int("TEST_MAX_CALLS", 3)) == 3

    def test_int_zero_and_negative_allowed(self):
        # 0 与负数都是合法 int（0 = 禁用该工具）
        assert self._with_env(
            {"TEST_MAX_CALLS": "0"},
            lambda: runtime_config.env_int("TEST_MAX_CALLS", 3)) == 0
        assert self._with_env(
            {"TEST_MAX_CALLS": "-1"},
            lambda: runtime_config.env_int("TEST_MAX_CALLS", 3)) == -1

    def test_env_primitives_do_not_touch_overrides(self):
        # env 判定与覆盖层隔离：env 原语不读写 _RUNTIME，覆盖值不受影响
        runtime_config.set_runtime_overrides({"WEB_SEARCH_ENABLED": False})
        try:
            assert self._with_env(
                {"TEST_DISABLED": ""},
                lambda: runtime_config.env_disabled("TEST_DISABLED")) is False
            assert runtime_config.runtime_bool("WEB_SEARCH_ENABLED", True) is False
        finally:
            runtime_config.clear_runtime_overrides()
