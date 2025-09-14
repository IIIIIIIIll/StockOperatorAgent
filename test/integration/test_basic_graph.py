from typing import Annotated

from dotenv import load_dotenv
from langgraph.prebuilt import ToolNode
from typing_extensions import TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from utils.state import State
from core.llms.qwen.qwen_api import QwenApi
from core.llms.tools.get_company_info import get_stock_info
from agents.chinese_mainland.fundamental_analysis_expert import FundamentalAnalysisExpert

from IPython.display import Image, display

class TestBasicAgent:

    def test_basic_agent(self):
        load_dotenv()  # This loads the variables from .env

        graph_builder = StateGraph(State)

        llm = QwenApi()
        tool = get_stock_info
        tools = [tool]
        agent = FundamentalAnalysisExpert(llm, tools)

        graph_builder.add_node("fundamental_analysis_expert", agent.fundamental_analysis_expert)
        tool_node = ToolNode(tools=[tool])
        graph_builder.add_node("tools", tool_node)

        def route_tools(
            state: State,
        ):
            """
            Use in the conditional_edge to route to the ToolNode if the last message
            has tool calls. Otherwise, route to the end.
            """
            if isinstance(state, list):
                ai_message = state[-1]
            elif messages := state.get("messages", []):
                ai_message = messages[-1]
            else:
                raise ValueError(f"No messages found in input state to tool_edge: {state}")
            if hasattr(ai_message, "tool_calls") and len(ai_message.tool_calls) > 0:
                return "tools"
            return END


        # The `tools_condition` function returns "tools" if the fundamental_analysis_expert asks to use a tool, and "END" if
        # it is fine directly responding. This conditional routing defines the main agent loop.
        graph_builder.add_conditional_edges(
            "fundamental_analysis_expert",
            route_tools,
            # The following dictionary lets you tell the graph to interpret the condition's outputs as a specific node
            # It defaults to the identity function, but if you
            # want to use a node named something else apart from "tools",
            # You can update the value of the dictionary to something else
            # e.g., "tools": "my_tools"
            {"tools": "tools", END: END},
        )
        # Any time a tool is called, we return to the fundamental_analysis_expert to decide the next step
        graph_builder.add_edge("tools", "fundamental_analysis_expert")
        graph_builder.add_edge(START, "fundamental_analysis_expert")
        graph = graph_builder.compile()

        def stream_graph_updates(user_input: str):
            for event in graph.stream({"messages": [{"role": "user", "content": user_input}]}):
                for value in event.values():
                    print("Assistant:", value["messages"][-1].content)


        user_input = "请帮我分析一下 牧原股份 002714 的基本面，给出合理的估值区间和目标价"
        print("User: " + user_input)
        stream_graph_updates(user_input)