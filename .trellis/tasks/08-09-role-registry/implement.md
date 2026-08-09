# 执行：角色注册表（State key / 图节点 / Tab 单一事实源）

> 复杂任务三件套齐备（prd.md / design.md / implement.md）→ 可走
> `task.py start` 评审门。实现走主会话 inline（Claude Code CLI 为 inline
> 平台，phase 1.3 说明跳过 implement.jsonl/check.jsonl 编排清单）。

## 执行顺序（每步后跑对应验证门，全绿再下一步）

### Step 1 — 注册表模块 `core/role_registry.py`（新建，纯数据）

- `Role` frozen dataclass + `_always` 默认谓词 + `enabled_roles()` /
  `report_roles()` 过滤 helper（谓词调用时求值）
- `ROLES` 名册 7 条（design.md 表格）；工厂 = lambda 包装各 agent 构造器
  （统一签名 `(llm, config, progress_updater, tools)`——专家忽略 tools）
- 谓词：`information_analyst_enabled()` 单点定义（
  `billions_enabled("ANALYST") and (billions_enabled("SEARCH") or
  billions_enabled("TWITTER"))`，从 investment_committee.py:141-144 迁入）
- **模块零副作用**：不 import streamlit/langgraph/agent 类（工厂 lazy 引用
  或类型标注用 TYPE_CHECKING）——纯数据模块可被离线单测与两消费方导入
- 验证门 1：`pytest test/core/test_role_registry.py`（先写 4 条一致性
  单测，见 design.md）——红（装配未改）→ 绿（Step 2/3 后）

### Step 2 — 图装配改造 `core/investment_committee.py`

- `make_investment_committee` 按 design.md 算法循环化：roles 过滤一次 →
  专家/交易员/经理分组 → 节点+边生成；revise 由 trader 派生
- 保留：`load_dotenv()`、`_llm` 注入点、`InMemorySaver`、tools 构建
  （web_search 开关 + 亿信三件套 None 过滤 → `tools = None` 语义）
- 删除：4 份 `if information_analyst_enabled:` 条件块与手写边表
- 验证门 2：`pytest test/integration/test_graph_parallel.py
  test/integration/test_basic_graph.py test/integration/test_investment_committee.py -v`
  全绿（join/并行语义钉死）；Step 1 新单测转绿

### Step 3 — UI 契约改造 `core/ui/display.py`

- `report_tabs()` 改注册表驱动（顺序 = ROLES 顺序）；`OPINION_REPORT_KEYS`
  派生；删除 `_BASE_REPORT_TABS`（先 grep 确认无外部消费者）
- `iter_report_items` / `report_tabs_map` / 渲染循环 / 轮次计数**零改动**
- 验证门 3：`pytest test/core/ui/test_display.py test/e2e/ -v`（mock 模式
  秒级）全绿——ANALYST 开/关两种 Tab 形态的 e2e 断言即行为等价证明

### Step 4 — 全量回归 + 收尾

- `pytest` 全量（unit + integration + e2e mock）绿；父任务 Cross-Child
  AC 1-4 逐条过
- spec 更新（trellis-update-spec）：agents/index.md「The State Contract」
  「Node names…must stay in sync」节 → 指向 role_registry；core/index.md
  「InvestmentCommittee」节描述装配循环化；「15 边」计数修正为 16/19
- 提交（Phase 3.4）+ 归档（父任务复核后）

## 验证命令速查

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-09-role-registry   # 评审通过后
pytest test/core/test_role_registry.py -v                                      # Step 1 后
pytest test/integration/ -v                                                    # Step 2 后
pytest test/core/ui/test_display.py test/e2e/ -v                               # Step 3 后
pytest                                                                          # Step 4 全量
```

## 回滚点

- 每步独立可回滚：Step 2/3 为行为等价替换，回滚 = `git revert` 该步提交
  （无 schema/数据迁移，ZODB 不触碰）
- 若 integration 或 e2e 出现非断言性失败 → 停下对照现状实现 diff，不
  带病前进（错误-handling spec：先根因后修复）
