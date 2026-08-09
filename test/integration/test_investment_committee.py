import pytest

from langchain_core.runnables import RunnableConfig
from core.investment_committee import InvestmentCommittee
from core.llms.tools.get_company_info import get_stock_info

# deprecated（2026-08-02）：完整 E2E 集成测试（5 agent 全链路 → live LLM
# 调用）。本机 .env 有 key 但网络受限环境连 LLM 端点挂起，拖慢全量回归。
# 代码与 committee 保留；恢复方式：删掉本行，在可连 LLM 端点的环境执行。
pytestmark = pytest.mark.skip(reason="deprecated: live LLM E2E，常规不跑")

class TestInvestmentCommittee():

    def test_investment_committee(self):
        committee = InvestmentCommittee()
        config: RunnableConfig = {"configurable": {"thread_id": "1"}}

        target_ticker = "601088"
        graph = committee.make_investment_committee(config)

        for event in graph.stream({"messages": [{"role": "user", "content": f"请帮我分析一下 {target_ticker}"}],
                                   "target_stock_ticker": target_ticker,
                                   "stock_information": get_stock_info(target_ticker)
                                   }, config=config):
            for value in event.values():
                print("Assistant:", value["messages"][-1].content)


        states = list(graph.get_state_history(config))

        for state in states:
            print(state.next)
            print(state.config["configurable"]["checkpoint_id"])
            print(state.values)
            print()

        print(states[0].values["final_decision"])