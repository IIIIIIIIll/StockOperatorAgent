from dotenv import load_dotenv
from langchain_core.runnables import RunnableConfig
from utils.state import State

from agents.chinese_mainland.fundamental_analysis_expert import FundamentalAnalysisExpert
from agents.chinese_mainland.trend_analysis_expert import TrendAnalysisExpert
from agents.chinese_mainland.bullish_trader import BullishTrader
from agents.chinese_mainland.bearish_trader import BearishTrader
from agents.chinese_mainland.investment_manager import InvestmentManager

from langgraph.graph import StateGraph, START, END
from core.llms.qwen.qwen_api import QwenApi
from core.llms.tools.get_company_info import get_stock_info
from langgraph.checkpoint.memory import InMemorySaver
from loguru import logger

class InvestmentCommittee:

    def make_investment_committee(self, config: RunnableConfig, progress_updater = None):
        load_dotenv()

        graph_builder = StateGraph(State)

        llm = QwenApi()

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

        graph_builder.add_edge(START, "fundamental_analysis_expert")
        graph_builder.add_edge("fundamental_analysis_expert", "trend_analysis_expert")
        graph_builder.add_edge("trend_analysis_expert", "bullish_trader")
        graph_builder.add_edge("bullish_trader", "bearish_trader")
        graph_builder.add_edge("bearish_trader", "investment_manager")
        graph_builder.add_edge("investment_manager", END)

        committee = graph_builder.compile(checkpointer=checkpointer)

        return committee

    def make_investment_decision(self, target_ticker: str):
        config: RunnableConfig = {"configurable": {"thread_id": "1"}}
        committee = self.make_investment_committee(config)

        responses = committee.stream({"messages": [{"role": "user", "content": f"请帮我分析一下 {target_ticker}"}],
                 "target_stock_ticker": target_ticker,
                 "stock_information": get_stock_info(target_ticker)
                 }, config=config)

        return responses