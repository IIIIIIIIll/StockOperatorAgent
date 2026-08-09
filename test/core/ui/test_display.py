"""08-02-fix-data-correctness：UI key 检查只认 DEEPSEEK_API_KEY（修复 1）。

投资委员会永远构造 DeepSeekApi()（无 key 构造即抛 OpenAIError），旧检查
"DEEPSEEK 或 DASHSCOPE 任一存在"放行后构造崩溃。测试验证 _has_deepseek_key
只认 DEEPSEEK_API_KEY——操纵 os.environ 保存/恢复，不触碰用户真实配置。
"""

import os

from core.ui import display

# 亿信 env（08-08-billions-api-integration，Step 5）：report_tabs() 开关在
# 调用时读 env——测试必须显式清除/设置（开发者本机可能残留 key/开关值，
# 跨运行确定性，testing spec 同 test_billions_config._with_env 语义）。
_BILLIONS_ENV_KEYS = [
    "BILLIONS_API_KEY",
    "BILLIONS_DISABLED",
    "BILLIONS_FINDB_DISABLED",
    "BILLIONS_SEARCH_DISABLED",
    "BILLIONS_TWITTER_DISABLED",
    "BILLIONS_FETCH_DISABLED",
    "BILLIONS_ANALYST_DISABLED",
]


def _with_billions_env(pairs, fn):
    """临时设置亿信 env（None 值 = 清除），fn 执行后恢复原状。

    先**全部清除**再设置目标对（check 修复，2026-08-08）：pairs 之外
    的开关（如开发者本机导出的 BILLIONS_ANALYST_DISABLED）不得影响
    report_tabs() 开关矩阵断言——对齐 test_graph_parallel._with_billions_env
    与 test_billions_config 语义（跨运行确定性，testing spec）。
    """
    saved = {key: os.environ.get(key) for key in _BILLIONS_ENV_KEYS}
    try:
        for key in _BILLIONS_ENV_KEYS:
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


class TestDisplayKeyCheck():

    def test_deepseek_key_passes_check(self):
        saved = os.environ.get("DEEPSEEK_API_KEY")
        os.environ["DEEPSEEK_API_KEY"] = "dummy"
        try:
            assert display._has_deepseek_key() is True
        finally:
            if saved is None:
                os.environ.pop("DEEPSEEK_API_KEY", None)
            else:
                os.environ["DEEPSEEK_API_KEY"] = saved

    def test_no_key_fails_check(self):
        saved = os.environ.get("DEEPSEEK_API_KEY")
        os.environ.pop("DEEPSEEK_API_KEY", None)
        try:
            assert display._has_deepseek_key() is False
        finally:
            if saved is not None:
                os.environ["DEEPSEEK_API_KEY"] = saved

    def test_dashscope_alone_fails_check(self):
        """只配 DASHSCOPE 不放行——与 make_investment_committee 永远构造
        DeepSeekApi 的实现对齐（旧检查放行但构造即崩）。"""
        saved_deepseek = os.environ.pop("DEEPSEEK_API_KEY", None)
        saved_dashscope = os.environ.get("DASHSCOPE_API_KEY")
        os.environ["DASHSCOPE_API_KEY"] = "dummy"
        try:
            assert display._has_deepseek_key() is False
        finally:
            if saved_deepseek is not None:
                os.environ["DEEPSEEK_API_KEY"] = saved_deepseek
            if saved_dashscope is None:
                os.environ.pop("DASHSCOPE_API_KEY", None)
            else:
                os.environ["DASHSCOPE_API_KEY"] = saved_dashscope


class TestDisplayEnrichmentWiring():

    def test_display_uses_shared_build_stock_information(self):
        """修复 1 验收：display 与 make_investment_decision 共用同一
        enrichment 组装点（原 display 直接用 get_stock_info，技术指标与
        实时情报段从未执行）。"""
        from core.investment_committee import build_stock_information
        assert display.build_stock_information is build_stock_information


class TestDisplayIncrementalRender():
    """08-02-ui-incremental-report-render：边算边渲染的纯函数映射。

    iter_report_items 是 dispatch 前的纯映射（节点 update → (key, title,
    content) 渲染项），离线喂合成 update 验证：五 key 映射与标题、顺序
    （= st.tabs 创建顺序）、bullish/bearish 的两种形态（stream 原始
    字符串 / 最终 state 的 add_messages 消息列表）、无报告 key 的
    update → 空。Streamlit 副作用不 mock（house style）。
    """

    def test_report_tabs_match_tab_creation_order(self):
        """report_tabs() 顺序 = write_ui 里 st.tabs 创建顺序（渲染契约；
        无 key → 六报告与今日一致，AC1）。"""
        assert _with_billions_env({"BILLIONS_API_KEY": None}, lambda: [
            k for k, _ in display.report_tabs()]) == [
            "fundamental_analysis", "trend_analysis",
            "technical_indicator_analysis",
            "bullish_opinions", "bearish_opinions", "final_decision",
        ]

    def test_fundamental_update_yields_item(self):
        items = list(display.iter_report_items(
            {"fundamental_analysis": "基本面结论：低估"}))
        assert items == [("fundamental_analysis", "基本面分析", "基本面结论：低估")]

    def test_opinions_plain_string_shape(self):
        """stream update 形态：bullish/bearish 是原始字符串（reducer 未应用）。"""
        items = list(display.iter_report_items({"bullish_opinions": "看多理由：共振"}))
        assert items == [("bullish_opinions", "看涨观点", "看多理由：共振")]

    def test_opinions_message_list_shape(self):
        """最终 state 形态：消息列表 → [-1].content（旧 get_state_history 语义）。"""
        from langchain_core.messages import AIMessage
        items = list(display.iter_report_items(
            {"bearish_opinions": [AIMessage(content="看空理由：高估")]}))
        assert items == [("bearish_opinions", "看跌观点", "看空理由：高估")]

    def test_messages_only_update_yields_nothing(self):
        assert list(display.iter_report_items({"messages": ["q", "r"]})) == []

    def test_full_update_yields_all_six_in_order(self):
        items = _with_billions_env({"BILLIONS_API_KEY": None}, lambda: list(
            display.iter_report_items({
                "fundamental_analysis": "F", "trend_analysis": "T",
                "technical_indicator_analysis": "I",
                "bullish_opinions": "B", "bearish_opinions": "B",
                "final_decision": "M",
            })))
        assert [k for k, _, _ in items] == [
            k for k, _ in _with_billions_env(
                {"BILLIONS_API_KEY": None}, display.report_tabs)]


class TestDisplayDataTab():
    """08-02-ui-collected-data-display：采集数据 Tab 的展示契约。

    数据 Tab 是 enrichment 后、stream 前的独立填充点（st.header +
    st.text 原文），不参与报告 dispatch——测试守住常量与"数据 Tab
    插入不破坏六报告相对顺序"契约（Streamlit 副作用不 mock，
    house style）。
    """

    def test_data_tab_title_constant(self):
        assert display.DATA_TAB_TITLE == "采集数据"

    def test_report_tabs_relative_order_unchanged(self):
        """数据 Tab 插入 st.tabs 最前，报告相对顺序不变（渲染契约；无 key）。"""
        assert _with_billions_env({"BILLIONS_API_KEY": None}, lambda: [
            k for k, _ in display.report_tabs()]) == [
            "fundamental_analysis", "trend_analysis",
            "technical_indicator_analysis",
            "bullish_opinions", "bearish_opinions", "final_decision",
        ]

    def test_tab_labels_derived_from_report_tabs(self):
        """write_ui 的 st.tabs 标签 = [DATA_TAB_TITLE] + report_tabs() 标题
        （条件 Tab 契约，08-08-billions-api-integration，Step 5）。

        列表首元素是 DATA_TAB_TITLE 名称引用（非字面量），报告标题来自
        条件函数（ANALYST 开 → 8 tab 含信息面；关 → 7 tab 与今日一致，
        AC1）——开关矩阵逐项断言见 TestDisplayConditionalTabs。
        """
        import ast
        import inspect
        source = inspect.getsource(display.write_ui)
        tree = ast.parse(source)
        tabs_calls = [node for node in ast.walk(tree)
                      if isinstance(node, ast.Call)
                      and isinstance(node.func, ast.Attribute)
                      and node.func.attr == "tabs"]
        assert len(tabs_calls) == 1
        assert "[DATA_TAB_TITLE] + [title for _, title in _report_tabs]" in source
        # 报告 key → 容器从同一条件列表 zip（顺序契约单点，渲染 dispatch）
        assert "report_tabs_map = dict(zip(" in source


class TestDisplayChartWiring():
    """08-06-ui-data-charts:采集数据 Tab 图表接线(源码字符串断言,
    house style 同 test_theme 的 wiring 测试)。"""

    def test_data_tab_renders_charts_before_tables(self):
        """数据 Tab 图表在 markdown 表格**之前**(2026-08-06 用户反馈
        "把图往前提"——图表是视觉焦点)。08-09 结构化边界:parse-once——
        parse_stock_info 解析一次,图表消费结构化行、表格用
        render_sections(parsed.sections),都不再接触原始文本;空数据空
        迭代不画图,st.altair_chart 交给 streamlit theme 适配亮暗。"""
        import inspect
        source = inspect.getsource(display.write_ui)
        assert "parsed = data_markdown.parse_stock_info(stock_info)" in source
        assert "charts.iter_data_charts(parsed)" in source
        assert "data_markdown.render_sections(parsed.sections)" in source
        assert "st.altair_chart(chart, use_container_width=True)" in source
        # 图表渲染在表格之前(语句级顺序;旧 08-02 注释也含
        # "to_markdown_tables" 字样,不能用 find 全文定位)
        assert (source.find("for title, chart in charts.iter_data_charts(parsed)")
                < source.find("st.markdown(data_markdown.render_sections"))


class TestDisplayConditionalTabs():
    """08-08-billions-api-integration，Step 5：报告 Tab 条件化（AC1/AC3）。

    report_tabs() 开关矩阵：ANALYST 开 → 含 information_analysis（第 4 位
    专家报告，技术指标分析之后）；关（无 key / 能力闸）→ 与既有六 Tab
    逐字节一致。事件循环守卫（未知 key 不抛）为源码断言（Streamlit
    副作用不 mock，house style 同 TestDisplayChartWiring）。
    """

    def test_analyst_off_tabs_match_base(self):
        """无 key 与 ANALYST 能力闸关 → 六 Tab 与今日一致（AC1/AC3）。"""
        def check():
            keys = [k for k, _ in display.report_tabs()]
            assert keys == [
                "fundamental_analysis", "trend_analysis",
                "technical_indicator_analysis",
                "bullish_opinions", "bearish_opinions", "final_decision",
            ]
            assert "information_analysis" not in dict(display.report_tabs())

        _with_billions_env({"BILLIONS_API_KEY": None}, check)
        _with_billions_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_ANALYST_DISABLED": "1"}, check)

    def test_analyst_on_includes_information_analysis(self):
        """ANALYST 开 → 追加「信息面分析」（技术指标分析之后，四专家相邻）。"""
        def check():
            tabs = display.report_tabs()
            keys = [k for k, _ in tabs]
            assert "information_analysis" in keys
            assert dict(tabs)["information_analysis"] == "信息面分析"
            assert (keys.index("information_analysis")
                    == keys.index("technical_indicator_analysis") + 1)

        _with_billions_env({"BILLIONS_API_KEY": "k"}, check)

    def test_iter_report_items_maps_new_key_when_on(self):
        """ANALYST 开 → iter_report_items 映射 information_analysis（渲染
        dispatch 的纯函数侧契约）。"""
        items = _with_billions_env({"BILLIONS_API_KEY": "k"}, lambda: list(
            display.iter_report_items({"information_analysis": "信息面报告"})))
        assert items == [("information_analysis", "信息面分析", "信息面报告")]

    def test_iter_report_items_skips_new_key_when_off(self):
        """ANALYST 关 → information_analysis 不在 dispatch 列表（update 含
        该 key 也不产出渲染项——图侧同样不注册，双保险）。"""
        items = _with_billions_env({"BILLIONS_API_KEY": None}, lambda: list(
            display.iter_report_items({"information_analysis": "信息面报告"})))
        assert items == []

    def test_guard_unknown_report_key_skips_not_crashes(self):
        """事件循环守卫（check 硬性建议）：报告 key 无对应 Tab → continue
        跳过渲染，防 KeyError 中止整个分析。守卫在 write_ui 事件循环内
        （Streamlit 副作用不 mock——源码断言，同 TestDisplayDataTab 风格）。"""
        import inspect
        source = inspect.getsource(display.write_ui)
        assert "if key not in report_tabs_map:" in source
        assert "continue" in source.split("if key not in report_tabs_map:")[1]
        # 渲染必须经映射容器（守卫后取容器，天然防 KeyError）
        assert "with report_tabs_map[key]:" in source


class TestDisplaySettingsCollectors():
    """08-08-billions-switches-ui，Step 3：设置面板纯函数（收集器）。

    会话区收集（→ set_runtime_overrides）与持久化区收集（→ update_env_file）
    是提交/保存路径的纯逻辑——离线喂合成 session_state 快照断言键名与值
    （Streamlit 副作用不 mock，house style）。
    """

    def test_collect_session_overrides_full_state(self):
        """8 开关 + 3 上限 → 覆盖层键表（runtime_config 键名逐一对齐）。"""
        state = {
            "settings_tdx_mcp": True,
            "settings_web_search": False,
            "settings_billions_master": True,
            "settings_billions_findb": False,
            "settings_billions_search": True,
            "settings_billions_twitter": False,
            "settings_billions_fetch": True,
            "settings_billions_analyst": False,
            "settings_billions_search_max": 5,
            "settings_billions_twitter_max": 1,
            "settings_billions_fetch_max": 7,
        }
        assert display._collect_session_overrides(state) == {
            "TDX_MCP_ENABLED": True,
            "WEB_SEARCH_ENABLED": False,
            "BILLIONS_MASTER": True,
            "BILLIONS_FINDB": False,
            "BILLIONS_SEARCH": True,
            "BILLIONS_TWITTER": False,
            "BILLIONS_FETCH": True,
            "BILLIONS_ANALYST": False,
            "BILLIONS_SEARCH_MAX_CALLS": 5,
            "BILLIONS_TWITTER_MAX_CALLS": 1,
            "BILLIONS_FETCH_MAX_CALLS": 7,
        }

    def test_collect_session_overrides_number_float_normalized(self):
        """number_input 可能返回 float → int 归一（bool 透传为 bool 非 0/1）。"""
        state = {k: False for k in (
            "settings_tdx_mcp", "settings_web_search", "settings_billions_master",
            "settings_billions_findb", "settings_billions_search",
            "settings_billions_twitter", "settings_billions_fetch",
            "settings_billions_analyst")}
        state.update({
            "settings_billions_search_max": 3.0,
            "settings_billions_twitter_max": 2.0,
            "settings_billions_fetch_max": 3.0,
        })
        overrides = display._collect_session_overrides(state)
        assert overrides["BILLIONS_SEARCH_MAX_CALLS"] == 3
        assert isinstance(overrides["BILLIONS_SEARCH_MAX_CALLS"], int)
        assert overrides["TDX_MCP_ENABLED"] is False

    def test_collect_persisted_updates_password_empty_means_unchanged(self):
        """密码框空 = 不修改：不收集密钥键（.env 现值保留）——「未修改」
        与「清空」可区分，且 env_file 校验禁止空密钥。"""
        state = {
            "settings_model": "deepseek-v4-pro",
            "settings_deepseek_key": "",
            "settings_dashscope_key": "",
            "settings_tdx_key": "",
            "settings_billions_key": "",
            "settings_langsmith_key": "",
            "settings_langsmith_tracing": True,
            "settings_langsmith_project": "soa-proj",
        }
        assert display._collect_persisted_updates(state) == {
            "DEEPSEEK_MODEL": "deepseek-v4-pro",
            "LANGSMITH_TRACING": "true",
            "LANGSMITH_PROJECT": "soa-proj",
        }

    def test_collect_persisted_updates_password_filled_updates_key(self):
        """非空密码框 = 更新对应密钥；未填的不收集；TRACING 布尔化 false。"""
        state = {
            "settings_model": "deepseek-v4-flash",
            "settings_deepseek_key": "sk-new",
            "settings_billions_key": "bk-new",
            "settings_langsmith_tracing": False,
            "settings_langsmith_project": "",
        }
        updates = display._collect_persisted_updates(state)
        assert updates["DEEPSEEK_API_KEY"] == "sk-new"
        assert updates["BILLIONS_API_KEY"] == "bk-new"
        assert "DASHSCOPE_API_KEY" not in updates
        assert "TDX_API_KEY" not in updates
        assert updates["LANGSMITH_TRACING"] == "false"
        assert updates["LANGSMITH_PROJECT"] == ""

    def test_collect_persisted_updates_model_default_when_missing(self):
        """widget 未渲染（防御）→ 模型回退默认 flash（与代码库默认一致）。"""
        updates = display._collect_persisted_updates({})
        assert updates["DEEPSEEK_MODEL"] == "deepseek-v4-flash"

    def test_save_settings_passes_updates_to_env_file(self, monkeypatch):
        """_save_settings 收集持久化字段并透传给 update_env_file（参数断言）。"""
        captured = {}

        def fake_update_env_file(updates, env_path=None):
            captured["updates"] = updates
            return True, ""

        monkeypatch.setattr(display, "update_env_file", fake_update_env_file)
        state = {
            "settings_model": "deepseek-v4-pro",
            "settings_deepseek_key": "sk-new",
            "settings_langsmith_tracing": True,
            "settings_langsmith_project": "p",
        }
        ok, message = display._save_settings(state)
        assert (ok, message) == (True, "")
        assert captured["updates"]["DEEPSEEK_API_KEY"] == "sk-new"
        assert captured["updates"]["DEEPSEEK_MODEL"] == "deepseek-v4-pro"

    def test_save_settings_failure_message_forwarded(self, monkeypatch):
        """update_env_file 失败 → (False, 错误消息) 原样返回（UI st.error 用）。"""
        def fake_update_env_file(updates, env_path=None):
            return False, "写入 .env 失败：测试注入"

        monkeypatch.setattr(display, "update_env_file", fake_update_env_file)
        ok, message = display._save_settings(
            {"settings_model": "deepseek-v4-flash"})
        assert ok is False
        assert "写入 .env 失败" in message


class TestDisplayPanelEnablements():
    """08-08-billions-switches-ui，Step 3：亿信面板置灰决策（纯函数）。

    无 BILLIONS_API_KEY 或总闸关 → 5 个能力 toggle 置灰（AC3 两态）。
    """

    def test_no_key_greys_capabilities(self):
        assert _with_billions_env(
            {"BILLIONS_API_KEY": None},
            lambda: display._panel_enablements(True)) == {
            "has_billions_key": False, "capabilities_greyed": True}

    def test_key_and_master_on_enables_capabilities(self):
        assert _with_billions_env(
            {"BILLIONS_API_KEY": "k"},
            lambda: display._panel_enablements(True)) == {
            "has_billions_key": True, "capabilities_greyed": False}

    def test_master_off_greys_capabilities(self):
        assert _with_billions_env(
            {"BILLIONS_API_KEY": "k"},
            lambda: display._panel_enablements(False)) == {
            "has_billions_key": True, "capabilities_greyed": True}


class TestDisplaySettingsPanelWiring():
    """08-08-billions-switches-ui，Step 3：面板接线（源码断言，house style
    同 TestDisplayChartWiring——Streamlit 副作用不 mock）。"""

    def test_panel_renders_before_deepseek_key_check(self):
        """面板在 _has_deepseek_key 门控**之前**渲染——无 key 用户靠面板
        录入密钥（保存即 os.environ 同步，同次 run 门控即通过，无需重启）。"""
        import inspect
        source = inspect.getsource(display.write_ui)
        assert source.find("_write_settings_panel()") < source.find("if not _has_deepseek_key():")

    def test_submit_syncs_overrides_before_build_stock_information(self):
        """会话级覆盖同步在 enrichment（build_stock_information）之前——
        三处消费点（TDX MCP 调用时 / 联网搜索与亿信装配时）随即读到覆盖值。"""
        import inspect
        source = inspect.getsource(display.write_ui)
        assert "set_runtime_overrides(_collect_session_overrides(st.session_state))" in source
        assert (source.find("set_runtime_overrides(")
                < source.find("build_stock_information("))

    def test_password_inputs_hidden_and_save_wired(self):
        """密钥输入框 type="password"（R6 不明文回显）——4 个密钥框 +
        LangSmith key 共 5 处；保存按钮 → 成功/失败提示。"""
        import inspect
        source = inspect.getsource(display._write_settings_panel)
        assert source.count('type="password"') == 5
        assert "settings_save" in source
        assert "st.success(" in source
        assert "st.error(" in source
        # 置灰决策接线：能力 toggle 的 disabled 来自 _panel_enablements
        assert "disabled=enablements[\"capabilities_greyed\"]" in source
