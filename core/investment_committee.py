from dotenv import load_dotenv
from langchain_core.runnables import RunnableConfig
from utils.state import State

from agents.chinese_mainland.fundamental_analysis_expert import FundamentalAnalysisExpert
from agents.chinese_mainland.trend_analysis_expert import TrendAnalysisExpert
from agents.chinese_mainland.technical_indicator_analyst import TechnicalIndicatorAnalyst
from agents.chinese_mainland.bullish_trader import BullishTrader
from agents.chinese_mainland.bearish_trader import BearishTrader
from agents.chinese_mainland.investment_manager import InvestmentManager

from langgraph.graph import StateGraph, START, END
from core.llms.deepseek.deepseek_api import DeepSeekApi
from core.llms.tools.get_company_info import get_stock_info
from core.llms.tools.web_search import make_web_search_tool, web_search_enabled
from langgraph.checkpoint.memory import InMemorySaver
from loguru import logger


def build_stock_information(target_ticker: str, progress=None) -> str:
    """图前 enrichment：个股信息 + 技术指标 + 财务指标 + TDX 实时情报拼接。

    唯一组装点（display 与 make_investment_decision 共用）：get_stock_info
    （stock 缺失 raise，唯一 raise 点）→ get_trend_indicators（无行情数据
    降级占位文本）→ get_financial_indicators（无 raw 缓存降级占位文本，
    08-02-f10-financial-indicator-sections）→ get_market_intel（无
    TDX_API_KEY / 查询失败降级占位文本）。工具在函数内 import——避免无
    key / 无行情数据环境的模块级副作用。

    progress（review #9，2026-08-02）：可选回调 progress(str)——四个工具
    调用之间输出进度（display 传 updatable_container.info 包装；缺省 None
    不输出，无 UI 上下文路径不受影响）。
    """
    from core.llms.tools.get_financial_indicators import get_financial_indicators
    from core.llms.tools.get_market_intel import get_market_intel
    from core.llms.tools.get_trend_indicators import get_trend_indicators

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
    return stock_information


class InvestmentCommittee:

    def make_investment_committee(self, config: RunnableConfig, progress_updater = None, _llm = None):
        """装配 8 节点图（review #4：三对并行 + 隐式 join；08-04-adversarial-
        verdict-loop：+2 revise 节点；08-08-technical-indicator-analyst：
        +1 技术指标分析师，见 agents spec）。

        _llm：测试注入点（house style 无 mock 框架）——默认 DeepSeekApi()；
        离线图测试传 FakeListChatModel 等假 LLM 验证图形状/join 语义。
        """
        load_dotenv()

        graph_builder = StateGraph(State)

        llm = _llm or DeepSeekApi()

        checkpointer = InMemorySaver()

        # 联网搜索（08-03-websearch-tool-calling）：图装配时判定开关——
        # WEB_SEARCH_DISABLED 设置时 tools=None（不绑定，行为与现状
        # 逐字节一致，AC3 由构造保证）；开关语义见 web_search_enabled()
        tools = [make_web_search_tool()] if web_search_enabled() else None

        fundamental_expert = FundamentalAnalysisExpert(llm, config, progress_updater)
        graph_builder.add_node("fundamental_analysis_expert", fundamental_expert.fundamental_analysis_expert)

        trend_expert = TrendAnalysisExpert(llm, config, progress_updater)
        graph_builder.add_node("trend_analysis_expert", trend_expert.trend_analysis_expert)

        # 技术指标分析师（08-08-technical-indicator-analyst）：第三位专家，
        # 与 fundamental/trend 并行（同属第一梯队，只依赖 stock_information）
        indicator_analyst = TechnicalIndicatorAnalyst(llm, config, progress_updater)
        graph_builder.add_node("technical_indicator_analyst", indicator_analyst.technical_indicator_analyst)

        bullish_trader = BullishTrader(llm, config, progress_updater, tools)
        graph_builder.add_node("bullish_trader", bullish_trader.bullish_trader)

        bearish_trader = BearishTrader(llm, config, progress_updater, tools)
        graph_builder.add_node("bearish_trader", bearish_trader.bearish_trader)

        investment_manager = InvestmentManager(llm, config, progress_updater, tools)
        graph_builder.add_node("investment_manager", investment_manager.investment_manager)

        # 对抗修订轮（08-04-adversarial-verdict-loop）：同一 trader 实例的
        # 第二个节点方法——bullish_revise / bearish_revise 各看对方初稿与
        # 自己初稿，修订一版追加写原 opinions key（State 零新 key）。
        graph_builder.add_node("bullish_revise", bullish_trader.bullish_revise)
        graph_builder.add_node("bearish_revise", bearish_trader.bearish_revise)

        # 三专家并行 + 两对并行（review #4 + 08-04-adversarial-verdict-loop +
        # 08-08-technical-indicator-analyst）：fundamental∥trend∥indicator
        # （只依赖 stock_information）、bullish∥bearish（只依赖三份报告）、
        # bullish_revise∥bearish_revise——LangGraph 多入边隐式 join：
        # trader 等三上游都完成、revise 双入边等两份初稿都完成（否则对方
        # 初稿缺失）、manager 等两份修订版都完成。墙钟 8 串行 → 4 阶段。
        graph_builder.add_edge(START, "fundamental_analysis_expert")
        graph_builder.add_edge(START, "trend_analysis_expert")
        graph_builder.add_edge(START, "technical_indicator_analyst")
        graph_builder.add_edge("fundamental_analysis_expert", "bullish_trader")
        graph_builder.add_edge("trend_analysis_expert", "bullish_trader")
        graph_builder.add_edge("technical_indicator_analyst", "bullish_trader")
        graph_builder.add_edge("fundamental_analysis_expert", "bearish_trader")
        graph_builder.add_edge("trend_analysis_expert", "bearish_trader")
        graph_builder.add_edge("technical_indicator_analyst", "bearish_trader")
        graph_builder.add_edge("bullish_trader", "bullish_revise")
        graph_builder.add_edge("bearish_trader", "bullish_revise")
        graph_builder.add_edge("bullish_trader", "bearish_revise")
        graph_builder.add_edge("bearish_trader", "bearish_revise")
        graph_builder.add_edge("bullish_revise", "investment_manager")
        graph_builder.add_edge("bearish_revise", "investment_manager")
        graph_builder.add_edge("investment_manager", END)

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