import datetime

from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from core.llms.prompt import system_prompt, investment_manager_message
from utils.time_helper import get_last_business_day


class InvestmentManager:

    def __init__(self, llm: BaseChatModel, config: RunnableConfig):
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])

        self.prompt = self.prompt.partial(system_message=investment_manager_message)
        current_date = get_last_business_day(datetime.date.today())
        self.prompt = self.prompt.partial(current_date=current_date)
        self.llm = self.prompt | llm
        self.config = config


    def investment_manager(self, state: State):
        bearish_trader_query = f"""
        现在请基于以下信息，给出你对股票代码${state['target_stock_ticker']}的最终投资建议：
        基本面报告: \n
        ${state['fundamental_analysis']}
        \n
        趋势报告: \n
        ${state['trend_analysis']}
        \n
        多头观点: \n
        ${state['bullish_opinions']}
        \n
        空头观点: \n
        ${state['bearish_opinions']}
        \n
        """
        query = [("human", bearish_trader_query)]
        response = self.llm.invoke({"query" : query}, config=self.config)
        return {"messages": [query[0], response], "final_decision": response.content}