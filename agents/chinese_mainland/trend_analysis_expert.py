import datetime

from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from core.llms.prompt import system_prompt, trend_analysis_expert_message
from utils.time_helper import get_last_business_day
from loguru import logger

class TrendAnalysisExpert:

    def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater = None):
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])

        self.prompt = self.prompt.partial(system_message=trend_analysis_expert_message)
        current_date = get_last_business_day(datetime.date.today())
        self.prompt = self.prompt.partial(current_date=current_date)
        self.llm = self.prompt | llm
        self.config = config
        self.progress_updater = progress_updater


    def trend_analysis_expert(self, state: State):
        trend_analysis_expert_query = f"""
        请基于以下真实数据给出你对股票代码{state['target_stock_ticker']}的趋势分析\n
        {state['stock_information']}
        """
        query = [("human", trend_analysis_expert_query)]
        logger.debug("Fundamental Analysis Expert Query: {}", trend_analysis_expert_query)
        if self.progress_updater is not None:
            self.progress_updater.info("开始趋势分析报告生成。。。")
        response = self.llm.invoke({"query" : query}, config=self.config)
        if self.progress_updater is not None:
            self.progress_updater.info("开始趋势分析报告生成。。。")
        logger.debug("Fundamental Analysis Expert Response: {}", response.content)
        return {"messages": [query[0], response], "trend_analysis": response.content}