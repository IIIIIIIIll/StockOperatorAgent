from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from agents.base import AgentNode
from core.llms.prompt import technical_indicator_analyst_message


class TechnicalIndicatorAnalyst(AgentNode):

    def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater = None):
        super().__init__(llm, config, progress_updater,
                         role_message=technical_indicator_analyst_message)

    def technical_indicator_analyst(self, state: State):
        # 查询构建保持本文件显式（f-string 逐字节不变——见 fundamental）
        technical_indicator_analyst_query = f"""
        请基于以下真实数据给出你对股票代码{state['target_stock_ticker']}的技术指标分析\n
        {state['stock_information']}
        """
        return self.complete_expert(
            technical_indicator_analyst_query, "technical_indicator_analysis",
            start_msg="开始技术指标分析报告生成。。。",
            done_msg="技术指标分析报告生成完成。。。",
            log_label="Technical Indicator Analyst",
        )
