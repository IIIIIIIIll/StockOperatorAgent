import datetime

from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from core.llms.prompt import system_prompt, investment_manager_message
from core.llms.retry import invoke_with_retry
from core.llms.progress import safe_progress
from utils.time_helper import get_last_business_day
from loguru import logger


class InvestmentManager:

    def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater = None):
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])

        self.prompt = self.prompt.partial(system_message=investment_manager_message)
        current_date = get_last_business_day(datetime.date.today())
        self.prompt = self.prompt.partial(current_date=current_date)
        self.llm = self.prompt | llm
        self.config = config
        self.progress_updater = progress_updater


    def investment_manager(self, state: State):
        # bullish_opinions / bearish_opinions 经 add_messages reducer 包装为
        # 消息列表（agent 返回字符串被包装）——取 [-1].content 为观点正文，
        # 不插值 [HumanMessage(...)] 列表 repr（修复：原 {state[...]} 插值
        # 的是列表元数据而非观点内容）
        bullish_opinion = state['bullish_opinions'][-1].content
        bearish_opinion = state['bearish_opinions'][-1].content
        investment_manager_query = f"""
        现在请基于以下信息，给出你对股票代码{state['target_stock_ticker']}的最终投资建议：
        基本面报告: \n
        {state['fundamental_analysis']}
        \n
        趋势报告: \n
        {state['trend_analysis']}
        \n
        多头观点: \n
        {bullish_opinion}
        \n
        空头观点: \n
        {bearish_opinion}
        \n
        """
        query = [("human", investment_manager_query)]
        logger.debug("Investment Manager Query: {}", investment_manager_query)
        safe_progress(self.progress_updater, "开始最终投资建议生成。。。")
        response = invoke_with_retry(self.llm, {"query": query}, config=self.config)
        safe_progress(self.progress_updater, "最终投资建议生成完成。。。")
        logger.debug("Investment Manager Response: {}", response.content)
        return {"messages": [query[0], response], "final_decision": response.content}
