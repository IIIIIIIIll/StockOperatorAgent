from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from agents.base import AgentNode
from core.llms.prompt import investment_manager_message


class InvestmentManager(AgentNode):

    def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater = None, tools: list | None = None):
        super().__init__(llm, config, progress_updater, tools,
                         role_message=investment_manager_message)

    def investment_manager(self, state: State):
        # bullish_opinions / bearish_opinions 经 add_messages reducer 包装为
        # 消息列表（agent 返回字符串被包装）——取 [-1].content 为观点正文，
        # 不插值 [HumanMessage(...)] 列表 repr（修复：原 {state[...]} 插值
        # 的是列表元数据而非观点内容）
        bullish_opinion = state['bullish_opinions'][-1].content
        bearish_opinion = state['bearish_opinions'][-1].content
        # 信息面分析报告（08-08-billions-api-integration，Step 4 补接线）：
        # 条件段——key 缺失（ANALYST 关）→ 空串，查询与改动前逐字节一致
        # （AC1 零行为变化）；开 → 在技术指标报告与多头观点之间追加
        # （对齐 4 入边顺序：基本面 → 趋势 → 技术指标 → 信息面 → 观点）
        info_section = self.info_section(state)
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
        \n{info_section}
        多头观点: \n
        {bullish_opinion}
        \n
        空头观点: \n
        {bearish_opinion}
        \n
        """
        return self.complete_with_tools(
            investment_manager_query, "final_decision",
            start_msg="开始最终投资建议生成。。。",
            done_msg="最终投资建议生成完成。。。",
            log_label="Investment Manager",
        )
