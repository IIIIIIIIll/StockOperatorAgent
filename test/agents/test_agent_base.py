"""AgentNode 基类单测（08-09-agent-base-class，Step 1，离线）。

覆盖（implement.md Step 1 清单）：
- prompt partials 生效：system_message/current_date 注入链（查询文本经
  {system_message} 壳拼接；current_date = get_last_business_day 当日）
- bind_tools：支持 → 正常绑定（记录工具名）；FakeListChatModel →
  NotImplementedError 回退（离线图测试路径，构造与调用不受影响）
- build_chain：第二条链独立生效（revise 角色 system 消息与主链互斥路由）
- complete_expert：state dict 形状（messages 含 query+response、state_key
  写入）、progress 文案原样透传、push_report 同 key 推送
- complete_with_tools：全量 messages（human → AIMessage(tool_calls) →
  ToolMessage → final）、state_key 写入
- info_section 三态（缺失 → 空串 / 有值 → 条件段原文）
- 硬边界：查询文本经基类管道后逐字节不变（基类不生成/改动查询内容）

house style 无 mock 框架——假 LLM/updater 注入（对齐 test_query_baselines
/test_tool_loop 模式）。节点骨架的行为等价性由既有 agent 测试
（test_query_baselines / test_information_analyst）与集成测试钉死。
"""

from langchain_core.language_models import BaseChatModel
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool

from agents.base import AgentNode
from core.llms.tools.web_search import make_web_search_tool
from utils.time_helper import get_last_business_day

import datetime

_CONFIG = {"configurable": {"thread_id": "1"}}
_ROLE_MSG = "测试角色消息"
_REVISE_MSG = "对抗修订轮的测试角色消息"

_BOUND = {"tools": None}


class _FakeLLM(BaseChatModel):
    """记录格式化后的消息并返回固定 AIMessage（对齐 query_baselines 模式）。"""

    last_messages: list | None = None

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.last_messages = messages
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="OK"))])

    @property
    def _llm_type(self):
        return "fake"


class _RoutingLlm(BaseChatModel):
    """按 system 消息路由响应——验证 build_chain 的第二条链独立生效。"""

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        system = next((m.content for m in messages if m.type == "system"), "")
        content = "REVISE" if "对抗修订轮" in system else "MAIN"
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=content))])

    @property
    def _llm_type(self):
        return "fake"


class _BoundLlm(BaseChatModel):
    """bind_tools 记录到模块级 holder（pydantic 模型不宜加实例属性）——
    验证基类对支持 bind_tools 的 LLM 正常绑定（工具角色路径）。"""

    def bind_tools(self, tools, **kwargs):
        _BOUND["tools"] = [t.name for t in tools]
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="OK"))])

    @property
    def _llm_type(self):
        return "fake"


class _ToolScriptedLlm(BaseChatModel):
    """首次返回带 tool_calls 的 AIMessage，此后返回最终回答（工具循环路径）。"""

    calls: int = 0

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.calls += 1
        if self.calls == 1:
            return ChatResult(generations=[ChatGeneration(message=AIMessage(
                content="",
                tool_calls=[{"name": "web_search", "args": {"query": "q"},
                             "id": "call_1", "type": "tool_call"}],
            ))])
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="最终回答"))])

    @property
    def _llm_type(self):
        return "fake"


class _CollectingUpdater:
    """记录 safe_progress 文案与 push_report 推送（对齐 tool_loop 模式）。"""

    def __init__(self):
        self.messages = []
        self.reports = []

    def info(self, message):
        self.messages.append(message)

    def push_report(self, key, content):
        self.reports.append((key, content))


@tool("stub_tool")
def _stub_tool(query: str) -> str:
    """测试桩工具（bind_tools 记录用）。"""
    return "stub"


class TestAgentNodeConstruction:

    def test_prompt_partials_applied(self):
        # system_message / current_date partial 注入链（与 7 个 agent 改造前
        # 构造器逐条一致）
        node = AgentNode(_FakeLLM(), _CONFIG, role_message=_ROLE_MSG)
        partials = node.prompt.partial_variables
        assert partials["system_message"] == _ROLE_MSG
        assert partials["current_date"] == get_last_business_day(datetime.date.today())

    def test_bind_tools_applied_when_supported(self):
        _BOUND["tools"] = None
        AgentNode(_BoundLlm(), _CONFIG, tools=[_stub_tool], role_message=_ROLE_MSG)
        assert _BOUND["tools"] == ["stub_tool"]

    def test_bind_tools_not_implemented_fallback(self):
        # FakeListChatModel（离线图测试路径）bind_tools 抛 NotImplementedError
        # ——回退跳过绑定，构造与链调用不受影响
        llm = FakeListChatModel(responses=["OK"])
        node = AgentNode(llm, _CONFIG, tools=[_stub_tool], role_message=_ROLE_MSG)
        assert node.tools == [_stub_tool]  # 工具列表仍保存（调用方传参语义不变）
        assert node.llm.invoke({"query": [("human", "查询")]}).content == "OK"

    def test_no_tools_skips_binding(self):
        # tools 缺省（专家路径）→ 不触发 bind_tools
        _BOUND["tools"] = None
        AgentNode(_BoundLlm(), _CONFIG, role_message=_ROLE_MSG)
        assert _BOUND["tools"] is None


class TestBuildChain:

    def test_revise_chain_routes_separately(self):
        # 第二条链用 revise 角色 system 消息——与主链按 system 消息互斥
        # 路由（离线图测试语义）；复用同一已绑定 llm 实例
        llm = _RoutingLlm()
        node = AgentNode(llm, _CONFIG, role_message="主角色消息")
        revise = node.build_chain(_REVISE_MSG)
        assert node.llm.invoke({"query": [("human", "查询")]}).content == "MAIN"
        assert revise.invoke({"query": [("human", "查询")]}).content == "REVISE"
        assert revise.invoke({"query": [("human", "再次调用")]}).content == "REVISE"  # 链可重复调用


class TestCompleteExpert:

    def _node(self):
        return AgentNode(_FakeLLM(), _CONFIG, role_message=_ROLE_MSG)

    def test_returns_state_dict(self):
        fake = _FakeLLM()
        node = AgentNode(fake, _CONFIG, role_message=_ROLE_MSG)
        result = node.complete_expert(
            "查询文本", "fundamental_analysis",
            start_msg="开始生成。。。", done_msg="生成完成。。。",
            log_label="Test Expert",
        )
        # state dict 形状：messages 含 query + response（AIMessage 带 run
        # id，按字段断言），state_key 写入
        assert result["fundamental_analysis"] == "OK"
        assert result["messages"][0] == ("human", "查询文本")
        assert isinstance(result["messages"][1], AIMessage)
        assert result["messages"][1].content == "OK"
        # 查询文本经链逐字节透传（基类不生成/改动查询内容）
        assert fake.last_messages[-1].content == "查询文本"

    def test_progress_and_report(self):
        updater = _CollectingUpdater()
        node = AgentNode(_FakeLLM(), _CONFIG, progress_updater=updater,
                         role_message=_ROLE_MSG)
        node.complete_expert(
            "q", "trend_analysis",
            start_msg="开始趋势分析报告生成。。。",
            done_msg="趋势分析报告生成完成。。。",
            log_label="Test Expert",
        )
        # safe_progress 文案原样透传（invoke 前后各一次）；push_report 同 key
        assert updater.messages == ["开始趋势分析报告生成。。。", "趋势分析报告生成完成。。。"]
        assert updater.reports == [("trend_analysis", "OK")]


class TestCompleteWithTools:

    def test_returns_full_messages(self):
        tool = make_web_search_tool(_searcher=lambda q: [
            {"title": "茅台半年报", "link": "u", "snippet": "营收增长"},
        ])
        llm = _ToolScriptedLlm()
        node = AgentNode(llm, _CONFIG, tools=[tool], role_message=_ROLE_MSG)
        result = node.complete_with_tools(
            "查询文本", "bullish_opinions",
            start_msg="开始多方观点生成。。。", done_msg="多方观点生成完成。。。",
            log_label="Test Trader",
        )
        # 全量消息通道：human → AIMessage(tool_calls) → ToolMessage → final
        assert result["bullish_opinions"] == "最终回答"
        assert len(result["messages"]) == 4
        assert result["messages"][0] == ("human", "查询文本")
        assert result["messages"][1].tool_calls
        assert isinstance(result["messages"][2], ToolMessage)
        assert "【联网搜索结果】" in result["messages"][2].content
        assert result["messages"][3].content == "最终回答"

    def test_revise_chain_and_rounds_passed(self):
        # 修订轮：chain=self.revise_llm + max_tool_rounds=3（成本护栏传参
        # 由 tool_loop 语义兜底，此处验证骨架接受并返回）
        tool = make_web_search_tool(_searcher=lambda q: [])
        llm = _RoutingLlm()
        node = AgentNode(llm, _CONFIG, tools=[tool], role_message=_ROLE_MSG)
        node.revise_llm = node.build_chain(_REVISE_MSG)
        result = node.complete_with_tools(
            "修订查询", "bearish_opinions",
            chain=node.revise_llm, max_tool_rounds=3,
            start_msg="开始空方观点修订。。。", done_msg="空方观点修订完成。。。",
            log_label="Test Trader Revise",
        )
        # 路由到 revise 角色 system 消息的链；单轮直调（_RoutingLlm 无
        # tool_calls）→ messages 只含 human + final
        assert result["bearish_opinions"] == "REVISE"
        assert len(result["messages"]) == 2


class TestInfoSection:

    def test_missing_key_returns_empty(self):
        node = AgentNode(_FakeLLM(), _CONFIG, role_message=_ROLE_MSG)
        assert node.info_section({}) == ""
        assert node.info_section({"information_analysis": None}) == ""

    def test_present_returns_section_verbatim(self):
        # 条件段原文（与 trader/manager 改造前逐字节一致）
        node = AgentNode(_FakeLLM(), _CONFIG, role_message=_ROLE_MSG)
        assert node.info_section({"information_analysis": "内容"}) == (
            "\n        信息面分析报告: \n        内容\n        "
        )
