"""角色注册表（08-09-role-registry）——agent 名册的**单一事实源**。

State key / 图节点 / Tab 标题 / 启用谓词 / 装配工厂在此集中声明；图装配
（investment_committee.make_investment_committee）与 UI 渲染
（display.report_tabs/OPINION_REPORT_KEYS）都从本模块读取——新增 agent
只需加一条 Role 条目 + 一个 prompt，不再 4 处手工同步（此前：state.py /
committee 条件接线 / display Tab 契约 / spec 文档各一份）。

本模块保持纯数据 + 谓词：不 import streamlit/langgraph（边表用字符串
标记 START/END，装配处映射为 langgraph 常量，便于离线单测导出边集）；
agent 类引用集中在 ROLES 工厂——与 investment_committee 既有导入面
一致，无循环依赖（agents 不 import 本模块）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal, Optional

from agents.chinese_mainland.bearish_trader import BearishTrader
from agents.chinese_mainland.bullish_trader import BullishTrader
from agents.chinese_mainland.fundamental_analysis_expert import FundamentalAnalysisExpert
from agents.chinese_mainland.information_analyst import BillionsInformationAnalyst
from agents.chinese_mainland.investment_manager import InvestmentManager
from agents.chinese_mainland.technical_indicator_analyst import TechnicalIndicatorAnalyst
from agents.chinese_mainland.trend_analysis_expert import TrendAnalysisExpert
from core.llms.tools.web_search import web_search_enabled
from utils.billions_config import billions_cap_switch, billions_enabled

# 边表字符串标记（纯数据模块不 import langgraph；装配处映射 START/END）
START_MARKER = "START"
END_MARKER = "END"


def _always() -> bool:
    return True


def information_analyst_enabled() -> bool:
    """信息面分析师启用谓词（唯一单点，08-08 条件接线语义收敛于此）：
    ANALYST 能力开关开 且（SEARCH 或 TWITTER 至少一者开 或 联网搜索开）。

    ANALYST 段用 `billions_cap_switch`（无主闸 key 约束——08-10-web-
    search-fallback：无 BILLIONS_API_KEY 但联网搜索开 → 分析师注册，
    预抓走 DDG 兜底）；亿信路径仍受 key 硬约束（billions_enabled），
    联网路径只受 WEB_SEARCH_DISABLED 总闸（web_search_enabled）。
    Out of Scope 组合（ANALYST 开但亿信检索源与联网搜索均关）视为
    分析师不可用不注册——装配与 Tab 渲染共用同一谓词，谓词在调用时
    求值（与 web_search_enabled 图装配时判定同语义）。"""
    return billions_cap_switch("ANALYST") and (
        billions_enabled("SEARCH")
        or billions_enabled("TWITTER")
        or web_search_enabled()
    )


@dataclass(frozen=True)
class Role:
    """一条 agent 角色 = 装配/渲染所需的全部接线决策。

    - kind: expert（专家，START 并行）/ trader（多空交易员，N 入边
      join，派生对抗修订节点）/ manager（收尾，唯一）
    - opinion: 观点类 State key（add_messages 累积，UI 按轮次折叠渲染）
    - enabled: 启用谓词（装配时与渲染时各自调用时求值）
    - factory: (llm, config, progress_updater, tools) -> agent 实例——
      专家/经理忽略 tools（各 agent 构造签名差异收敛于此）
    """
    node_name: str
    kind: Literal["expert", "trader", "manager"]
    state_key: Optional[str] = None
    tab_title: Optional[str] = None
    opinion: bool = False
    enabled: Callable[[], bool] = _always
    factory: Optional[Callable] = None
    method_name: Optional[str] = None
    revise_node_name: Optional[str] = None

    @property
    def resolved_method(self) -> str:
        """节点方法名（缺省 = 节点名——现状 7 角色全部同名，防笔误）。"""
        return self.method_name or self.node_name

    @property
    def revise_method(self) -> str:
        """对抗修订节点方法名（= 修订节点名——现状方法名与节点名同
        名，与主节点约定一致）。"""
        return self.revise_node_name


def _expert_factory(cls: type) -> Callable:
    """专家构造器包装：签名 (llm, config, progress_updater)——无 tools。"""
    return lambda llm, config, progress_updater, tools=None: cls(
        llm, config, progress_updater)


def _trader_factory(cls: type) -> Callable:
    """交易员/经理构造器包装：签名 (llm, config, progress_updater, tools)。"""
    return lambda llm, config, progress_updater, tools=None: cls(
        llm, config, progress_updater, tools)


ROLES: tuple[Role, ...] = (
    Role(
        node_name="fundamental_analysis_expert",
        kind="expert",
        state_key="fundamental_analysis",
        tab_title="基本面分析",
        factory=_expert_factory(FundamentalAnalysisExpert),
    ),
    Role(
        node_name="trend_analysis_expert",
        kind="expert",
        state_key="trend_analysis",
        tab_title="趋势分析",
        factory=_expert_factory(TrendAnalysisExpert),
    ),
    Role(
        node_name="technical_indicator_analyst",
        kind="expert",
        state_key="technical_indicator_analysis",
        tab_title="技术指标分析",
        factory=_expert_factory(TechnicalIndicatorAnalyst),
    ),
    Role(
        node_name="information_analyst",
        kind="expert",
        state_key="information_analysis",
        tab_title="信息面分析",
        enabled=information_analyst_enabled,
        factory=_expert_factory(BillionsInformationAnalyst),
    ),
    Role(
        node_name="bullish_trader",
        kind="trader",
        state_key="bullish_opinions",
        tab_title="看涨观点",
        opinion=True,
        factory=_trader_factory(BullishTrader),
        revise_node_name="bullish_revise",
    ),
    Role(
        node_name="bearish_trader",
        kind="trader",
        state_key="bearish_opinions",
        tab_title="看跌观点",
        opinion=True,
        factory=_trader_factory(BearishTrader),
        revise_node_name="bearish_revise",
    ),
    Role(
        node_name="investment_manager",
        kind="manager",
        state_key="final_decision",
        tab_title="最终结论",
        factory=_trader_factory(InvestmentManager),
    ),
)


def enabled_roles() -> tuple[Role, ...]:
    """启用角色（谓词调用时求值；装配方调用一次，节点/边共用同一集合）。"""
    return tuple(r for r in ROLES if r.enabled())


def report_roles(roles: Optional[tuple[Role, ...]] = None) -> tuple[Role, ...]:
    """报告类角色（有 State key + Tab 标题）——UI 渲染契约的权威列举。

    :param roles: 角色集合（缺省 = enabled_roles()）；顺序即 Tab 顺序。
    """
    selected = roles if roles is not None else enabled_roles()
    return tuple(r for r in selected if r.state_key is not None and r.tab_title is not None)


def build_node_names(roles: tuple[Role, ...]) -> list[str]:
    """装配节点名列表（纯函数，装配与单测共用）：专家 + 交易员 +
    交易员派生 revise + 经理。"""
    names = [r.node_name for r in roles if r.kind in ("expert", "trader")]
    names.extend(r.revise_node_name for r in roles if r.kind == "trader")
    names.append(next(r.node_name for r in roles if r.kind == "manager"))
    return names


def build_edges(roles: tuple[Role, ...]) -> list[tuple[str, str]]:
    """装配边表（纯函数，装配与单测共用）——固定 4 阶段形状：

    START → 专家∥ → 交易员（N 入边 join）→ 对抗修订（双入边 join）→
    经理 → END。START/END 为字符串标记，装配处映射为 langgraph 常量。
    """
    experts = [r for r in roles if r.kind == "expert"]
    traders = [r for r in roles if r.kind == "trader"]
    manager = next(r for r in roles if r.kind == "manager")
    edges = [(START_MARKER, r.node_name) for r in experts]
    for trader in traders:
        edges.extend((expert.node_name, trader.node_name) for expert in experts)
    for trader in traders:
        edges.extend((t.node_name, trader.revise_node_name) for t in traders)
    for trader in traders:
        edges.append((trader.revise_node_name, manager.node_name))
    edges.append((manager.node_name, END_MARKER))
    return edges
