import datetime

from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from core.llms.prompt import system_prompt, investment_manager_message
from core.llms.progress import safe_progress, push_report
from core.llms.tool_loop import invoke_with_tools
from utils.time_helper import get_last_business_day
from loguru import logger


class InvestmentManager:

    def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater = None, tools: list | None = None):
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])

        self.prompt = self.prompt.partial(system_message=investment_manager_message)
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
        技术指标分析报告: \n
        {state['technical_indicator_analysis']}
        \n
        多头观点: \n
        {bullish_opinion}
        \n
        空头观点: \n
        {bearish_opinion}
        \n
        """
        logger.debug("Investment Manager Query: {}", investment_manager_query)
        safe_progress(self.progress_updater, "开始最终投资建议生成。。。")
        # 节点内工具循环（08-03-websearch-tool-calling）：LLM 决定是否
        # 联网搜索，搜索结果以 ToolMessage 回流；返回 (final, 全量消息)
        response, messages = invoke_with_tools(
            self.llm, investment_manager_query, self.config,
            tools=self.tools, progress_updater=self.progress_updater,
        )
        safe_progress(self.progress_updater, "最终投资建议生成完成。。。")
        # 节点级即时填充（08-02-ui-live-progress-bridge）：见 fundamental
        push_report(self.progress_updater, "final_decision", response.content)
        logger.debug("Investment Manager Response: {}", response.content)
        return {"messages": messages, "final_decision": response.content}
