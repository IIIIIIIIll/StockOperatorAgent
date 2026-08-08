"""billions_config 开关矩阵测试（离线，不碰网络）。

对齐 web_search 开关测试语义（TestWebSearchEnabled 的 env save/restore
模式）：显式清除全部 BILLIONS_* 环境变量再设置目标对——跨运行确定性
（testing spec：不能假设环境初始状态，开发者本机可能残留开关值）。

矩阵覆盖：key 缺失 / 空 key / 总闸 / 五能力闸 / 真值语义（""/"0"/
"false"/"no" 保留、其余禁用）/ 调用方大小写 / max_calls env 覆盖与
非法值回退。
"""

import os

from utils import billions_config, runtime_config

# 测试涉及的全部 BILLIONS_* env——每次运行前全部清除（含 MAX_CALLS，
# 防开发者本机残留影响开关断言）
_ENV_KEYS = [
    "BILLIONS_API_KEY",
    "BILLIONS_DISABLED",
    "BILLIONS_FINDB_DISABLED",
    "BILLIONS_SEARCH_DISABLED",
    "BILLIONS_TWITTER_DISABLED",
    "BILLIONS_FETCH_DISABLED",
    "BILLIONS_ANALYST_DISABLED",
    "BILLIONS_FINDB_MAX_CALLS",
    "BILLIONS_SEARCH_MAX_CALLS",
    "BILLIONS_TWITTER_MAX_CALLS",
    "BILLIONS_FETCH_MAX_CALLS",
    "BILLIONS_ANALYST_MAX_CALLS",
]

_ALL_CAPS = ("FINDB", "SEARCH", "TWITTER", "FETCH", "ANALYST")


def _with_env(pairs, fn):
    """临时设置 env（None 值 = 清除），fn 执行后恢复原状（跨运行确定性）。

    先全量清空 _ENV_KEYS（显式置空串）再应用 pairs：空串为显式假值且
    load_dotenv 不覆盖已设键——防开发者 shell/.env 残留 BILLIONS_* 翻转用例。
    """
    saved = {key: os.environ.get(key) for key in _ENV_KEYS}
    try:
        for key in _ENV_KEYS:
            os.environ[key] = ""
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


class TestBillionsEnabled:

    def test_no_key_disables_every_capability(self):
        # 主闸未配置 → 五能力全关（AC1：现有流程零变化）
        for cap in _ALL_CAPS:
            assert _with_env(
                {"BILLIONS_API_KEY": None}, lambda cap=cap: billions_config.billions_enabled(cap)
            ) is False

    def test_empty_key_disables(self):
        # 空 key 视为未配置（非空校验）
        assert _with_env(
            {"BILLIONS_API_KEY": ""}, lambda: billions_config.billions_enabled("SEARCH")
        ) is False

    def test_key_only_enables_all_capabilities(self):
        for cap in _ALL_CAPS:
            assert _with_env(
                {"BILLIONS_API_KEY": "k"}, lambda cap=cap: billions_config.billions_enabled(cap)
            ) is True

    def test_master_switch_truthy_disables(self):
        # 总闸任意真值（"1"/"true"/"yes"/随意）→ 全关
        for value in ("1", "true", "yes", "anything"):
            assert _with_env(
                {"BILLIONS_API_KEY": "k", "BILLIONS_DISABLED": value},
                lambda: billions_config.billions_enabled("SEARCH"),
            ) is False

    def test_master_switch_falsey_keeps_enabled(self):
        # 总闸显式假值（""/"0"/"false"/"no"）→ 保留（恢复路径）
        for value in ("", "0", "false", "no"):
            assert _with_env(
                {"BILLIONS_API_KEY": "k", "BILLIONS_DISABLED": value},
                lambda: billions_config.billions_enabled("SEARCH"),
            ) is True

    def test_per_capability_switch_independent(self):
        # SEARCH 单独关 → 仅 SEARCH 关，其余能力不受影响（AC3）
        def check():
            assert billions_config.billions_enabled("SEARCH") is False
            assert billions_config.billions_enabled("TWITTER") is True
            assert billions_config.billions_enabled("FINDB") is True
            assert billions_config.billions_enabled("FETCH") is True
            assert billions_config.billions_enabled("ANALYST") is True

        _with_env({"BILLIONS_API_KEY": "k", "BILLIONS_SEARCH_DISABLED": "1"}, check)

    def test_analyst_switch_truthy_disables(self):
        assert _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_ANALYST_DISABLED": "true"},
            lambda: billions_config.billions_enabled("ANALYST"),
        ) is False
        assert _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_ANALYST_DISABLED": "true"},
            lambda: billions_config.billions_enabled("SEARCH"),
        ) is True

    def test_capability_case_insensitive(self):
        # 调用方传小写 → 内部 upper 后读大写 env
        assert _with_env(
            {"BILLIONS_API_KEY": "k"},
            lambda: billions_config.billions_enabled("findb"),
        ) is True
        assert _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_FINDB_DISABLED": "1"},
            lambda: billions_config.billions_enabled("findb"),
        ) is False


class TestBillionsMaxCalls:

    def test_default_when_env_unset(self):
        assert _with_env(
            {"BILLIONS_SEARCH_MAX_CALLS": None},
            lambda: billions_config.billions_max_calls("SEARCH", 3),
        ) == 3

    def test_env_overrides_default(self):
        assert _with_env(
            {"BILLIONS_SEARCH_MAX_CALLS": "5"},
            lambda: billions_config.billions_max_calls("SEARCH", 3),
        ) == 5

    def test_case_insensitive(self):
        assert _with_env(
            {"BILLIONS_FETCH_MAX_CALLS": "7"},
            lambda: billions_config.billions_max_calls("fetch", 3),
        ) == 7

    def test_invalid_value_falls_back_to_default(self):
        # 配置错误不阻断：非法整数 → 回退默认
        assert _with_env(
            {"BILLIONS_TWITTER_MAX_CALLS": "abc"},
            lambda: billions_config.billions_max_calls("TWITTER", 2),
        ) == 2

    def test_zero_and_negative_allowed(self):
        # 显式 0（禁用该工具）与负值不被 int 解析吞掉——原样返回
        assert _with_env(
            {"BILLIONS_SEARCH_MAX_CALLS": "0"},
            lambda: billions_config.billions_max_calls("SEARCH", 3),
        ) == 0


class TestBillionsRuntimeOverrides:
    """覆盖层（runtime_config）优先于 env；无 key 硬约束不可覆盖。

    每个用例在 finally 里 clear_runtime_overrides——覆盖层是模块级
    全局，泄漏会翻转后续用例（既有 env 矩阵用例假设覆盖层为空）。
    """

    def test_no_key_override_cannot_enable(self):
        # 主闸硬约束（AC1）：无 BILLIONS_API_KEY 时能力覆盖开也无效
        runtime_config.set_runtime_overrides({"BILLIONS_SEARCH": True})
        try:
            assert _with_env(
                {"BILLIONS_API_KEY": None},
                lambda: billions_config.billions_enabled("SEARCH"),
            ) is False
        finally:
            runtime_config.clear_runtime_overrides()

    def test_master_false_disables_everything(self):
        # MASTER=False 覆盖 → 全关（即使 env 全开）
        runtime_config.set_runtime_overrides({"BILLIONS_MASTER": False})
        try:
            def check():
                for cap in _ALL_CAPS:
                    assert billions_config.billions_enabled(cap) is False

            _with_env({"BILLIONS_API_KEY": "k"}, check)
        finally:
            runtime_config.clear_runtime_overrides()

    def test_master_true_not_forcing(self):
        # MASTER=True 覆盖 → 不强制（未覆盖项走 env）
        runtime_config.set_runtime_overrides({"BILLIONS_MASTER": True})
        try:
            assert _with_env(
                {"BILLIONS_API_KEY": "k", "BILLIONS_SEARCH_DISABLED": "1"},
                lambda: billions_config.billions_enabled("SEARCH"),
            ) is False
        finally:
            runtime_config.clear_runtime_overrides()

    def test_capability_override_enables_over_env_disabled(self):
        # env 反例：env 能力闸关 + 覆盖开 → 开（覆盖优先于 env）
        runtime_config.set_runtime_overrides({"BILLIONS_SEARCH": True})
        try:
            assert _with_env(
                {"BILLIONS_API_KEY": "k", "BILLIONS_SEARCH_DISABLED": "1"},
                lambda: billions_config.billions_enabled("SEARCH"),
            ) is True
        finally:
            runtime_config.clear_runtime_overrides()

    def test_capability_override_disables_over_env_enabled(self):
        # 覆盖关 → 关；其他未覆盖能力不受影响
        runtime_config.set_runtime_overrides({"BILLIONS_TWITTER": False})
        try:
            assert _with_env(
                {"BILLIONS_API_KEY": "k"},
                lambda: billions_config.billions_enabled("TWITTER"),
            ) is False
            assert _with_env(
                {"BILLIONS_API_KEY": "k"},
                lambda: billions_config.billions_enabled("FINDB"),
            ) is True
        finally:
            runtime_config.clear_runtime_overrides()

    def test_uncovered_capability_goes_env(self):
        # 只覆盖 SEARCH——FETCH 未覆盖 → env 判定（能力闸关 → 关）
        runtime_config.set_runtime_overrides({"BILLIONS_SEARCH": True})
        try:
            assert _with_env(
                {"BILLIONS_API_KEY": "k", "BILLIONS_FETCH_DISABLED": "1"},
                lambda: billions_config.billions_enabled("FETCH"),
            ) is False
        finally:
            runtime_config.clear_runtime_overrides()

    def test_clear_restores_env_behavior(self):
        runtime_config.set_runtime_overrides({"BILLIONS_SEARCH": False})
        runtime_config.clear_runtime_overrides()
        assert _with_env(
            {"BILLIONS_API_KEY": "k"},
            lambda: billions_config.billions_enabled("SEARCH"),
        ) is True

    def test_env_unchanged_by_overrides(self):
        # env 隔离：覆盖层操作前后 os.environ 零改动
        before = dict(os.environ)
        runtime_config.set_runtime_overrides(
            {"BILLIONS_MASTER": False, "BILLIONS_SEARCH_MAX_CALLS": 9}
        )
        runtime_config.clear_runtime_overrides()
        assert dict(os.environ) == before

    def test_max_calls_override_wins_over_env(self):
        runtime_config.set_runtime_overrides({"BILLIONS_SEARCH_MAX_CALLS": 9})
        try:
            assert _with_env(
                {"BILLIONS_SEARCH_MAX_CALLS": "5"},
                lambda: billions_config.billions_max_calls("SEARCH", 3),
            ) == 9
        finally:
            runtime_config.clear_runtime_overrides()

    def test_max_calls_invalid_override_falls_back_to_env(self):
        # 覆盖值非法（set 时丢弃）→ env 兜底
        runtime_config.set_runtime_overrides({"BILLIONS_SEARCH_MAX_CALLS": "abc"})
        try:
            assert _with_env(
                {"BILLIONS_SEARCH_MAX_CALLS": "5"},
                lambda: billions_config.billions_max_calls("SEARCH", 3),
            ) == 5
        finally:
            runtime_config.clear_runtime_overrides()

    def test_max_calls_uncovered_goes_env(self):
        runtime_config.set_runtime_overrides({"BILLIONS_TWITTER_MAX_CALLS": 4})
        try:
            assert _with_env(
                {"BILLIONS_SEARCH_MAX_CALLS": "5"},
                lambda: billions_config.billions_max_calls("SEARCH", 3),
            ) == 5
        finally:
            runtime_config.clear_runtime_overrides()
