"""角色注册表一致性单测（08-09-role-registry）。

注册表是图装配与 UI Tab 渲染的**单一事实源**——四条契约钉死：

1. State key 双向覆盖：State 注解的报告类 key == 注册表报告 key
   （新增 key 需先注册，新增注册需先入 State——双向锁死）
2. 图形状：build_node_names/build_edges 两种形态 == 冻结期望
   （基础 8 节点 16 边、ANALYST 开 9 节点 19 边——与 08-08 手写接线
   精确一致，集成测试再验真实图）
3. Tab 顺序：report_roles() 两种形态 == 冻结期望（与 display.report_tabs
   共用同一数据源；display 侧的开关矩阵断言见 test_display.py）
4. 信息面分析师谓词真值表：三态 env × 组合的期望真值（与 08-08 条件
   接线语义一致——含 Out of Scope 组合 = 不注册）

house style：不 mock Streamlit——display.report_tabs() 的渲染契约由
既有 test_display 开关矩阵覆盖；本文件只测注册表自身与装配导出。
"""

import os

from utils.state import State
from utils.runtime_config import clear_runtime_overrides

from core.role_registry import (
    ROLES,
    build_edges,
    build_node_names,
    enabled_roles,
    information_analyst_enabled,
    report_roles,
)

# 亿信 env 三件套（谓词判定只依赖这三个开关 + 主闸 key；对齐
# test_display._with_billions_env 的先全清再设置语义——跨运行确定性）
_ENV_KEYS = [
    "BILLIONS_API_KEY",
    "BILLIONS_ANALYST_DISABLED",
    "BILLIONS_SEARCH_DISABLED",
    "BILLIONS_TWITTER_DISABLED",
]


def _with_billions_env(pairs, fn):
    """临时设置亿信 env（None 值 = 清除），fn 执行后恢复原状。

    先**全部清除**再应用目标对——pairs 之外残留的 BILLIONS_*（开发者
    shell/.env 导出）不得影响开关矩阵断言（testing spec 同语义）。
    同时清空运行时覆盖层（billions_enabled 覆盖优先——防前序用例残留
    覆盖翻转真值表）。
    """
    saved = {key: os.environ.get(key) for key in _ENV_KEYS}
    clear_runtime_overrides()
    try:
        for key in _ENV_KEYS:
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
        clear_runtime_overrides()


# ---- 冻结期望（与 08-08 手写接线的精确形态，改注册表时对照此表）----

_EXPECTED_KEYS = (
    "fundamental_analysis",
    "trend_analysis",
    "technical_indicator_analysis",
    "information_analysis",
    "bullish_opinions",
    "bearish_opinions",
    "final_decision",
)

_EXPECTED_TITLES = (
    "基本面分析",
    "趋势分析",
    "技术指标分析",
    "信息面分析",
    "看涨观点",
    "看跌观点",
    "最终结论",
)

_BASE_NODES = (
    "fundamental_analysis_expert",
    "trend_analysis_expert",
    "technical_indicator_analyst",
    "bullish_trader",
    "bearish_trader",
    "bullish_revise",
    "bearish_revise",
    "investment_manager",
)

_ANALYST_NODES = (
    "fundamental_analysis_expert",
    "trend_analysis_expert",
    "technical_indicator_analyst",
    "information_analyst",
    "bullish_trader",
    "bearish_trader",
    "bullish_revise",
    "bearish_revise",
    "investment_manager",
)

# 边集与 08-08 手写接线逐边相同；顺序为 build_edges 的确定性顺序
# （按交易员分组：每个 trader 先收全部专家入边）——LangGraph 边为集合
# 语义，顺序无关；冻结顺序仅保证输出确定性（集成测试验真实图行为）。
_BASE_EDGES = [
    ("START", "fundamental_analysis_expert"),
    ("START", "trend_analysis_expert"),
    ("START", "technical_indicator_analyst"),
    ("fundamental_analysis_expert", "bullish_trader"),
    ("trend_analysis_expert", "bullish_trader"),
    ("technical_indicator_analyst", "bullish_trader"),
    ("fundamental_analysis_expert", "bearish_trader"),
    ("trend_analysis_expert", "bearish_trader"),
    ("technical_indicator_analyst", "bearish_trader"),
    ("bullish_trader", "bullish_revise"),
    ("bearish_trader", "bullish_revise"),
    ("bullish_trader", "bearish_revise"),
    ("bearish_trader", "bearish_revise"),
    ("bullish_revise", "investment_manager"),
    ("bearish_revise", "investment_manager"),
    ("investment_manager", "END"),
]

_ANALYST_EDGES = [
    ("START", "fundamental_analysis_expert"),
    ("START", "trend_analysis_expert"),
    ("START", "technical_indicator_analyst"),
    ("START", "information_analyst"),
    ("fundamental_analysis_expert", "bullish_trader"),
    ("trend_analysis_expert", "bullish_trader"),
    ("technical_indicator_analyst", "bullish_trader"),
    ("information_analyst", "bullish_trader"),
    ("fundamental_analysis_expert", "bearish_trader"),
    ("trend_analysis_expert", "bearish_trader"),
    ("technical_indicator_analyst", "bearish_trader"),
    ("information_analyst", "bearish_trader"),
    ("bullish_trader", "bullish_revise"),
    ("bearish_trader", "bullish_revise"),
    ("bullish_trader", "bearish_revise"),
    ("bearish_trader", "bearish_revise"),
    ("bullish_revise", "investment_manager"),
    ("bearish_revise", "investment_manager"),
    ("investment_manager", "END"),
]


class TestRoleRegistryStateContract:

    def test_state_report_keys_covered_by_registry(self):
        """State 的报告类注解 ⊆ 注册表报告 key——新增 key 需先注册。"""
        registered = {r.state_key for r in ROLES if r.state_key is not None}
        state_annotations = set(State.__annotations__)
        infra_keys = {"target_stock_ticker", "stock_information", "messages"}
        assert state_annotations - infra_keys <= registered

    def test_registry_report_keys_exactly_match_state(self):
        """反向锁死：注册表报告 key == State 报告类注解（不多不少——
        注册条目缺失即装配缺 key，集成测试会漏）。"""
        registered = {r.state_key for r in ROLES if r.state_key is not None}
        state_report_keys = set(State.__annotations__) - {
            "target_stock_ticker", "stock_information", "messages"}
        assert registered == state_report_keys

    def test_registry_keys_and_titles_frozen(self):
        """报告 key/标题顺序 == 冻结期望（= display.report_tabs 顺序）。"""
        reports = report_roles(ROLES)  # 全量名册（不按开关过滤）——顺序契约
        assert tuple(r.state_key for r in reports) == _EXPECTED_KEYS
        assert tuple(r.tab_title for r in reports) == _EXPECTED_TITLES


class TestRoleRegistryGraphShape:

    def test_base_shape_without_billions_key(self):
        """无 BILLIONS_API_KEY（主闸关）→ 8 节点 16 边，与现状逐边一致。"""
        def _assert():
            roles = enabled_roles()
            assert tuple(build_node_names(roles)) == _BASE_NODES
            assert build_edges(roles) == _BASE_EDGES
        _with_billions_env({"BILLIONS_API_KEY": None}, _assert)

    def test_analyst_shape_with_key_and_switches_on(self):
        """有 key 且 ANALYST/SEARCH/TWITTER 全开 → 9 节点 19 边。"""
        def _assert():
            roles = enabled_roles()
            assert tuple(build_node_names(roles)) == _ANALYST_NODES
            assert build_edges(roles) == _ANALYST_EDGES
        _with_billions_env({
            "BILLIONS_API_KEY": "dummy",
            "BILLIONS_ANALYST_DISABLED": None,
            "BILLIONS_SEARCH_DISABLED": None,
            "BILLIONS_TWITTER_DISABLED": None,
        }, _assert)

    def test_analyst_off_switches_off_shape(self):
        """有 key 但 ANALYST 关 → 8 节点 16 边（条件接线不回退到
        START/边注册——零行为变化，AC1）。"""
        def _assert():
            roles = enabled_roles()
            assert tuple(build_node_names(roles)) == _BASE_NODES
            assert build_edges(roles) == _BASE_EDGES
        _with_billions_env({
            "BILLIONS_API_KEY": "dummy",
            "BILLIONS_ANALYST_DISABLED": "1",
        }, _assert)


class TestInformationAnalystPredicate:

    def test_no_key_disables_analyst(self):
        """主闸 key 缺席 → 谓词恒 False（与开关无关——billions_enabled
        主闸语义）。"""
        def _assert():
            assert information_analyst_enabled() is False
        _with_billions_env({"BILLIONS_API_KEY": None}, _assert)

    def test_truth_table(self):
        """三态组合真值表：ANALYST 开 且（SEARCH 或 TWITTER 至少一者开）
        → True；ANALYST 关 或 检索源全关（Out of Scope）→ False。"""
        def _case(analyst_on, search_on, twitter_on, expected):
            def _assert():
                assert information_analyst_enabled() is expected
            pairs = {"BILLIONS_API_KEY": "dummy"}
            if not analyst_on:
                pairs["BILLIONS_ANALYST_DISABLED"] = "1"
            if not search_on:
                pairs["BILLIONS_SEARCH_DISABLED"] = "1"
            if not twitter_on:
                pairs["BILLIONS_TWITTER_DISABLED"] = "1"
            _with_billions_env(pairs, _assert)

        _case(True, True, True, True)
        _case(True, True, False, True)
        _case(True, False, True, True)
        _case(True, False, False, False)  # Out of Scope：检索源全关
        _case(False, True, True, False)
        _case(False, False, False, False)

    def test_opinion_flags_match_display_contract(self):
        """观点类 key == display.OPINION_REPORT_KEYS（轮次折叠渲染契约）。"""
        from core.ui import display
        opinion_keys = {r.state_key for r in ROLES if r.opinion}
        assert opinion_keys == set(display.OPINION_REPORT_KEYS)

    def test_every_trader_carries_explicit_revise_node(self):
        """trader 的对抗修订节点名显式声明（命名非纯后缀规则——
        bullish_trader → bullish_revise），缺省即装配断链。"""
        for r in ROLES:
            if r.kind == "trader":
                assert r.revise_node_name is not None
                assert r.revise_node_name != r.node_name
