"""节点内工具调用循环（08-03-websearch-tool-calling）。

三个 agent（bullish/bearish/investment_manager）在构造器里对 LLM 做了
bind_tools 后，节点方法不再裸 invoke——经 `invoke_with_tools` 驱动至多
`_MAX_TOOL_ROUNDS` 轮工具调用：LLM 决定是否调用工具（response.tool_calls），
有则执行并把该 AIMessage（含 tool_calls）+ ToolMessage 追加进消息列表再
交给模型，直到模型给出最终回答或轮数耗尽。

搜索结果以消息形式回流：`State.messages` 的 add_messages reducer 天然
处理 AIMessage.tool_calls / ToolMessage，State 零改动（见 agents spec）。

约定：
- 复用 `invoke_with_retry`（core/llms/retry.py，review #6 重试语义不变）
- 工具异常 → 占位文本 ToolMessage（error-handling spec 降级风格，与
  get_market_intel 同风格），不 raise 打断图
- 轮数耗尽且模型仍在要工具（2026-08-04 实测场景）→ 追加一轮"收尾"
  调用（有界 +1 次 LLM 调用），要求模型基于已有搜索结果给出完整最终
  回答、不再调用工具；收尾轮仍带 tool_calls 属病态，照旧返回不阻断
"""

from __future__ import annotations

from langchain_core.messages import AIMessage, ToolMessage
from loguru import logger

from core.llms.progress import safe_progress
from core.llms.retry import invoke_with_retry

_MAX_TOOL_ROUNDS = 10


def invoke_with_tools(
    llm, query: str, config, *, tools,
    max_tool_rounds=_MAX_TOOL_ROUNDS, progress_updater=None,
) -> tuple[AIMessage, list]:
    """驱动 LLM + 工具循环，返回 (最终 AIMessage, 全量消息列表)。

    :param llm: 已 bind_tools 的链（agent 的 self.llm）
    :param query: 人类查询文本（节点构建的中文 query 文本）
    :param config: RunnableConfig（透传 invoke_with_retry）
    :param tools: 工具列表（按 name 查找执行）；空列表 → 模型无法发起
        工具调用，单轮直调（与现状行为一致）
    :param max_tool_rounds: 工具调用轮数上限（默认 10——2026-08-04 实测
        DeepSeek 2 轮内会继续要搜索而不收敛，用户拍板放宽；模型自主决定
        何时收尾。每轮可并行多个调用（实测 3 个/轮），最坏情况 3 agent ×
        10 轮 × 每轮多调用 = 90 次搜索/分析；DDG 免费但注意 ddgs 反爬
        频率约束）
    :param progress_updater: safe_progress 用（None 兼容，见
        core/llms/progress.py）
    :return: (final AIMessage, messages 列表——human → AIMessage(含
        tool_calls) → ToolMessage → ... → final；由节点整体写入
        State.messages)。轮数耗尽但模型仍在要工具 → 追加一轮"收尾"
        调用（见函数体尾部），保证基于已有信息给出完整最终回答。
    """
    messages = [("human", query)]
    response = None
    for _ in range(max_tool_rounds):
        response = invoke_with_retry(llm, {"query": messages}, config=config)
        if not getattr(response, "tool_calls", None):
            return response, messages + [response]
        safe_progress(progress_updater, "正在联网搜索。。。")
        messages.append(response)
        tool_by_name = {t.name: t for t in (tools or [])}
        for call in response.tool_calls:
            tool = tool_by_name.get(call["name"])
            if tool is None:
                content = f"（未找到工具 {call['name']}）"
            else:
                try:
                    content = tool.invoke(call["args"])
                    if isinstance(content, tuple):
                        # content_and_artifact 形态：取 content
                        content = content[0]
                except Exception as exc:
                    # 工具内部异常不阻断主流程（降级风格，图可继续）
                    logger.warning("Tool {} invoke failed: {}", call["name"], exc)
                    content = f"（联网搜索失败：{exc}）"
            messages.append(ToolMessage(content=str(content), tool_call_id=call["id"]))
        safe_progress(progress_updater, "联网搜索完成。。。")
    # 轮数耗尽且模型仍在要工具（不收敛，2026-08-04 实测）：追加一轮
    # "收尾"调用——指令禁止再调工具，要求基于已有搜索结果直接给最终
    # 完整回答（cost +1 次 LLM 调用/分析，有界）；收尾轮仍带 tool_calls
    # 属病态（指令未遵从），照旧返回该响应不阻断（消息已含全部搜索
    # 结果，调用方按内容使用）。
    if response is not None and getattr(response, "tool_calls", None):
        safe_progress(progress_updater, "搜索轮数已用尽，正在整理最终回答。。。")
        messages.append((
            "human",
            "工具调用轮数已用尽。请基于以上全部信息（包括联网搜索结果）"
            "直接给出完整、明确的最终回答，不要再调用任何工具。",
        ))
        final = invoke_with_retry(llm, {"query": messages}, config=config)
        return final, messages + [final]
    return response, messages
