"""三个专家 agent 节点单测（08-09-test-quality R4，离线零网络/零 LLM）。

覆盖（PRD R4 清单）：
- 注册表兼容：ROLES 中三个专家的 factory 调用（llm, config, progress_updater）
  → 正确类实例（装配零改动契约）
- 节点行为：node 方法返回正确 State key 写入（fundamental_analysis /
  trend_analysis / technical_indicator_analysis）+ messages 通道形状
  （("human", 查询) + AIMessage，对齐 test_agent_base）
- 查询构建：查询含 ticker 与 stock_information（f-string 逐字节契约由
  test_query_baselines 钉死，此处只验证字段进查询）
- 角色路由：system 消息含角色独有短语（离线路由语义，与假 LLM 路由约定
  一致）
- 专家不传 tools → 零 bind_tools 调用（直调路径，与工具角色区分）

house style 无 mock 框架——_FakeLLM（对齐 test_information_analyst /
test_agent_base：记录消息 + bind 计数，_generate 返回固定 AIMessage）。
"""

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from agents.chinese_mainland.fundamental_analysis_expert import FundamentalAnalysisExpert
from agents.chinese_mainland.trend_analysis_expert import TrendAnalysisExpert
from agents.chinese_mainland.technical_indicator_analyst import TechnicalIndicatorAnalyst
from core.role_registry import ROLES

_CONFIG = {"configurable": {"thread_id": "1"}}
_REPORT = "【分析报告】\n结论：买入"

# (类, 节点方法名, state key, system 消息路由短语)
_EXPERTS = [
    (FundamentalAnalysisExpert, "fundamental_analysis_expert",
     "fundamental_analysis", "基本面分析师"),
    (TrendAnalysisExpert, "trend_analysis_expert",
     "trend_analysis", "趋势分析师"),
    (TechnicalIndicatorAnalyst, "technical_indicator_analyst",
     "technical_indicator_analysis", "技术指标分析师"),
]

_STATE = {
    "target_stock_ticker": "000001",
    "stock_information": "dummy stock info",
}


class _FakeLLM(BaseChatModel):
    """记录格式化后的消息 + bind_tools 调用次数，返回固定 AIMessage。"""

    last_messages: list | None = None
    bind_calls: int = 0

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.last_messages = messages
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=_REPORT))])

    def bind_tools(self, tools, **kwargs):
        self.bind_calls += 1
        return self

    @property
    def _llm_type(self):
        return "fake"


class TestExpertAgents:

    def test_registry_factory_builds_each_expert(self):
        """ROLES 注册表 factory 零改动装配（专家无 tools 签名收敛点）。"""
        expected = {
            "fundamental_analysis_expert": FundamentalAnalysisExpert,
            "trend_analysis_expert": TrendAnalysisExpert,
            "technical_indicator_analyst": TechnicalIndicatorAnalyst,
        }
        found = {}
        for role in ROLES:
            if role.node_name in expected:
                found[role.node_name] = role.factory(_FakeLLM(), _CONFIG, None)
        assert set(found) == set(expected)
        for node_name, instance in found.items():
            assert isinstance(instance, expected[node_name])

    def test_node_writes_state_key_and_messages(self):
        """节点方法：state key 写入 + messages 通道（human 查询 + AIMessage）。"""
        for cls, method_name, state_key, _phrase in _EXPERTS:
            fake = _FakeLLM()
            node = cls(fake, _CONFIG)
            result = getattr(node, method_name)(dict(_STATE))
            assert result[state_key] == _REPORT
            assert len(result["messages"]) == 2
            # ("human", 查询) 元组与透传查询逐字节一致（对齐 test_agent_base）
            assert result["messages"][0][0] == "human"
            assert result["messages"][0][1] == fake.last_messages[-1].content
            assert result["messages"][1].content == _REPORT

    def test_query_contains_ticker_and_stock_information(self):
        """查询经链逐字节透传：ticker 与 stock_information 进入 LLM 输入。"""
        for cls, method_name, _state_key, _phrase in _EXPERTS:
            fake = _FakeLLM()
            node = cls(fake, _CONFIG)
            getattr(node, method_name)(dict(_STATE))
            query = fake.last_messages[-1].content
            assert "000001" in query
            assert "dummy stock info" in query

    def test_system_message_routes_role_phrase(self):
        """system 消息含角色独有短语（离线路由语义——与并行图假 LLM 路由
        同一约定）。"""
        for cls, method_name, _state_key, phrase in _EXPERTS:
            fake = _FakeLLM()
            node = cls(fake, _CONFIG)
            getattr(node, method_name)(dict(_STATE))
            system = fake.last_messages[0].content
            assert phrase in system

    def test_experts_never_bind_tools(self):
        """专家不传 tools → 零 bind_tools（直调路径；工具绑定是工具角色
        （bullish/bearish/manager）专属）。"""
        for cls, method_name, _state_key, _phrase in _EXPERTS:
            fake = _FakeLLM()
            node = cls(fake, _CONFIG)
            getattr(node, method_name)(dict(_STATE))
            assert fake.bind_calls == 0
            assert node.tools == []
