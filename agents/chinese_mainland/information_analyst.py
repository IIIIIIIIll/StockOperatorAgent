"""亿信信息面分析师（08-08-billions-api-integration，Step 4）。

与三专家（fundamental/trend/technical_indicator_analyst）并行的第 4 个
graph 节点（ANALYST 开关开时由 committee 接线）：**确定性预抓 + 单次
LLM 总结**（用户选定方案）——节点内先按开关对公告/研报/新闻各 1 次
search + 推特 1 次（fast、count=5、time_range past 3 months，固定成本
可预期），把带来源的检索上下文拼给 LLM 撰写信息面报告，输出
`information_analysis` State key（一次性写入，无追加语义）。

约定（对齐 expert 模板 + error-handling spec 降级风格）：
- 构造注入 `_client=None`（house style 无 mock 框架）——确定性预抓用；
  缺省 None → 懒加载真 BillionsClient（无 key 环境不构造、不触发 httpx
  重依赖）
- 预抓按开关过滤源（SEARCH → announcement/report/web 各 1 次；TWITTER
  → 1 次）；失败源（BillionsApiError/任何异常/无有效条目）→
  logger.warning + 该源跳过并在上下文中注明，**不 raise、不阻断**
- 预抓全部失败/无结果 → 仍单次 LLM 调用产出报告（说明无可用信息），
  不崩溃
- 开关门控在 committee 图装配处（billions_enabled("ANALYST") 且 SEARCH
  或 TWITTER 至少一者开——Out of Scope 组合视为分析师不可用不产出）；
  本类不做构造期判定（与其余 agent 模板一致：gating 在接线处）
"""

import datetime

from langchain_core.runnables import RunnableConfig

from utils.state import State
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from core.llms.prompt import system_prompt, information_analyst_message
from core.llms.retry import invoke_with_retry
from core.llms.progress import safe_progress, push_report
from utils.time_helper import get_last_business_day
from utils.billions_config import billions_enabled
from loguru import logger

# 单条条目格式化与 LLM 工具（billions_search/billions_twitter）共用同一
# 实现（字段契约 research/billions-api.md 单点维护，防漂移——code-reuse
# guide：契约容错逻辑两处复制 = 未来改动只落一处）；本文件只负责分节/
# 失败注明等预抓层语义。
from core.llms.tools.billions_search import _format_item as _format_search_item
from core.llms.tools.billions_twitter import _format_tweet as _format_tweet_item

_SEARCH_MODE = "fast"
_COUNT = 5
_TIME_RANGE = "past 3 months"

# 固定检索词（确定性预抓：每源固定 1 次，成本可预期）
_QUERY_TEMPLATES = {
    "announcement": "{} 最新公告",
    "report": "{} 券商研报",
    "web": "{} 最新新闻",
    "twitter": "{} 最新市场讨论",
}

# 确定性预抓的 search 源（顺序即报告分节顺序）与中文标签
_SEARCH_SOURCES = ["announcement", "report", "web"]
_SOURCE_LABELS = {"announcement": "公告", "report": "研报", "web": "新闻"}


def _collect_items(data: dict) -> list[dict]:
    """响应 result[].content[] 条目收集（非 dict 脏条目跳过，字段缺失容错）。"""
    items = []
    for entry in data.get("result") or []:
        if not isinstance(entry, dict):
            continue
        content = entry.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if isinstance(item, dict):
                items.append(item)
    return items


class BillionsInformationAnalyst:

    def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater=None, _client=None):
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="query"),
        ])

        self.prompt = self.prompt.partial(system_message=information_analyst_message)
        current_date = get_last_business_day(datetime.date.today())
        self.prompt = self.prompt.partial(current_date=current_date)
        self.llm = self.prompt | llm
        self.config = config
        self.progress_updater = progress_updater
        self._client = _client

    def _get_client(self):
        if self._client is None:
            from data_source.chinese_mainland.billions.client import BillionsClient

            self._client = BillionsClient()
        return self._client

    def _search_section(self, client, ticker: str, source: str) -> str:
        """单次 search 预抓 → 带来源标签的分节；失败/无有效条目 → 注明（不 raise）。"""
        try:
            data = client.search(
                _QUERY_TEMPLATES[source].format(ticker),
                source=source, search_mode=_SEARCH_MODE, count=_COUNT,
                time_range=_TIME_RANGE,
            )
        except Exception as exc:
            logger.warning("亿信 {} 检索失败（{}）: {}", source, ticker, exc)
            return f"【{_SOURCE_LABELS[source]}检索失败】{exc}"
        lines = []
        for item in _collect_items(data):
            line = _format_search_item(item)
            if line is not None:
                lines.append(line)
        if not lines:
            logger.warning("亿信 {} 检索成功但无有效结果: {}", source, ticker)
            return f"【{_SOURCE_LABELS[source]}无返回结果】"
        return f"【{_SOURCE_LABELS[source]}检索结果】\n" + "\n".join(lines)

    def _twitter_section(self, client, ticker: str) -> str:
        """单次 twitter 预抓 → 带来源标签的分节；失败/无有效条目 → 注明（不 raise）。"""
        try:
            data = client.twitter_search(
                _QUERY_TEMPLATES["twitter"].format(ticker),
                search_mode=_SEARCH_MODE, count=_COUNT,
            )
        except Exception as exc:
            logger.warning("亿信 twitter 检索失败（{}）: {}", ticker, exc)
            return f"【推特检索失败】{exc}"
        lines = []
        for item in _collect_items(data):
            line = _format_tweet_item(item)
            if line is not None:
                lines.append(line)
        if not lines:
            logger.warning("亿信 twitter 检索成功但无有效结果: {}", ticker)
            return "【推特无返回结果】"
        return "【推特检索结果】\n" + "\n".join(lines)

    def _prefetch(self, ticker: str) -> list[str]:
        """确定性预抓（固定次数，成本可预期）：按开关过滤源，失败源跳过。

        全部源关闭（SEARCH/TWITTER 均关）→ 返回空列表且不构造 client
        （节点在图中不存在的组合由 committee 接线保证；此处为健壮性兜底）。
        """
        search_on = billions_enabled("SEARCH")
        twitter_on = billions_enabled("TWITTER")
        if not (search_on or twitter_on):
            return []
        client = self._get_client()
        sections = []
        if search_on:
            for source in _SEARCH_SOURCES:
                sections.append(self._search_section(client, ticker, source))
        if twitter_on:
            sections.append(self._twitter_section(client, ticker))
        return sections

    def information_analyst(self, state: State):
        ticker = state['target_stock_ticker']
        safe_progress(self.progress_updater, "开始信息面素材检索。。。")
        sections = self._prefetch(ticker)
        if sections:
            context = "\n\n".join(sections)
        else:
            context = "（本次运行未检索到任何信息面素材：所有来源均不可用或未启用）"
        information_analyst_query = f"""
        请基于以下已检索到的信息面素材，给出你对股票代码{ticker}的信息面分析报告\n
        股票信息: \n
        {state['stock_information']}
        \n
        检索到的信息面素材: \n
        {context}
        """
        query = [("human", information_analyst_query)]
        logger.debug("Information Analyst Query: {}", information_analyst_query)
        safe_progress(self.progress_updater, "开始信息面分析报告生成。。。")
        response = invoke_with_retry(self.llm, {"query": query}, config=self.config)
        safe_progress(self.progress_updater, "信息面分析报告生成完成。。。")
        # 节点级即时填充（08-02-ui-live-progress-bridge）：见 fundamental
        push_report(self.progress_updater, "information_analysis", response.content)
        logger.debug("Information Analyst Response: {}", response.content)
        return {"messages": [query[0], response], "information_analysis": response.content}
