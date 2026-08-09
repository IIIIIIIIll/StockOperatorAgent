"""AgentNode 基类（08-09-agent-base-class）——7× agent 模板公共管道收敛。

7 个 agent 文件曾逐字复制同一模板：构造器（prompt 壳 + system_message/
current_date partials + bind_tools NotImplementedError 回退）、节点骨架
（safe_progress → invoke → push_report → state dict）、信息面条件段。
本类把**不变管道**收敛为方法；各 agent 文件只保留差异化：角色 prompt
常量、查询构建（f-string，逐字节不变——test_query_baselines 钉死）、
角色特有逻辑（如信息面分析师的确定性预抓 _prefetch）。

约定（对齐 agents spec，行为与改造前逐字节一致）：
- 构造签名 (llm, config, progress_updater=None, tools=None) + role_message
  必填——注册表 Role.factory 零改动；information_analyst 的 _client 注入
  由子类自行 super() 前处理
- complete_expert：专家骨架（直调 invoke_with_retry，payload 形状
  {"query": query}）→ push_report → {"messages": [query[0], response],
  state_key: content}
- complete_with_tools：工具角色骨架（invoke_with_tools，修订轮传
  chain=self.revise_llm + max_tool_rounds=3）→ push_report →
  {"messages": 全量, state_key: content}
- info_section：信息面条件段（key 缺失 → 空串，查询与改动前逐字节一致）
- 硬边界：查询文本/工具 schema/占位文本/progress 文案逐字保留——本类只
  承载管道，不生成任何查询/文案内容；State key 显式传参（agent 不 import
  role_registry，注册表保持装配/UI 面向）
"""

import datetime

from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnableConfig
from loguru import logger

from core.llms.progress import push_report, safe_progress
from core.llms.prompt import system_prompt
from core.llms.retry import invoke_with_retry
from core.llms.tool_loop import invoke_with_tools
from utils.state import State
from utils.time_helper import get_last_business_day


class AgentNode:
    """agent 模板公共管道（构造/节点骨架/信息面条件段）——不变项收敛。"""

    def __init__(self, llm: BaseChatModel, config: RunnableConfig,
                 progress_updater=None, tools: list | None = None, *,
                 role_message: str):
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])
        self.prompt = self.prompt.partial(system_message=role_message)
        current_date = get_last_business_day(datetime.date.today())
        self.prompt = self.prompt.partial(current_date=current_date)
        # 可选工具绑定（08-03-websearch-tool-calling）：工具角色由 committee
        # 传 tools；FakeListChatModel（离线图测试）bind_tools 实测抛
        # NotImplementedError——跳过绑定保持原行为
        if tools:
            try:
                llm = llm.bind_tools(tools)
            except NotImplementedError:
                logger.warning("LLM {} 不支持 bind_tools，跳过工具绑定", type(llm).__name__)
        self.llm = self.prompt | llm
        self._bound_llm = llm  # build_chain 复用同一已绑定实例（双链共享）
        self.config = config
        self.progress_updater = progress_updater
        self.tools = tools or []

    def build_chain(self, role_message: str, llm=None):
        """第二条链（对抗修订轮，08-04-adversarial-verdict-loop）。

        revise 角色 system 消息（与初稿路由短语互斥——离线测试按 system
        消息路由）；llm 缺省 → 复用构造时**已绑定**实例（现状先 bind 再
        建双链——两链共享同一实例）。
        """
        chain_prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])
        chain_prompt = chain_prompt.partial(system_message=role_message)
        current_date = get_last_business_day(datetime.date.today())
        chain_prompt = chain_prompt.partial(current_date=current_date)
        return chain_prompt | (llm if llm is not None else self._bound_llm)

    def complete_expert(self, query_text: str, state_key: str, *,
                        start_msg: str, done_msg: str, log_label: str):
        """专家骨架（三专家 + 信息面分析师末段 LLM）：进度 → 直调
        invoke_with_retry → push_report → state dict。

        :param query_text: 子类构建的中文查询文本（f-string，逐字节不变）
        :param state_key: 该 agent 返回的 State key（显式传参，不 import
            注册表）
        :param start_msg/done_msg: safe_progress 中文文案（原样透传）
        :param log_label: logger 前缀（"Fundamental Analysis Expert" 等）
        """
        query = [("human", query_text)]
        logger.debug("{} Query: {}", log_label, query_text)
        safe_progress(self.progress_updater, start_msg)
        response = invoke_with_retry(self.llm, {"query": query}, config=self.config)
        safe_progress(self.progress_updater, done_msg)
        # 节点级即时填充（08-02-ui-live-progress-bridge）：报告在 LLM 返回
        # 即入队（不等同一 superstep 的慢节点），display 脚本线程消费即渲染
        push_report(self.progress_updater, state_key, response.content)
        logger.debug("{} Response: {}", log_label, response.content)
        return {"messages": [query[0], response], state_key: response.content}

    def complete_with_tools(self, query_text: str, state_key: str, *,
                            chain=None, max_tool_rounds=None,
                            start_msg: str, done_msg: str, log_label: str):
        """工具角色骨架（trader 初稿/修订 + manager）：进度 → 节点内工具
        循环 → push_report → state dict（{"messages": 全量, state_key:
        content}——消息通道完整含工具交换）。

        :param chain: 缺省 self.llm；修订轮传 self.revise_llm（revise 角色
            system 消息，与初稿互斥）
        :param max_tool_rounds: 缺省 None → tool_loop 默认 15（初稿轮）；
            修订轮传 3（成本护栏，08-04-adversarial-verdict-loop）
        """
        logger.debug("{} Query: {}", log_label, query_text)
        safe_progress(self.progress_updater, start_msg)
        # 节点内工具循环（08-03-websearch-tool-calling）：LLM 决定是否
        # 联网搜索，搜索结果以 ToolMessage 回流；返回 (final, 全量消息)
        kwargs = {}
        if max_tool_rounds is not None:
            kwargs["max_tool_rounds"] = max_tool_rounds
        response, messages = invoke_with_tools(
            chain if chain is not None else self.llm, query_text, self.config,
            tools=self.tools, progress_updater=self.progress_updater, **kwargs,
        )
        safe_progress(self.progress_updater, done_msg)
        # 节点级即时填充（08-02-ui-live-progress-bridge）：见 fundamental
        push_report(self.progress_updater, state_key, response.content)
        logger.debug("{} Response: {}", log_label, response.content)
        return {"messages": messages, state_key: response.content}

    def info_section(self, state: State) -> str:
        """信息面分析报告条件段（08-08-billions-api-integration，Step 4
        补接线）：key 缺失（ANALYST 关）→ 空串，查询与改动前逐字节一致
        （AC1 零行为变化）；开 → 条件段原文（插值位置由调用方 f-string
        决定——trader 在查询尾、manager 在技术指标与多头观点之间）。"""
        if state.get("information_analysis"):
            return f"\n        信息面分析报告: \n        {state['information_analysis']}\n        "
        return ""
