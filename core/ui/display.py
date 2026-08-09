import os
import queue
import threading

import streamlit as st
from langchain_core.runnables import RunnableConfig
from core.investment_committee import InvestmentCommittee, build_stock_information
from core.llms.progress import ProgressBridge
from core.ui import charts
from core.ui import data_markdown
from core.ui import theme
from core.role_registry import ROLES, enabled_roles
from data_source.chinese_mainland.tdx.tdx_source import is_bj_ticker
from loguru import logger
from utils.env_file import update_env_file
from utils.runtime_config import env_disabled, env_int, set_runtime_overrides

committee = InvestmentCommittee()

def _has_deepseek_key():
    """只认 DEEPSEEK_API_KEY——与 InvestmentCommittee 实现对齐。

    make_investment_committee 永远构造 DeepSeekApi()（无 key 构造即抛
    OpenAIError）；只配 DASHSCOPE_API_KEY 时旧检查放行但构造崩溃。Qwen
    已降级为可选项（默认 LLM 是 DeepSeek），UI 不再为其放行。
    """
    return "DEEPSEEK_API_KEY" in os.environ

# 采集数据 Tab 标题（08-02-ui-collected-data-display）：放 st.tabs 最前，
# 在 build_stock_information 成功后、stream 前填充 markdown 表格
# （data_markdown.to_markdown_tables，08-02-ui-data-markdown-tables）。
DATA_TAB_TITLE = "采集数据"

# 报告 state key → Tab 标题。顺序 = 注册表 ROLES 顺序（即 write_ui 里
# st.tabs 中报告 Tab 的创建顺序；数据 Tab 插入不影响相对顺序）——渲染
# dispatch 依赖该契约（08-02-ui-incremental-report-render；
# 08-09-role-registry：名册单一事实源收敛到 core/role_registry.py）。
# 开关在**调用时**求值（对齐 web_search_enabled 图装配时判定），同一
# 次 rerun 内 st.tabs 创建与渲染 dispatch 读到同一份列表。
def report_tabs():
    """报告 Tab 契约（08-09-role-registry 注册表驱动）：ANALYST 开 →
    含「信息面分析」（第 4 位专家报告，与技术指标分析相邻）；关 → 与
    既有六 Tab 完全一致（AC1/AC3）。"""
    return tuple(
        (r.state_key, r.tab_title)
        for r in enabled_roles()
        if r.state_key is not None and r.tab_title is not None
    )

# 观点 key（08-05-ui-opinion-expanders）：渲染为可折叠条目（每份观点一个
# expander）——对抗修订轮后同 key 含初稿+修订版多份内容，平铺占空间；
# 非观点 key 单份内容保持平铺。（08-09-role-registry：从注册表 opinion
# 标志派生。）
OPINION_REPORT_KEYS = frozenset(r.state_key for r in ROLES if r.opinion)


def _report_content(value):
    """State 报告值 → 展示文本（08-02-ui-incremental-report-render）。

    stream update 中报告是节点返回的原始字符串（reducer 未应用）；最终
    state 里 bullish/bearish 被 add_messages reducer 包装成消息列表
    （旧 get_state_history 渲染取 [-1].content）——两种形态都消化，
    展示语义与旧实现一致。
    """
    if isinstance(value, list) and value and hasattr(value[-1], "content"):
        return value[-1].content
    return value


def iter_report_items(update):
    """节点 update dict → (key, title, content) 渲染项；无报告 key → 空。

    纯函数，与 Streamlit 解耦：UI 循环按 key 查 Tab 容器 dispatch，离线
    测试喂合成 update 验证映射（house style，不 mock Streamlit）。
    """
    for key, title in report_tabs():
        if key in update:
            yield key, title, _report_content(update[key])


def _stream_graph_events(graph, config, inputs, events):
    """后台线程驱动 graph.stream：报告/异常/结束入队（脚本线程消费）。

    agent 侧 ProgressBridge 已把进度与节点完成报告推入同一队列（更早
    到达，节点级 1-1-1-1-1）；这里把 superstep update 的报告也入队作
    兜底（同 key 由脚本线程去重），异常与 sentinel 收尾。daemon 线程，
    会话结束随进程终止。
    """
    try:
        for responses in graph.stream(inputs, config=config):
            for value in responses.values():
                for key, _title, content in iter_report_items(value):
                    events.put(("report", key, content))
    except Exception as e:
        events.put(("error", e))
    finally:
        events.put(("done", None))


# ---- 设置面板（08-08-billions-switches-ui，Step 3）----
# 纯函数（收集器/置灰决策）与渲染（_write_settings_panel）分离：单测离线
# 喂合成 session_state 快照验证收集逻辑（house style，不 mock Streamlit）。


def _env_enabled(disabled_env_name: str) -> bool:
    """env 有效态（面板初始值）：DISABLED 语义键未设置或显式假值 → 启用。

    一行包装：负极性翻转收敛到 runtime_config.env_disabled 单点（负 env
    → 正 bool），面板渲染逻辑不动。
    """
    return not env_disabled(disabled_env_name)


def _env_billions_max_calls(capability: str, default: int) -> int:
    """env 有效调用上限（面板初始值）：BILLIONS_{CAP}_MAX_CALLS，
    非法值回退默认（env_int 收敛 env 读路径，与消费点同判定）。"""
    return env_int(f"BILLIONS_{capability.upper()}_MAX_CALLS", default)


def _panel_enablements(master_on: bool) -> dict:
    """亿信面板置灰决策（纯函数）：无 BILLIONS_API_KEY 或总闸关 →
    5 个能力 toggle 置灰（disabled）。

    :param master_on: 亿信总闸会话 toggle 现值（首帧 = env 有效态）
    :return: {"has_billions_key": bool, "capabilities_greyed": bool}
    """
    has_key = bool(os.environ.get("BILLIONS_API_KEY"))
    return {
        "has_billions_key": has_key,
        "capabilities_greyed": not (has_key and master_on),
    }


# 会话区 widget key → 覆盖层键（键表见 utils/runtime_config.py）。提交时
# 整组收集 → set_runtime_overrides（每次提交全量替换，未收集键自然回退
# env）。注：design.md 所述"6 开关"实为 8 个（TDX MCP/联网搜索/亿信总闸
# + 5 能力），以交付的覆盖层键表为准。
_SESSION_TOGGLE_WIDGETS = {
    "settings_tdx_mcp": "TDX_MCP_ENABLED",
    "settings_web_search": "WEB_SEARCH_ENABLED",
    "settings_billions_master": "BILLIONS_MASTER",
    "settings_billions_findb": "BILLIONS_FINDB",
    "settings_billions_search": "BILLIONS_SEARCH",
    "settings_billions_twitter": "BILLIONS_TWITTER",
    "settings_billions_fetch": "BILLIONS_FETCH",
    "settings_billions_analyst": "BILLIONS_ANALYST",
}

_SESSION_NUMBER_WIDGETS = {
    "settings_billions_search_max": "BILLIONS_SEARCH_MAX_CALLS",
    "settings_billions_twitter_max": "BILLIONS_TWITTER_MAX_CALLS",
    "settings_billions_fetch_max": "BILLIONS_FETCH_MAX_CALLS",
}

# 持久化区 password widget key → .env 键（UPDATE_WHITELIST 子集）。交互
# 语义：密码框每次渲染**不留值**——空 = 不修改（不收集），非空 = 更新。
_PERSISTED_PASSWORD_WIDGETS = {
    "settings_deepseek_key": "DEEPSEEK_API_KEY",
    "settings_dashscope_key": "DASHSCOPE_API_KEY",
    "settings_tdx_key": "TDX_API_KEY",
    "settings_billions_key": "BILLIONS_API_KEY",
    "settings_langsmith_key": "LANGSMITH_API_KEY",
}


def _collect_session_overrides(state: dict) -> dict:
    """会话区（能力开关 + 亿信上限）→ set_runtime_overrides 参数。

    从 session_state 快照收集 8 个开关 + 3 个上限（面板恒在表单提交前
    渲染，widget 键必存在——直接索引，缺失即接线 bug）。bool 原样透传、
    上限 int 归一（number_input 可能返回 float）。
    """
    overrides = {}
    for widget_key, override_key in _SESSION_TOGGLE_WIDGETS.items():
        overrides[override_key] = bool(state[widget_key])
    for widget_key, override_key in _SESSION_NUMBER_WIDGETS.items():
        overrides[override_key] = int(state[widget_key])
    return overrides


def _collect_persisted_updates(state: dict) -> dict:
    """持久化区（模型/密钥/LangSmith）→ update_env_file 参数。

    交互语义（design.md「面板布局」节）：密码框**每次渲染不留值**——
    空 = 未修改（不收集，.env 现值保留；且 env_file 校验禁止空密钥，
    「清空」语义不存在），非空 = 更新该密钥。selectbox/toggle/text
    恒有值 → 恒收集（保存按钮一次应用面板全部持久化字段；幂等重写
    同值无害）。LANGSMITH_TRACING 布尔化 "true"/"false"。
    """
    updates = {}
    for widget_key, env_key in _PERSISTED_PASSWORD_WIDGETS.items():
        value = state.get(widget_key, "")
        if value:
            updates[env_key] = value
    updates["DEEPSEEK_MODEL"] = state.get("settings_model", "deepseek-v4-flash")
    updates["LANGSMITH_TRACING"] = (
        "true" if state.get("settings_langsmith_tracing", False) else "false")
    updates["LANGSMITH_PROJECT"] = state.get("settings_langsmith_project", "")
    return updates


def _save_settings(state: dict) -> tuple:
    """保存持久化区：收集字段 → update_env_file（原子写 .env + 同步
    os.environ，立即生效——同次 run 内 _has_deepseek_key 门控即通过）。

    纯逻辑（不触 Streamlit）：(ok, message) 返回给渲染层提示——
    st.success/st.error 调用点在 _write_settings_panel（离线可测）。
    """
    return update_env_file(_collect_persisted_updates(state))


def _write_settings_panel():
    """侧边栏「设置」面板（08-08-billions-switches-ui，Step 3）。

    四节（design.md「面板布局」节）：
    1. 模型与密钥（持久化）——DEEPSEEK_MODEL selectbox + 4 个 password
       输入 + 保存按钮 → _save_settings → st.success/error；
    2. LangSmith（持久化）——TRACING toggle + key + project（遥测配置
       持久化例外，防重载意外重开追踪）；
    3. 能力开关（会话级）——TDX MCP / 联网搜索 / 亿信总闸 + 5 能力
       toggle，稳定 key 存 session_state（无 key/总闸关 → 能力置灰）；
    4. 亿信调用上限（会话级）——3 个 number_input（默认 env 值）。

    widget 全部用稳定 key=；会话区初始值 = env 有效状态（AC3，重载恢复
    .env）。密码框不留值（空 = 不修改），占位文案只表明已配置与否——
    不明文回显、不 log 值（R6）。
    """
    with st.sidebar.expander("设置"):
        # ---- 模型与密钥（持久化）----
        st.markdown("**模型与密钥（持久化）**")
        st.caption("保存后立即生效并写入 .env，重启保留")
        model_options = ("deepseek-v4-flash", "deepseek-v4-pro")
        current_model = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
        st.selectbox(
            "DeepSeek 模型",
            model_options,
            index=0 if current_model == "deepseek-v4-flash" else 1,
            key="settings_model",
        )
        st.text_input(
            "DeepSeek API Key",
            type="password",
            placeholder=(
                "已配置（留空表示不修改）" if "DEEPSEEK_API_KEY" in os.environ
                else "未配置（输入后保存）"),
            key="settings_deepseek_key",
        )
        st.text_input(
            "DashScope API Key（Qwen 可选）",
            type="password",
            placeholder=(
                "已配置（留空表示不修改）" if "DASHSCOPE_API_KEY" in os.environ
                else "未配置（输入后保存）"),
            key="settings_dashscope_key",
        )
        st.text_input(
            "通达信 TDX API Key（可选）",
            type="password",
            placeholder=(
                "已配置（留空表示不修改）" if "TDX_API_KEY" in os.environ
                else "未配置（输入后保存）"),
            key="settings_tdx_key",
        )
        st.text_input(
            "亿信 API Key（可选）",
            type="password",
            placeholder=(
                "已配置（留空表示不修改）" if "BILLIONS_API_KEY" in os.environ
                else "未配置（输入后保存）"),
            key="settings_billions_key",
        )

        # ---- LangSmith（持久化）----
        st.markdown("**LangSmith（持久化）**")
        st.caption("开发者遥测配置；持久化以免重载意外重开追踪")
        tracing_on = os.environ.get("LANGSMITH_TRACING", "").strip().lower() == "true"
        st.toggle("启用 LangSmith 追踪", value=tracing_on, key="settings_langsmith_tracing")
        st.text_input(
            "LangSmith API Key",
            type="password",
            placeholder="留空表示不修改",
            key="settings_langsmith_key",
        )
        st.text_input(
            "LangSmith 项目名",
            value=os.environ.get("LANGSMITH_PROJECT", ""),
            key="settings_langsmith_project",
        )
        if st.button("保存", key="settings_save"):
            ok, message = _save_settings(st.session_state)
            if ok:
                st.success("配置已保存到 .env 并立即生效")
            else:
                st.error(f"保存失败：{message}")
        st.caption("提示：保存前请先保存/关闭 IDE 中打开的 .env，避免 IDE 保存覆盖本次写入")

        # ---- 能力开关（会话级）----
        st.markdown("**能力开关（会话级）**")
        st.caption("下次分析生效；重新加载后恢复 .env 配置")
        st.toggle(
            "通达信 MCP（实时市场情报）",
            value=_env_enabled("TDX_MCP_DISABLED"),
            key="settings_tdx_mcp",
        )
        st.toggle(
            "联网搜索（DuckDuckGo）",
            value=_env_enabled("WEB_SEARCH_DISABLED"),
            key="settings_web_search",
        )
        master_on = st.toggle(
            "亿信总闸",
            value=_env_enabled("BILLIONS_DISABLED"),
            key="settings_billions_master",
        )
        enablements = _panel_enablements(master_on)
        if not enablements["has_billions_key"]:
            st.caption("未配置亿信 API Key——亿信能力不可用，能力开关置灰")
        elif enablements["capabilities_greyed"]:
            st.caption("亿信总闸已关——能力开关置灰")
        billions_caps = (
            ("金融问数（FINDB）", "FINDB", "settings_billions_findb"),
            ("搜索（SEARCH）", "SEARCH", "settings_billions_search"),
            ("社交平台（TWITTER）", "TWITTER", "settings_billions_twitter"),
            ("数据抓取（FETCH）", "FETCH", "settings_billions_fetch"),
            ("信息面分析师（ANALYST）", "ANALYST", "settings_billions_analyst"),
        )
        for label, cap, widget_key in billions_caps:
            st.toggle(
                label,
                value=_env_enabled(f"BILLIONS_{cap}_DISABLED"),
                key=widget_key,
                disabled=enablements["capabilities_greyed"],
            )

        # ---- 亿信调用上限（会话级）----
        st.markdown("**亿信调用上限（会话级）**")
        st.caption("单次分析内工具调用上限；重新加载后恢复 .env 配置")
        st.number_input(
            "亿信搜索（SEARCH）调用上限",
            min_value=0, step=1,
            value=_env_billions_max_calls("SEARCH", 3),
            key="settings_billions_search_max",
        )
        st.number_input(
            "亿信社交（TWITTER）调用上限",
            min_value=0, step=1,
            value=_env_billions_max_calls("TWITTER", 2),
            key="settings_billions_twitter_max",
        )
        st.number_input(
            "亿信抓取（FETCH）调用上限",
            min_value=0, step=1,
            value=_env_billions_max_calls("FETCH", 3),
            key="settings_billions_fetch_max",
        )


def write_ui():
    # 主题打磨(08-05-ui-dark-mode-theme):set_page_config 必须是首个 st
    # 调用(Streamlit 要求);主题样式注入用 st.html(纯样式字符串,无
    # 用户输入,无 unsafe_allow_html)——色板在 .streamlit/config.toml
    # 亮暗分表,渲染契约见 theme.py。
    st.set_page_config(page_title="超绝AI股票分析系统", page_icon="📈", layout="wide")
    st.html(f"<style>{theme.CSS}</style>")
    st.title("超绝AI股票分析系统")

    # 设置面板（08-08-billions-switches-ui，Step 3）：在 _has_deepseek_key
    # 门控**之前**渲染——无 key 用户靠面板录入密钥（保存即同步 os.environ，
    # 同次 run 内门控即通过，无需重启应用）。
    _write_settings_panel()

    if not _has_deepseek_key():
        st.error("请在环境变量或.env中设置 DEEPSEEK_API_KEY 后重启应用")
        return

    st.write("输入您想要分析的沪深京A股六位股票代码")
    with st.form(key='stock_ticker_form'):
        stock_ticker = st.text_input("股票代码", max_chars=6)
        submit_button = st.form_submit_button(label='提交')

    if submit_button:
        if not stock_ticker.isdigit() or len(stock_ticker) != 6:
            st.error("请输入有效的六位数字股票代码")
        elif is_bj_ticker(stock_ticker):
            st.error("北交所（BJ）股票暂不支持分析：TDX 数据源不覆盖 BJ 证券（无名称/无行情），请使用沪深 A 股代码")
        else:
            # 会话级覆盖同步（08-08-billions-switches-ui，Step 3）：面板会话区
            # （能力开关 + 亿信上限）在 enrichment 前整组写入运行时覆盖层——
            # TDX MCP（调用时判定）、联网搜索与亿信开关（图装配时判定）三处
            # 消费点随即读到覆盖值。持久化区不在此收集（保存按钮已落 .env +
            # os.environ）。
            set_runtime_overrides(_collect_session_overrides(st.session_state))
            status = st.container()
            updatable_container = status.empty()
            updatable_container.info("正在初始化环境，请稍候...")


            # 报告 Tab 条件化（08-08-billions-api-integration，Step 5）：
            # 标签列表 = [DATA_TAB_TITLE] + report_tabs() 标题——ANALYST 开关
            # 开 → 8 个 tab（含「信息面分析」）；关 → 7 个与今日一致（AC1）。
            # st.tabs 数量动态 → 解包 data_tab + 报告容器列表（顺序契约
            # report_tabs()，渲染 dispatch 见 report_tabs_map）。
            _report_tabs = report_tabs()
            tabs = st.tabs([DATA_TAB_TITLE] + [title for _, title in _report_tabs])
            data_tab, *report_containers = tabs

            updatable_container.info(f"正在获取 {stock_ticker} 的股票信息（含技术指标与实时情报）... 可能会需要一些时间，请耐心等待...")
            try:
                # 图前 enrichment（与 make_investment_decision 共用同一组装点）：
                # 个股信息 + 技术指标 + TDX 实时情报（无 TDX_API_KEY 时降级文本）
                # progress（review #9）：三个工具调用之间输出分步进度
                stock_info = build_stock_information(
                    stock_ticker, progress=lambda msg: updatable_container.info(msg)
                )
            except Exception as e:
                # UI 层守护（error-handling spec 允许）：数据问题（如股票缺失
                # 抛出的 Exception）不裸 traceback 红屏，中文提示 + 记录日志
                logger.exception("Failed to build stock information for {}", stock_ticker)
                st.error(f"获取 {stock_ticker} 的股票信息失败：{e}，请检查股票代码后重试")
                return
            # 采集数据 Tab（08-02-ui-collected-data-display + 08-02-ui-data-
            # markdown-tables）：enrichment 成功后、stream 前填充。stock_information
            # 是定宽文本（overview 单行 + 60 根日K + 业绩报告，行间 \n），
            # 展示端用 data_markdown.parse_stock_info **解析一次**（08-09-
            # structured-enrichment-sections：结构化边界——图表消费结构化
            # 行、表格用 render_sections(parsed.sections)，都不再接触原始
            # 文本；LLM 上下文仍传 stock_info 原样，源头文本零改动）。
            # 报告 Tab（LLM markdown）仍走 st.write。异常路径上面已 return，
            # 此处数据必可用（降级占位文本是原文一部分，照常透传展示）。
            with data_tab:
                st.header(DATA_TAB_TITLE)
                # 图表(08-06-ui-data-charts):K线/成交量/收盘价/涨跌幅/
                # 财务折线渲染在表格**之前**(2026-08-06 用户反馈"把图往前提"
                # ——图表是视觉焦点,定宽表格数据在后供精确查阅)。
                # charts.iter_data_charts(parsed) 消费结构化行,空数据 →
                # 空迭代不画图;主题亮暗适配由 st.altair_chart 默认
                # streamlit theme 处理(mark 色板见 charts.py)。
                parsed = data_markdown.parse_stock_info(stock_info)
                for title, chart in charts.iter_data_charts(parsed):
                    st.subheader(title)
                    st.altair_chart(chart, use_container_width=True)
                st.markdown(data_markdown.render_sections(parsed.sections))

            updatable_container.info(f"正在开始分析 {stock_ticker} 的股票信息... 可能会需要一些时间，请耐心等待...")

            config: RunnableConfig = {"configurable": {"thread_id": "1"}}
            # 事件队列桥（08-02-ui-live-progress-bridge）：并行节点在 LangGraph
            # 工作线程，Streamlit DeltaGenerator 只能在脚本线程 enqueue——
            # 进度/报告经 ProgressBridge 入队（线程安全），脚本线程消费后渲染。
            events: queue.Queue = queue.Queue()
            bridge = ProgressBridge(events)
            graph = committee.make_investment_committee(config, progress_updater=bridge)

            # 报告 key → Tab 容器（与 report_tabs() 顺序对应，见
            # iter_report_items；08-08-billions-api-integration，Step 5：
            # 从条件列表 zip 容器，ANALYST 开 → 含信息面分析容器）
            report_tabs_map = dict(zip(
                (key for key, _ in _report_tabs), report_containers))
            report_titles = dict(_report_tabs)

            try:
                # 图在后台线程驱动（sync stream 的 superstep 是屏障，脚本线程
                # 直接迭代会被阻塞到整个阶段完成，队列无法实时消费）；脚本线程
                # get 循环实时渲染：进度 → status 容器；报告 → 节点完成即填充
                # 对应 Tab（agent push 先到即渲染，superstep update 兜底按
                # (key, content) 去重）——1-1-1-1-1 而非 2-2-1。对抗修订轮
                # （08-04-adversarial-verdict-loop）：同 key 内容不同（初稿 →
                # 修订版）→ 追加渲染。轮次标签（08-04-ui-opinion-round-labels）：
                # counts 按 key 计数，第 1 次 header+内容，第 n（n≥2）次
                # `---` + "第 n 次观点"标签 + 内容——通用轮次计数（非"初稿/
                # 修订版"字样），未来多轮互驳每轮追加自然成为第 3、4 次观点。
                # 去重集合存 (key, content) 对——防 superstep 兜底重复推送
                # 同内容。
                threading.Thread(
                    target=_stream_graph_events,
                    args=(graph, config, {
                        "messages": [{"role": "user", "content": f"请帮我分析一下 {stock_ticker}"}],
                        "target_stock_ticker": stock_ticker,
                        "stock_information": stock_info,
                    }, events),
                    daemon=True,
                ).start()
                rendered = set()
                counts = {}
                while True:
                    kind, *payload = events.get()
                    if kind == "progress":
                        updatable_container.info(payload[0])
                    elif kind == "report":
                        key, content = payload
                        if key not in report_tabs_map:
                            # 守卫（08-08-billions-api-integration，Step 5，
                            # check 硬性建议）：报告 key 无对应 Tab（开关竞态/
                            # 未来新 key）→ 跳过不渲染，防 KeyError 中止整个
                            # 分析。rendered 不记录——未知 key 不进入去重集。
                            logger.warning("报告 key {} 无对应 Tab，跳过渲染", key)
                            continue
                        if (key, content) in rendered:
                            continue
                        rendered.add((key, content))
                        with report_tabs_map[key]:
                            n = counts.get(key, 0) + 1
                            counts[key] = n
                            if n == 1:
                                st.header(report_titles[key])
                            if key in OPINION_REPORT_KEYS:
                                # 观点 tab：每份观点一个可折叠条目——第 1 次
                                # 默认展开（用户先见初稿），后续默认折叠
                                # （修订版可点击展开，不占空间）
                                with st.expander(f"第 {n} 次观点", expanded=(n == 1)):
                                    st.write(content)
                            else:
                                st.write(content)
                    elif kind == "error":
                        raise payload[0]
                    elif kind == "done":
                        break
            except Exception as e:
                # LLM 调用失败（API key 失效/网络/限流）→ 中文提示，不裸 traceback
                logger.exception("Agent graph streaming failed for {}", stock_ticker)
                st.error(f"分析 {stock_ticker} 的过程中出错：{e}，请稍后重试或检查 LLM 配置")
                return


