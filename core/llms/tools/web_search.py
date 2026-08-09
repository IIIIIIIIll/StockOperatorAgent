"""DuckDuckGo 联网搜索工具（08-03-websearch-tool-calling）。

投资经理 + 多头/空头交易员经 LLM 工具调用（bind_tools，节点内工具循环——
见 core/llms/tool_loop.py）决定是否联网搜索：agent 自行判断是否需要外部
信息验证论据，搜索结果以 ToolMessage 消息回流参与生成（OpenAI 兼容
bind_tools 路径首次真实可用——08-09-llm-provider-agnostic 起 LLM 配置
通用化，不再依赖供应商私有扩展（如 DashScope enable_search））。

供应商：仅 DuckDuckGo（用户拍板，选型与代价见
research/search-provider-comparison.md）——langchain_community 0.4.2 的
`DuckDuckGoSearchResults`（注意：实际导入路径为
`langchain_community.tools` 顶层，子包 `tools.ddg_search` 的 __init__
只导出旧名 DuckDuckGoSearchRun）+ `ddgs` SDK，region=cn-zh 中文财经
查询（本网络实测可用，2026-08-03）。

约定（对齐 error-handling spec 降级风格，与 get_market_intel 同风格）：
- 查询失败 / 空结果 → 返回占位文本 `（联网搜索失败：{原因}）`，**不 raise**
  （模型拿到占位 ToolMessage 继续生成，图不中断）
- 结果 dict 列表 → 中文摘要文本（标题/链接/摘要，news 源含日期）

开关（08-03-websearch-tool-calling）：`WEB_SEARCH_DISABLED` 环境变量
设置时图装配不绑定工具（core/investment_committee.py 判定，行为与现状
一致）——判定语义逐字对齐 get_market_intel._mcp_disabled()。
"""

from __future__ import annotations

import json

from langchain_core.tools import BaseTool, tool
from loguru import logger

from utils.runtime_config import env_disabled, runtime_bool


def web_search_enabled() -> bool:
    """WEB_SEARCH_DISABLED 开关（图装配时判定）：未设置 → 启用。

    判定语义与 get_market_intel._mcp_disabled() 共用
    runtime_config.env_disabled 单点（极性翻转收敛到判定内部，消费点
    算正布尔）。

    覆盖层（08-08-billions-switches-ui）：`WEB_SEARCH_ENABLED` 覆盖
    存在 → 覆盖值优先（True=开、False=关）；否则 env 判定（默认
    行为与现状一致）。
    """
    env_enabled = not env_disabled("WEB_SEARCH_DISABLED")
    return runtime_bool("WEB_SEARCH_ENABLED", env_enabled)


def _default_searcher():
    """默认搜索实现：DuckDuckGoSearchResults（cn-zh 中文财经，json 输出）。

    惰性 import + 惰性构造（house style：工具在函数内 import，避免
    模块级副作用）；`langchain_community` 已停更（README 挂 sunset
    警告）——自担维护的存量版，本网络实测可用。
    """
    from langchain_community.tools import DuckDuckGoSearchResults
    from langchain_community.utilities.duckduckgo_search import DuckDuckGoSearchAPIWrapper

    search_tool = DuckDuckGoSearchResults(
        api_wrapper=DuckDuckGoSearchAPIWrapper(region="cn-zh", max_results=5),
        output_format="json",
    )

    def search(query: str) -> list:
        result = search_tool.invoke({"query": query})
        if isinstance(result, tuple):
            # response_format=content_and_artifact：取 content（json 字符串）
            result = result[0]
        return json.loads(result)

    return search


def _summarize_results(results: list) -> str:
    """结果 dict 列表 → 中文摘要文本；无有效条目 → 占位文本（不 raise）。

    键契约（DuckDuckGoSearchAPIWrapper.results）：text 源为 title / link /
    snippet，news 源另有 date（source）。脏条目（无标题/链接/摘要）跳过。
    """
    lines = []
    for item in results:
        title = item.get("title", "")
        link = item.get("link") or item.get("url", "")
        snippet = item.get("snippet", "")
        if not (title or link or snippet):
            continue
        parts = []
        if title:
            parts.append(f"标题：{title}")
        if link:
            parts.append(f"链接：{link}")
        if snippet:
            parts.append(f"摘要：{snippet}")
        if item.get("date"):
            parts.append(f"日期：{item['date']}")
        lines.append("- " + "；".join(parts))
    if not lines:
        return "（联网搜索失败：无返回结果）"
    return "【联网搜索结果】\n" + "\n".join(lines)


def make_web_search_tool(_searcher=None) -> BaseTool:
    """构造联网搜索工具（BaseTool，可 bind_tools）。

    :param _searcher: 测试注入点（house style 无 mock 框架）——可调用
        `_searcher(query: str) -> list[dict]`，返回结果 dict 列表（键：
        title/link/snippet，news 源另有 date）；查询失败 raise。默认
        用 _default_searcher（DuckDuckGo，cn-zh，max_results=5）。
    :return: 名 "web_search" 的 StructuredTool——invoke 返回中文摘要
        文本；失败/空结果 → 占位文本（不 raise，error-handling spec
        降级约定）。
    """
    search = _searcher if _searcher is not None else _default_searcher()

    @tool("web_search")
    def web_search(query: str) -> str:
        """联网搜索（DuckDuckGo 中文财经源，cn-zh），可验证行业与市场的最新论据（如新闻、公告、政策）。查询失败时返回占位文本。"""
        try:
            results = search(query)
        except Exception as exc:
            # 网络/反爬/解析异常不阻断主流程（模型拿到占位文本继续生成）
            logger.warning("Web search failed: {}", exc)
            return f"（联网搜索失败：{exc}）"
        return _summarize_results(results)

    return web_search
