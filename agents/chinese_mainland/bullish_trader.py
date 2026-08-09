from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from agents.base import AgentNode
from core.llms.prompt import bullish_trader_message, bullish_revise_message


class BullishTrader(AgentNode):

    def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater = None, tools: list | None = None):
        # 对抗修订轮（08-04-adversarial-verdict-loop）：同一实例的第二条链——
        # revise 角色 system 消息（含独有短语"对抗修订轮的多方交易员"，与
        # 初稿路由短语互斥——离线测试按 system 消息路由）；build_chain 复用
        # 同一已绑定 llm，工具轮数由节点调用收紧（max_tool_rounds=3）
        super().__init__(llm, config, progress_updater, tools,
                         role_message=bullish_trader_message)
        self.revise_llm = self.build_chain(bullish_revise_message)

    def bullish_trader(self, state: State):
        # 信息面分析报告（08-08-billions-api-integration，Step 4 补接线）：
        # 条件段——key 缺失（ANALYST 关）→ 空串，查询与改动前逐字节一致
        # （AC1 零行为变化）；开 → 在技术指标报告之后追加信息面段
        # （4 入边 join 保证信息面报告已就绪）
        info_section = self.info_section(state)
        bullish_trader_query = f"""
        现在请基于以下信息，给出你对股票代码{state['target_stock_ticker']}的看法：
        基本面报告: \n
        {state['fundamental_analysis']}
        \n
        趋势报告: \n
        {state['trend_analysis']}
        \n
        技术指标分析报告: \n
        {state['technical_indicator_analysis']}
        \n
        {info_section}"""
        return self.complete_with_tools(
            bullish_trader_query, "bullish_opinions",
            start_msg="开始多方观点生成。。。",
            done_msg="多方观点生成完成。。。",
            log_label="Bullish Trader",
        )

    def bullish_revise(self, state: State):
        # 对抗修订轮（08-04-adversarial-verdict-loop）：双入边 join 语义——
        # bullish_opinions / bearish_opinions 恒为消息列表（add_messages
        # reducer），[-1].content 取各自初稿；对方初稿在此必已就绪
        own_draft = state['bullish_opinions'][-1].content
        opponent_draft = state['bearish_opinions'][-1].content
        bullish_revise_query = f"""
        现在请检视空方交易员对你多头初稿的质疑，给出股票代码{state['target_stock_ticker']}的修订版完整多头观点：
        空方交易员观点: \n
        {opponent_draft}
        \n
        你的初稿多头观点: \n
        {own_draft}
        \n
        """
        # 修订轮工具轮数收紧（08-04-adversarial-verdict-loop，成本护栏）：
        # max_tool_rounds=3——初稿轮保持默认（tool_loop 兜底 15），公共语义
        # 零改动，只传参；用 self.revise_llm（revise 角色 system 消息）
        return self.complete_with_tools(
            bullish_revise_query, "bullish_opinions",
            chain=self.revise_llm, max_tool_rounds=3,
            start_msg="开始多方观点修订。。。",
            done_msg="多方观点修订完成。。。",
            log_label="Bullish Trader Revise",
        )
