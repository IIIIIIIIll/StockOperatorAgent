import datetime

from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from core.llms.prompt import system_prompt, bearish_trader_message, bearish_revise_message
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
        # 对抗修订轮（08-04-adversarial-verdict-loop）：同一实例的第二条链——
        # revise 角色 system 消息（含独有短语"对抗修订轮的空方交易员"，与
        # 初稿路由短语互斥——离线测试按 system 消息路由）；llm 复用同一
        # bind_tools 后实例，工具轮数由节点调用收紧（max_tool_rounds=3）
        self.revise_prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])
        self.revise_prompt = self.revise_prompt.partial(system_message=bearish_revise_message)
        self.revise_prompt = self.revise_prompt.partial(current_date=current_date)
        if tools:
            try:
                llm = llm.bind_tools(tools)
            except NotImplementedError:
                # 离线图测试的 FakeListChatModel 不支持 bind_tools（实测抛
                # NotImplementedError）——跳过工具绑定保持原行为
                logger.warning("LLM {} 不支持 bind_tools，跳过工具绑定", type(llm).__name__)
        self.llm = self.prompt | llm
        self.revise_llm = self.revise_prompt | llm
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


    def bearish_revise(self, state: State):
        # 对抗修订轮（08-04-adversarial-verdict-loop）：双入边 join 语义——
        # bullish_opinions / bearish_opinions 恒为消息列表（add_messages
        # reducer），[-1].content 取各自初稿；对方初稿在此必已就绪
        own_draft = state['bearish_opinions'][-1].content
        opponent_draft = state['bullish_opinions'][-1].content
        bearish_revise_query = f"""
        现在请检视多方交易员对你空头初稿的质疑，给出股票代码{state['target_stock_ticker']}的修订版完整空头观点：
        多方交易员观点: \n
        {opponent_draft}
        \n
        你的初稿空头观点: \n
        {own_draft}
        \n
        """
        logger.debug("Bearish Trader Revise Query: {}", bearish_revise_query)
        safe_progress(self.progress_updater, "开始空方观点修订。。。")
        # 修订轮工具轮数收紧（08-04-adversarial-verdict-loop，成本护栏）：
        # max_tool_rounds=3——初稿轮保持默认 10，公共语义零改动，只传参；
        # 用 self.revise_llm（revise 角色 system 消息，与初稿互斥）
        response, messages = invoke_with_tools(
            self.revise_llm, bearish_revise_query, self.config,
            tools=self.tools, max_tool_rounds=3, progress_updater=self.progress_updater,
        )
        safe_progress(self.progress_updater, "空方观点修订完成。。。")
        # 修订版追加写原 opinions key（State 零新 key）；push_report 同 key——
        # display 按 (key, content) 去重追加渲染初稿与修订版
        push_report(self.progress_updater, "bearish_opinions", response.content)
        logger.debug("Bearish Trader Revise Response: {}", response.content)
        return {"messages": messages, "bearish_opinions": response.content}
