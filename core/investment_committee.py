from dotenv import load_dotenv
from langchain_core.runnables import RunnableConfig
from utils.state import State

from langgraph.graph import StateGraph, START, END
from core.llms.deepseek.deepseek_api import DeepSeekApi
from core.role_registry import (
    END_MARKER,
    START_MARKER,
    build_edges,
    enabled_roles,
)
from core.llms.tools.get_company_info import get_stock_info
from core.llms.tools.web_search import make_web_search_tool, web_search_enabled
from core.llms.tools.billions_search import make_billions_search_tool
from core.llms.tools.billions_twitter import make_billions_twitter_tool
from core.llms.tools.billions_fetch import make_billions_fetch_tool
from utils.billions_config import billions_enabled
from langgraph.checkpoint.memory import InMemorySaver
from loguru import logger


def build_stock_information(target_ticker: str, progress=None, _billions_intel=None) -> str:
    """图前 enrichment：个股信息 + 技术指标 + 财务指标 + TDX 实时情报 + 亿信
    fin-db（条件段，08-08-billions-api-integration）拼接。

    唯一组装点（display 与 make_investment_decision 共用）：get_stock_info
    （stock 缺失 raise，唯一 raise 点）→ get_trend_indicators（无行情数据
    降级占位文本）→ get_financial_indicators（无 raw 缓存降级占位文本，
    08-02-f10-financial-indicator-sections）→ get_market_intel（无
    TDX_API_KEY / 查询失败降级占位文本）→ get_billions_financial_intel
    （R3：开关开时追加第 5 段；开关关返回空串 → 该段自然不出现，现有
    流程零行为变化）。工具在函数内 import——避免无 key / 无行情数据
    环境的模块级副作用。

    progress（review #9，2026-08-02）：可选回调 progress(str)——五个工具
    调用之间输出进度（display 传 updatable_container.info 包装；缺省 None
    不输出，无 UI 上下文路径不受影响）。亿信段进度仅在该能力开关开启时
    输出（开关关 → 不闪"正在获取亿信问数"的无效提示，零行为变化）。

    _billions_intel（08-08-billions-api-integration，Step 2）：测试注入点
    （house style 无 mock 框架）——可调用 `_billions_intel(ticker) -> str`
    （get_billions_financial_intel 形状，返回空串 = 该段不出现）；缺省
    None → 内部懒加载真实现。
    """
    from core.llms.tools.get_financial_indicators import get_financial_indicators
    from core.llms.tools.get_market_intel import get_market_intel
    from core.llms.tools.get_trend_indicators import get_trend_indicators
    from utils.billions_config import billions_enabled

    if progress is not None:
        progress(f"正在获取 {target_ticker} 的个股信息与财务数据...")
    stock_information = get_stock_info(target_ticker)
    if progress is not None:
        progress(f"正在计算 {target_ticker} 的技术指标...")
    stock_information += "\n" + get_trend_indicators(target_ticker)
    if progress is not None:
        progress(f"正在获取 {target_ticker} 的财务指标...")
    stock_information += "\n" + get_financial_indicators(target_ticker)
    if progress is not None:
        progress(f"正在获取 {target_ticker} 的实时市场情报...")
    stock_information += "\n" + get_market_intel(target_ticker)
    if _billions_intel is None:
        # 懒加载（开关关时该模块甚至不被导入——零行为变化）
        from core.llms.tools.billions_fin_db import get_billions_financial_intel

        _billions_intel = get_billions_financial_intel
    if progress is not None and billions_enabled("FINDB"):
        # fin_db 慢调用（客户端超时 120s）——进度提示避免 UI 长时间静默；
        # 开关关时亿信段为空串，不输出无效进度（零行为变化）
        progress(f"正在获取 {target_ticker} 的亿信金融问数...")
    billions_text = _billions_intel(target_ticker)
    if billions_text:
        stock_information += "\n" + billions_text
    return stock_information


class InvestmentCommittee:

    def make_investment_committee(self, config: RunnableConfig, progress_updater = None, _llm = None):
        """装配图（08-09-role-registry：注册表驱动——节点/边由 ROLES
        生成，固定 4 阶段形状：START → 专家∥ → 多空交易员（N 入边
        join）→ 对抗修订（双入边 join）→ 经理 → END；行为与手写接线
        逐字节一致，集成测试钉死）。

        信息面分析师为**条件接线**（08-08-billions-api-integration，
        Step 4）：启用谓词在注册表单点定义（ANALYST 开且 SEARCH 或
        TWITTER 至少一者开）——谓词开 → 注册第 4 位专家节点（与三专家
        并行，多空交易员变 4 入边 join）；否则完全不注册——图结构与
        工具绑定与现状逐字节一致（零行为变化，AC1 由构造保证）。Out
        of Scope 组合（ANALYST 开但 SEARCH/TWITTER 均关）视为分析师
        不可用不产出。

        _llm：测试注入点（house style 无 mock 框架）——默认 DeepSeekApi()；
        离线图测试传 FakeListChatModel 等假 LLM 验证图形状/join 语义。
        """
        load_dotenv()

        graph_builder = StateGraph(State)

        llm = _llm or DeepSeekApi()

        checkpointer = InMemorySaver()

        # 联网搜索（08-03-websearch-tool-calling）：图装配时判定开关——
        # WEB_SEARCH_DISABLED 设置时不绑定 web_search（行为与现状逐字节
        # 一致，AC3 由构造保证）；开关语义见 web_search_enabled()
        tools = [make_web_search_tool()] if web_search_enabled() else []

        # 亿信检索工具三件套（08-08-billions-api-integration，Step 3）：
        # 按能力开关追加——未配置 BILLIONS_API_KEY 时各工厂返回 None
        # （不绑定，AC1 现有流程零变化）；能力级开关关 → 对应工厂 None
        # （AC3）；与 web_search 并列绑定，共用 tool_loop 轮数上限与
        # 每 run 计数上限（R2/R4，开关判定发生在图装配时）
        billions_tools = [
            make_billions_search_tool(),
            make_billions_twitter_tool(),
            make_billions_fetch_tool(),
        ]
        tools = tools + [t for t in billions_tools if t is not None]
        if not tools:
            tools = None

        # 注册表驱动装配（08-09-role-registry）：谓词装配时求值一次，
        # 节点/边共用同一启用集合——4 份 if 条件块与手写边表删除
        roles = enabled_roles()
        experts = [r for r in roles if r.kind == "expert"]
        traders = [r for r in roles if r.kind == "trader"]

        # 专家∥（只依赖 stock_information）——直调无工具
        for r in experts:
            instance = r.factory(llm, config, progress_updater, None)
            graph_builder.add_node(r.node_name, getattr(instance, r.resolved_method))

        # 多空交易员∥（N 入边 join 全部专家报告）——bind_tools 工具角色
        trader_instances = {}
        for r in traders:
            instance = r.factory(llm, config, progress_updater, tools)
            trader_instances[r.node_name] = instance
            graph_builder.add_node(r.node_name, getattr(instance, r.resolved_method))

        # 对抗修订轮（08-04-adversarial-verdict-loop）：同一 trader 实例的
        # 第二个节点方法——各看对方初稿与自己初稿，修订一版追加写原
        # opinions key（State 零新 key）
        for r in traders:
            instance = trader_instances[r.node_name]
            graph_builder.add_node(
                r.revise_node_name, getattr(instance, r.revise_method))

        # 经理（唯一，收尾）：两份修订版双入边 join 后产出最终结论——
        # 工具角色（bind_tools）
        manager_role = next(r for r in roles if r.kind == "manager")
        manager_instance = manager_role.factory(llm, config, progress_updater, tools)
        graph_builder.add_node(
            manager_role.node_name,
            getattr(manager_instance, manager_role.resolved_method))

        # 边表由注册表导出（build_edges 纯函数，单测钉死两形态边集）：
        # START → 专家；专家 → 交易员（隐式 join）；交易员 → 双方 revise
        # （双入边 join）；revise → 经理；经理 → END
        for src, dst in build_edges(roles):
            graph_builder.add_edge(
                START if src == START_MARKER else src,
                END if dst == END_MARKER else dst,
            )

        committee = graph_builder.compile(checkpointer=checkpointer)

        return committee

    def make_investment_decision(self, target_ticker: str):
        config: RunnableConfig = {"configurable": {"thread_id": "1"}}
        committee = self.make_investment_committee(config)

        # 与 display 共用 build_stock_information（图前 enrichment 唯一组装点）
        stock_information = build_stock_information(target_ticker)

        responses = committee.stream({"messages": [{"role": "user", "content": f"请帮我分析一下 {target_ticker}"}],
                 "target_stock_ticker": target_ticker,
                 "stock_information": stock_information
                 }, config=config)

        return responses