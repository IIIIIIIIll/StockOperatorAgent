import datetime

from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from core.llms.prompt import system_prompt, trend_analysis_expert_message
from utils.time_helper import get_last_business_day


class TrendAnalysisExpert:

    def __init__(self, llm: BaseChatModel, config: RunnableConfig):
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])

        self.prompt = self.prompt.partial(system_message=trend_analysis_expert_message)
        current_date = get_last_business_day(datetime.date.today())
        self.prompt = self.prompt.partial(current_date=current_date)
        self.llm = self.prompt | llm
        self.config = config


    def trend_analysis_expert(self, state: State):
        trend_analysis_expert_query = f"""
        请基于以下真实数据给出你对股票代码{state['target_stock_ticker']}的趋势分析\n
        {state['stock_information']}
        """
        query = [("human", trend_analysis_expert_query)]
        response = self.llm.invoke({"query" : query}, config=self.config)
        return {"messages": [query[0], response], "trend_analysis": response.content}