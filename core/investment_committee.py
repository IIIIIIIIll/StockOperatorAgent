from dotenv import load_dotenv
from langchain_core.runnables import RunnableConfig
from utils.state import State

from agents.chinese_mainland.fundamental_analysis_expert import FundamentalAnalysisExpert
from agents.chinese_mainland.trend_analysis_expert import TrendAnalysisExpert
from agents.chinese_mainland.bullish_trader import BullishTrader
from agents.chinese_mainland.bearish_trader import BearishTrader
from agents.chinese_mainland.investment_manager import InvestmentManager

from langgraph.graph import StateGraph, START, END
from core.llms.deepseek.deepseek_api import DeepSeekApi
from core.llms.tools.get_company_info import get_stock_info
from langgraph.checkpoint.memory import InMemorySaver
from loguru import logger


def build_stock_information(target_ticker: str) -> str:
    """图前 enrichment：个股信息 + 技术指标 + TDX 实时情报拼接成 stock_information。

    唯一组装点（display 与 make_investment_decision 共用）：get_stock_info
    （stock 缺失 raise，唯一 raise 点）→ get_trend_indicators（无行情数据
    降级占位文本）→ get_market_intel（无 TDX_API_KEY / 查询失败降级占位
    文本）。工具在函数内 import——避免无 key / 无行情数据环境的模块级副作用。
    """
    from core.llms.tools.get_market_intel import get_market_intel
    from core.llms.tools.get_trend_indicators import get_trend_indicators

    stock_information = get_stock_info(target_ticker)
    stock_information += "\n" + get_trend_indicators(target_ticker)
    stock_information += "\n" + get_market_intel(target_ticker)
    return stock_information


class InvestmentCommittee:

    def make_investment_committee(self, config: RunnableConfig, progress_updater = None, _llm = None):
        """装配 5 节点图（review #4：两对并行 + 隐式 join，见 agents spec）。

        _llm：测试注入点（house style 无 mock 框架）——默认 DeepSeekApi()；
        离线图测试传 FakeListChatModel 等假 LLM 验证图形状/join 语义。
        """
        load_dotenv()

        graph_builder = StateGraph(State)

        llm = _llm or DeepSeekApi()

        checkpointer = InMemorySaver()

        fundamental_expert = FundamentalAnalysisExpert(llm, config, progress_updater)
        graph_builder.add_node("fundamental_analysis_expert", fundamental_expert.fundamental_analysis_expert)

        trend_expert = TrendAnalysisExpert(llm, config, progress_updater)
        graph_builder.add_node("trend_analysis_expert", trend_expert.trend_analysis_expert)

        bullish_trader = BullishTrader(llm, config, progress_updater)
        graph_builder.add_node("bullish_trader", bullish_trader.bullish_trader)

        bearish_trader = BearishTrader(llm, config, progress_updater)
        graph_builder.add_node("bearish_trader", bearish_trader.bearish_trader)

        investment_manager = InvestmentManager(llm, config, progress_updater)
        graph_builder.add_node("investment_manager", investment_manager.investment_manager)

        # 两对并行（review #4）：fundamental∥trend（只依赖 stock_information）、
        # bullish∥bearish（只依赖两份报告）——LangGraph 多入边隐式 join：
        # trader 等两上游都完成、manager 等两份观点都完成。墙钟 5 串行 → 3 阶段。
        graph_builder.add_edge(START, "fundamental_analysis_expert")
        graph_builder.add_edge(START, "trend_analysis_expert")
        graph_builder.add_edge("fundamental_analysis_expert", "bullish_trader")
        graph_builder.add_edge("trend_analysis_expert", "bullish_trader")
        graph_builder.add_edge("fundamental_analysis_expert", "bearish_trader")
        graph_builder.add_edge("trend_analysis_expert", "bearish_trader")
        graph_builder.add_edge("bullish_trader", "investment_manager")
        graph_builder.add_edge("bearish_trader", "investment_manager")
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