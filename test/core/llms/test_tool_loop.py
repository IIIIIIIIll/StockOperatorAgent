"""invoke_with_tools 单元测试（08-03-websearch-tool-calling）：stub LLM 离线。

house style 无 mock 框架——脚本化 stub LLM 按调用次序返回预置 AIMessage
（含/不含 tool_calls），验证工具循环的消息序列、降级与轮数截断语义；
工具用 make_web_search_tool(_searcher=stub) 注入，不碰网络。
"""

from langchain_core.messages import AIMessage, ToolMessage

from core.llms.tool_loop import _MAX_TOOL_ROUNDS, invoke_with_tools
from core.llms.tools.web_search import make_web_search_tool


def _call(query="贵州茅台 最新公告", name="web_search", call_id="call_1"):
    return {"name": name, "args": {"query": query}, "id": call_id, "type": "tool_call"}


def _tool_call_msg(calls):
    return AIMessage(content="", tool_calls=calls)


class _ScriptedLlm:
    """按调用次序返回脚本化 AIMessage；记录 payload 供消息回流断言。"""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0
        self.payloads = []

    def invoke(self, payload, config=None):
        self.calls += 1
        self.payloads.append(payload["query"])
        return self.responses.pop(0)


class _CollectingUpdater:
    def __init__(self):
        self.messages = []

    def info(self, message):
        self.messages.append(message)


class TestInvokeWithTools:

    def test_no_tool_calls_single_round(self):
        llm = _ScriptedLlm([AIMessage(content="最终回答")])
        response, messages = invoke_with_tools(llm, "query", {}, tools=[])
        assert response.content == "最终回答"
        assert llm.calls == 1
        assert messages == [("human", "query"), response]

    def test_tool_results_flow_back_as_tool_message(self):
        """消息序列：human → AIMessage(tool_calls) → ToolMessage → final。"""
        tool = make_web_search_tool(_searcher=lambda q: [
            {"title": "茅台半年报", "link": "u", "snippet": "营收增长"},
        ])
        llm = _ScriptedLlm([
            _tool_call_msg([_call()]),
            AIMessage(content="最终回答"),
        ])
        updater = _CollectingUpdater()
        response, messages = invoke_with_tools(
            llm, "贵州茅台 最新公告", {}, tools=[tool], progress_updater=updater,
        )
        assert response.content == "最终回答"
        assert llm.calls == 2
        assert messages[0] == ("human", "贵州茅台 最新公告")
        assert isinstance(messages[1], AIMessage) and messages[1].tool_calls
        assert isinstance(messages[2], ToolMessage)
        assert "【联网搜索结果】" in messages[2].content
        assert "标题：茅台半年报" in messages[2].content
        assert messages[2].tool_call_id == "call_1"
        assert messages[3] is response
        # 第二轮 payload 含 ToolMessage（搜索结果以消息形式回流）
        assert any(isinstance(m, ToolMessage) for m in llm.payloads[1])
        # 工具调用前后各打一点进度
        assert updater.messages == ["正在联网搜索。。。", "联网搜索完成。。。"]

    def test_multiple_tool_calls_in_one_round(self):
        tool = make_web_search_tool(_searcher=lambda q: [{"title": "t", "link": "u"}])
        llm = _ScriptedLlm([
            _tool_call_msg([_call(call_id="c1"), _call(call_id="c2")]),
            AIMessage(content="最终回答"),
        ])
        _, messages = invoke_with_tools(llm, "q", {}, tools=[tool])
        assert messages[2].tool_call_id == "c1"
        assert messages[3].tool_call_id == "c2"
        assert messages[4].content == "最终回答"

    def test_tool_invoke_exception_becomes_placeholder(self):
        class _RaisingTool:
            name = "web_search"

            def invoke(self, args):
                raise RuntimeError("boom")

        llm = _ScriptedLlm([
            _tool_call_msg([_call()]),
            AIMessage(content="最终回答"),
        ])
        response, messages = invoke_with_tools(llm, "q", {}, tools=[_RaisingTool()])
        assert response.content == "最终回答"
        assert isinstance(messages[2], ToolMessage)
        assert messages[2].content == "（联网搜索失败：boom）"

    def test_unknown_tool_name_placeholder(self):
        llm = _ScriptedLlm([
            _tool_call_msg([_call(name="unknown_tool")]),
            AIMessage(content="最终回答"),
        ])
        _, messages = invoke_with_tools(llm, "q", {}, tools=[])
        assert messages[2].content == "（未找到工具 unknown_tool）"

    def test_max_rounds_exhausted_returns_last_response(self):
        tool = make_web_search_tool(_searcher=lambda q: [{"title": "t", "link": "u"}])
        # 每轮都给 tool_calls：轮数耗尽后追加收尾轮，模型基于已有信息
        # （含搜索结果）给出完整最终回答
        llm = _ScriptedLlm([
            *[_tool_call_msg([_call(call_id=f"call_{i}")]) for i in range(_MAX_TOOL_ROUNDS)],
            AIMessage(content="最终回答"),
        ])
        response, messages = invoke_with_tools(llm, "q", {}, tools=[tool])
        assert llm.calls == _MAX_TOOL_ROUNDS + 1  # 轮数耗尽 + 收尾轮
        assert response.content == "最终回答" and not response.tool_calls
        # human + N × (AIMessage + ToolMessage) + 收尾 human + final
        assert len(messages) == 1 + 2 * _MAX_TOOL_ROUNDS + 2
        # 收尾轮 payload 含"轮数已用尽"指令（保证基于已有信息给完整回答）
        assert "轮数已用尽" in llm.payloads[-1][-1][1]

    def test_max_tool_rounds_param_caps_rounds(self):
        llm = _ScriptedLlm([
            _tool_call_msg([_call()]),
            AIMessage(content="最终回答"),
        ])
        response, messages = invoke_with_tools(llm, "q", {}, tools=[], max_tool_rounds=1)
        assert llm.calls == 2  # 1 轮工具 + 1 轮收尾
        assert response.content == "最终回答" and not response.tool_calls
        # human + (AIMessage + ToolMessage) + 收尾 human + final
        assert len(messages) == 5
