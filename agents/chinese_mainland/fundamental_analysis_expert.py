import datetime

from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from core.llms.prompt import system_prompt, fundamental_analysis_expert_message
from utils.time_helper import get_last_business_day


class FundamentalAnalysisExpert:

    def __init__(self, llm: BaseChatModel, tools: list, config: RunnableConfig):
        llm = llm.bind_tools(tools)

        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="messages"),
        ])

        self.prompt = self.prompt.partial(system_message=fundamental_analysis_expert_message)
        current_date = get_last_business_day(datetime.date.today())
        self.prompt = self.prompt.partial(current_date=current_date)
        self.llm = self.prompt | llm
        self.config = config


    def fundamental_analysis_expert(self, state: State):
        return {"messages": [self.llm.invoke(state["messages"], config=self.config)]}