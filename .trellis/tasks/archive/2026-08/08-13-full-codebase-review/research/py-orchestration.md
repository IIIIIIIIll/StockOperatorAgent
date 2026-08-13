# py-orchestration 审查报告

审查范围：Python 图编排/注册表/入口 —— `core/role_registry.py`、`core/investment_committee.py`、`main.py`，并对照 `test/core/test_role_registry.py` 双向契约与 spec（core/index.md、core/investment-committee.md、agents/index.md）。

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|core/role_registry.py|200|有发现（INFO ×1；另 1 处与 display 联合的 INFO 见下）|
|core/investment_committee.py|185|无发现|
|main.py|27|有发现（INFO ×1）|
|test/core/test_role_registry.py|288|无发现（契约被实现逐条满足，见下核对）|
|交叉验证（只读引用，非本片分配）：utils/state.py、core/ui/display.py、agents/base.py、agents/chinese_mainland/*（7 个）、core/llms/tool_loop.py、utils/billions_config.py、core/llms/tools/{web_search,billions_fin_db,get_company_info}.py|—|用于核对跨文件契约，见「关键契约核对」|

## 发现

### [INFO] `report_roles()` 与 `display.report_tabs()` 重复实现同一过滤谓词（单一事实源未完全收敛）
- **位置**: core/role_registry.py:165-171（对照 core/ui/display.py:44-52）
- **问题**: `report_roles` 文档自称「UI 渲染契约的权威列举」，但唯一 UI 消费者 `display.report_tabs()` 并未调用它，而是内联重写同一过滤条件。当前两处逐字节一致（无行为差异），但过滤逻辑存在两份拷贝——这正是 08-09-role-registry 想消灭的多点同步问题：未来若给报告角色过滤加约束（隐藏 key、排序规则等），两处可能漂移，且 `report_roles` 的「权威列举」定位名不副实（生产代码零调用，仅测试消费）。
- **证据**:
  - role_registry.py:171: `return tuple(r for r in selected if r.state_key is not None and r.tab_title is not None)`
  - display.py:48-52: `return tuple((r.state_key, r.tab_title) for r in enabled_roles() if r.state_key is not None and r.tab_title is not None)`
- **建议**: `display.report_tabs()` 改为基于 `report_roles()` 派生（缺省 = `enabled_roles()`，行为逐字节不变）；或删除 `report_roles` 的生产导出、降级为测试辅助并同步文档注释。注意 display.py 属 UI 分片，修复需与 PyUi 分片协同。
- **spec 对照**: agents/index.md「Tab 标题与启用谓词的**单一事实源**是 core/role_registry.py」——数据源已收敛，过滤谓词未完全收敛（轻微偏离）。

### [INFO] `main.py` 模块顶层 `logger.info("Starting...")` 每次 Streamlit rerun 重复落盘
- **位置**: main.py:22
- **问题**: Streamlit 每次交互（提交表单/切换 Tab）重新执行 main.py 顶层代码，此模块级日志每次 rerun 追加一条「Starting the Stock Analysis Application」——对日志消费者误导为进程重启。与同文件 08-02 的 handler 幂等修复（防 handler 重复，main.py:15-20）不对称：handler 层面做了幂等，消息本身未做。
- **证据**: main.py:21-23
  ```
  _ensure_file_handler()
  logger.info("Starting the Stock Analysis Application")
  load_dotenv()
  ```
- **建议**: 移入 `main()`（每进程启动打一次）或降为 `logger.debug`。
- **spec 对照**: 无直接条款；日志路径锚定（LOG_DIR）与 handler 幂等符合 core/index.md 约定（本行仅日志文案噪声，不影响正确性）。

## 关键契约核对（防假阳性清单，全部通过）

1. **ROLES 单一事实源**（role_registry.py:63-140）：node_name/state_key/tab_title/kind/opinion/enabled/factory/revise_node_name 齐备；信息面分析师启用谓词单点定义（role_registry.py:31-36，ANALYST 开关 + SEARCH/TWITTER/联网搜索）。
2. **委员会/display 无手写条件接线**：`make_investment_committee` 只调 `enabled_roles()` 一次求值（investment_committee.py:115），节点/边全部由 ROLES + `build_edges` 生成（:113-149），无任何 `information_analyst`/`ANALYST` 字面条件块；display.report_tabs 同样从 `enabled_roles()` 读（display.py:44-52）——条件节点与 Tab 启用谓词共用注册表 ✓。
3. **build_stock_information 调用点**：`get_stock_info` 唯一调用点 investment_committee.py:53（图构建之外）；display.py:415 与 make_investment_decision（:179）共用同一组装点；图内无 `get_stock_info`（grep 全仓生产代码确认）✓。
4. **tools 第 4 参**：trader/manager 工厂收 tools（investment_committee.py:121-124、134-135），专家收 None（:118）——与各 agent 构造签名逐一核对匹配（专家无 tools 参、trader/manager 有 tools 参）；information_analyst 不需要 committee 传 tools（DDG 回退自建 `make_web_search_tool(_searcher=...)` 懒加载，information_analyst.py:88-95）✓。
5. **opinions reducer [-1].content**：investment_manager 读 `state['bullish_opinions'][-1].content` / `bearish_opinions[-1].content`（investment_manager.py:20-21）；revise 读各自初稿 [-1]（bullish/bearish_trader.py:48 注释 + 实现）——与 agents spec 契约一致 ✓。
6. **test/core/test_role_registry.py 双向契约被实现满足**（逐条核对）：
   - State 报告 key 双向覆盖：`State.__annotations__` 报告类 7 key == ROLES 注册 7 key（utils/state.py:7-14 vs role_registry.py:66-136，infra 三 key 正确剔除）✓
   - 图形状冻结：`build_node_names`/`build_edges` 两形态逐节点/逐边展开核对 == `_BASE_NODES`/`_ANALYST_NODES`/`_BASE_EDGES`/`_ANALYST_EDGES`（8/9 节点、16/19 边）✓
   - Tab 顺序：`report_roles(ROLES)` == `_EXPECTED_KEYS`/`_EXPECTED_TITLES`（顺序即 ROLES 声明序）✓
   - opinion 标志：ROLES opinion key == display.OPINION_REPORT_KEYS ✓
   - 谓词真值表：`information_analyst_enabled`（ANALYST ∧（SEARCH ∨ TWITTER ∨ web））与 utils/billions_config.py 语义逐字核对——`billions_cap_switch` 无 key 硬约束、`billions_enabled` 有 key 约束、`web_search_enabled` 负极性（WEB_SEARCH_DISABLED）——测试 8 组真值全部与实现一致 ✓
7. **thread_id "1" 复用安全性（重点假阳性排查，结论：无害）**：`make_investment_committee` 每次调用**新建** `InMemorySaver()`（investment_committee.py:109），display 路径（display.py:455）与 make_investment_decision（:172-174）每次分析都重建图 → 每次分析独立 checkpointer，reducer 通道（messages/bullish_opinions/bearish_opinions）**不会跨分析累积**；且 agents 不读 state['messages']（base.py 的 complete_expert/complete_with_tools 均以本地构建的 query 调 LLM），无提示词污染面。固定 thread_id 仅满足 langgraph 线程要求，无状态泄漏。
8. **亿信 FINDB 关零行为变化**：`build_stock_information` 无条件调用 `_billions_intel`（investment_committee.py:73-74），但真实现首行 `if not billions_enabled("FINDB"): return ""`（billions_fin_db.py:59-60）→ 段自然不出现；progress 提示仅在开关开时输出（investment_committee.py:70-72）✓。
9. **亿信工具三件套**：`make_billions_*_tool()` 工厂关 → None 不绑定（investment_committee.py:99-106），与 spec「未配置 BILLIONS_API_KEY 时 tools 与现状逐字节一致」一致 ✓。

## spec 符合性结论

本层整体**符合**：注册表驱动图装配（8/9 节点、16/19 边、4 阶段形状）、build_stock_information 唯一组装点（图外调用）、tools 第 4 参、[-1].content 读取、条件节点接线与 Tab 谓词共用注册表单点、test_role_registry 双向契约——全部满足，无 CRITICAL/WARNING。仅两处 INFO：① `report_roles` 与 display.report_tabs 的过滤谓词重复实现（单一事实源未完全收敛，数据源已收敛）；② main.py 顶层启动日志每次 rerun 重复落盘（handler 已幂等、消息未幂等）。
