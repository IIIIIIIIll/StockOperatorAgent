# 设计：角色注册表（State key / 图节点 / Tab 单一事实源）

## 架构与边界

```
core/role_registry.py（新建，纯数据 + 谓词，不 import Streamlit/LangGraph）
    Role: frozen dataclass —— 一条角色 = 节点名/State key/Tab 标题/kind/
                            opinion/启用谓词/工厂/方法名
    ROLES: tuple[Role, ...] —— 全量名册（顺序 = Tab 顺序 + 装配顺序）
    enabled_roles() / report_roles() —— 过滤 helper（谓词调用时求值）

消费方改造（行为逐字节不变）：
    core/investment_committee.py  make_investment_committee —— 装配循环化
    core/ui/display.py            report_tabs()/OPINION_REPORT_KEYS —— 注册表驱动
    utils/state.py                TypedDict 保持静态显式（见 R4 一致性单测）
```

- 注册表是**装配与渲染**的驱动，不是运行时动态 State——`State` TypedDict
  仍手写，一致性由单测断言（注册表 key ⊆ State 注解键）
- 每个 agent 类/构造器保持不变（本任务不碰 agent 文件——那是
  `agent-base-class` 子任务）；注册表只把「接线决策」数据化

## Role 条目与语义

```python
@dataclass(frozen=True)
class Role:
    node_name: str                  # 图节点名（= 节点方法名，沿用现状约定）
    kind: Literal["expert", "trader", "manager"]
    state_key: str | None           # 报告类角色有；非报告角色 None
    tab_title: str | None           # 报告类角色有
    opinion: bool = False           # 观点类 key（渲染轮次折叠语义）
    enabled: Callable[[], bool] = _always
    factory: Callable               # (llm, config, progress_updater, tools) -> 实例
    method_name: str | None = None  # 节点方法名（缺省 = node_name）
```

名册（顺序即 Tab 顺序与装配顺序，与现状逐字节一致）：

| node_name | kind | state_key | tab_title | opinion | enabled |
|---|---|---|---|---|---|
| fundamental_analysis_expert | expert | fundamental_analysis | 基本面分析 | | always |
| trend_analysis_expert | expert | trend_analysis | 趋势分析 | | always |
| technical_indicator_analyst | expert | technical_indicator_analysis | 技术指标分析 | | always |
| information_analyst | expert | information_analysis | 信息面分析 | | `billions_enabled("ANALYST") and (billions_enabled("SEARCH") or billions_enabled("TWITTER"))`（唯一谓词，装配与 Tab 共用——08-08 的条件接线语义收敛于此） |
| bullish_trader | trader | bullish_opinions | 看涨观点 | ✓ | always |
| bearish_trader | trader | bearish_opinions | 看跌观点 | ✓ | always |
| investment_manager | manager | final_decision | 最终结论 | | always |

revise 节点**不单独注册**：由 trader 角色派生（现状 1 trader ↔ 1 revise 的
固定模式）——`node_name + "_revise"`、`method_name + "_revise"`、复用同一
实例。装配期 trader 实例创建一次，两个节点方法都从该实例取。

## 图装配算法（make_investment_committee）

```
roles = [r for r in ROLES if r.enabled()]        # 谓词装配时求值一次
experts / traders / manager = 按 kind 分组
tools 构建（web_search + 亿信三件套，逻辑不变）
revise_nodes = [f"{t.node_name}_revise" for t in traders]

for r in experts:  instance = r.factory(llm, config, progress_updater, None)
                   add_node(r.node_name, getattr(instance, r.method_name or r.node_name))
                   add_edge(START, r.node_name)
for t in traders:  instance = t.factory(llm, config, progress_updater, tools)
                   add_node(t.node_name, getattr(instance, ...))
                   for e in experts: add_edge(e.node_name, t.node_name)   # N 入边 join
for t in traders:  add_node(t.revise_node, getattr(trader_instance, t.method_name + "_revise"))
for rv in revise_nodes:
    for t in traders: add_edge(t.node_name, rv)   # 双入边 join（现状 2×2）
mgr = manager[0].factory(llm, config, progress_updater, tools)
add_node(mgr.node_name, ...)
for rv in revise_nodes: add_edge(rv, mgr.node_name)
add_edge(mgr.node_name, END)
```

- 边集与现状精确一致：基础 16 边（3 START + 6 专家→trader + 4 trader→
  revise + 2 revise→manager + 1 END）、ANALYST 开 19 边；8/9 节点
- `load_dotenv()`、`_llm` 注入点、checkpointer 保持原位；装配顺序 =
  注册表顺序（fundamental → trend → technical → information → bullish →
  bearish → manager → revises）——节点 add 顺序不构成 LangGraph 语义
- revise 节点注册移到 trader 循环后（现状在 :161-162 已如此，行为无差）

## UI 渲染契约（display.py）

- `report_tabs()` = `[(r.state_key, r.tab_title) for r in ROLES if r.state_key and r.enabled()]`
  ——信息面分析师谓词开 → 第 4 位（index 3），关 → 六 Tab 与现状逐字节
  一致（AC1/AC3，注册表顺序天然复现 `_BASE_REPORT_TABS.insert(3, ...)`）
- `OPINION_REPORT_KEYS = {r.state_key for r in ROLES if r.opinion}`
- `iter_report_items` / `report_tabs_map` / 轮次计数 / 去重逻辑**零改动**
  （它们消费 report_tabs() 的返回值，接口不变）
- `DATA_TAB_TITLE` 不是角色——留在 display.py，不进注册表

## 一致性单测（新增 test/core/test_role_registry.py）

1. `{r.state_key for r in ROLES if r.state_key}` ⊆ `State.__annotations__`
   ——注册表与 State 契约钉死
2. `report_tabs()` 两种开关形态 == 冻结的旧元组（ANALYST 开/关各一份
   expected，防 Tab 顺序回归）
3. `enabled_roles()` 两形态数量 == (8, 9) 节点、(16, 19) 边——边数由
   装配生成逻辑的纯函数（`_build_edges(roles) -> list[tuple]`）导出并
   断言（纯函数导出边集，离测试图组件）
4. 谓词单点：`Role.enabled` 与旧 `information_analyst_enabled` 表达式
   等价（三态 env 快照下同一真值）

## 兼容与风险

- **零行为变化验证**：现有 integration（join/并行）与 display 单测全绿
  = 等价证明；不动 agent 类、不动 prompt、不动 State 语义
- **谓词求值时机**：装配一次（committee），渲染每次调用（display）——
  与现状一致；session 级覆盖在表单提交时已写入，rerun 内不会漂移
- **已知差异**：`_BASE_REPORT_TABS` 常量删除（display 内部私有名，无
  外部消费者——grep 确认后移除）；spec 中「15 边」计数与现状 16 边不符，
  以代码为准并同步 spec
- **不做**：agent 基类（子任务 2）、动态 TypedDict、Tab 顺序可配置化
