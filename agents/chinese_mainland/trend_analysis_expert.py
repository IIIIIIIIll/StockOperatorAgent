from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from agents.base import AgentNode
from core.llms.prompt import trend_analysis_expert_message


class TrendAnalysisExpert(AgentNode):

    def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater = None):
        super().__init__(llm, config, progress_updater,
                         role_message=trend_analysis_expert_message)

    def trend_analysis_expert(self, state: State):
        # 查询构建保持本文件显式（f-string 逐字节不变——见 fundamental）
        trend_analysis_expert_query = f"""
        请基于以下真实数据给出你对股票代码{state['target_stock_ticker']}的趋势分析\n
        {state['stock_information']}
        """
        return self.complete_expert(
            trend_analysis_expert_query, "trend_analysis",
            start_msg="开始趋势分析报告生成。。。",
            done_msg="趋势分析报告生成完成。。。",
            log_label="Trend Analysis Expert",
        )
