import datetime

from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from core.llms.prompt import system_prompt, bearish_trader_message
from core.llms.progress import safe_progress, push_report
from core.llms.tool_loop import invoke_with_tools
from utils.time_helper import get_last_business_day
from loguru import logger


class BearishTrader:

    def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater = None, tools: list | None = None):
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])

        self.prompt = self.prompt.partial(system_message=bearish_trader_message)
        current_date = get_last_business_day(datetime.date.today())
        self.prompt = self.prompt.partial(current_date=current_date)
        if tools:
            try:
                llm = llm.bind_tools(tools)
            except NotImplementedError:
                # 离线图测试的 FakeListChatModel 不支持 bind_tools（实测抛
                # NotImplementedError）——跳过工具绑定保持原行为
                logger.warning("LLM {} 不支持 bind_tools，跳过工具绑定", type(llm).__name__)
        self.llm = self.prompt | llm
        self.config = config
        self.progress_updater = progress_updater
        self.tools = tools or []


    def bearish_trader(self, state: State):
        bearish_trader_query = f"""
        现在请基于以下信息，给出你对股票代码{state['target_stock_ticker']}的看法：
        基本面报告: \n
        {state['fundamental_analysis']}
        \n
        趋势报告: \n
        {state['trend_analysis']}
        \n
        """
        logger.debug("Bearish Trader Query: {}", bearish_trader_query)
        safe_progress(self.progress_updater, "开始空方观点生成。。。")
        # 节点内工具循环（08-03-websearch-tool-calling）：LLM 决定是否
        # 联网搜索，搜索结果以 ToolMessage 回流；返回 (final, 全量消息)
        response, messages = invoke_with_tools(
            self.llm, bearish_trader_query, self.config,
            tools=self.tools, progress_updater=self.progress_updater,
        )
        safe_progress(self.progress_updater, "空方观点生成完成。。。")
        # 节点级即时填充（08-02-ui-live-progress-bridge）：见 fundamental
        push_report(self.progress_updater, "bearish_opinions", response.content)
        logger.debug("Bearish Trader Response: {}", response.content)
        return {"messages": messages, "bearish_opinions": response.content}
