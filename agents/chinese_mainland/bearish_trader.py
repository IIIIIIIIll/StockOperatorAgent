import datetime

from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from core.llms.prompt import system_prompt, bearish_trader_message
from utils.time_helper import get_last_business_day
from loguru import logger


class BearishTrader:

    def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater = None):
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])

        self.prompt = self.prompt.partial(system_message=bearish_trader_message)
        current_date = get_last_business_day(datetime.date.today())
        self.prompt = self.prompt.partial(current_date=current_date)
        self.llm = self.prompt | llm
        self.config = config
        self.progress_updater = progress_updater


    def bearish_trader(self, state: State):
        bearish_trader_query = f"""
        现在请基于以下信息，给出你对股票代码${state['target_stock_ticker']}的看法：
        基本面报告: \n
        ${state['fundamental_analysis']}
        \n
        趋势报告: \n
        ${state['trend_analysis']}
        \n
        """
        query = [("human", bearish_trader_query)]
        logger.debug("Bearish Trader Query: {}", bearish_trader_query)
        if self.progress_updater is not None:
            self.progress_updater.info("开始空方观点生成。。。")
        response = self.llm.invoke({"query" : query}, config=self.config)
        if self.progress_updater is not None:
            self.progress_updater.info("空方观点生成完成。。。")
        logger.debug("Bearish Trader Response: {}", response.content)
        return {"messages": [query[0], response], "bearish_opinions": response.content}