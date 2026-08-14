# 分片 1：Python 编排/入口面 → TS 功能差距审计（py-orchestration）

> 审计日期：2026-08-14 ｜ 分片认领：Slice1Orchestration
> 只读审计，零业务代码改动。报告语言：中文（符号/术语可英文）。
> 状态分级：FULL / PARTIAL / MISSING / BY_DESIGN；阻断：BLOCKER / NON_BLOCKER。

---

## ① 认领文件清单（确认逐文件读过）

**Python 侧（本片认领，逐文件通读）**

| 文件 | 行数 | 读法 |
|---|---|---|
| `main.py` | 31 | 全文 raw 读 |
| `core/investment_committee.py` | 186 | 全文 raw 读 + 行号复核 |
| `core/role_registry.py` | 200 | 全文 raw 读 + 行号复核 |

**TS 对照面（跨片只读引用，逐文件通读）**

| 文件 | 说明 |
|---|---|
| `ts/src/committee.ts` | 角色注册表 + 图装配 + State 注解（全文 raw 读，160 行） |
| `ts/src/events.ts` | PipelineEvent + createPipelineRunner（全文 raw 读，161 行） |
| `ts/app/App.tsx` | 根组件/入口接线（全文 raw 读，417 行） |
| `ts/app/lib/runner.ts` | App↔业务层唯一接线点（全文 raw 读，178 行） |
| `ts/src/gates.ts` | 结论：**与角色开关无关**（详见下） |

**辅助引用（证据用，跨片只读）**：`ts/src/pipeline.ts`（buildStockInformation）、`ts/src/progress.ts`（ProgressUpdater/safePush*）、`ts/src/webSearch.ts`、`ts/src/billionsTools.ts`、`ts/src/log.ts`、`ts/app/lib/settings.ts`、`ts/src/llm.ts`、`ts/test/committee.test.ts`、`ts/tools/probe.mts`、`utils/state.py`、`utils/billions_config.py`、`core/llms/progress.py`、`core/ui/display.py`（入口/事件消费对照）、`core/llms/tools/web_search.py`、`agents/base.py`。

**gates.ts 核对结论**：`ts/src/gates.ts` 内容为数据新鲜度门（`asiaToday`/`getLastBusinessDay`/`overviewNeedsRefresh`/`latestPastQuarterEnd`/`reportsFresh`/`FetchScope`，gates.ts:1-89），无任何 ROLES/角色开关引用。角色开关的 TS 实现位于 `committee.ts`（`envDisabledBool`/`billionsEnabled`/`informationAnalystEnabled`，committee.ts:30-48）与 `settings.ts`（`applySwitchesToEnv`，settings.ts:106-114）。gates.ts 不在本片角色开关对照范围内。

---

## ② 功能点差距表

### 2.1 main.py（Streamlit 入口）

| # | 功能点（Python file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| M1 | `_ensure_file_handler()`：loguru 文件 handler 幂等注册，路径锚定仓库根 `logs/stock_operator_agent.log`，`enqueue=True`、`rotation="50 MB"`、`retention=10`（main.py:16-23） | `ts/src/log.ts` 环境感知多 transport（web：console + POST 同源 `/logs`；RN：console + expo-file-system 沙盒文件 5MB 轮转 `.1` 备份；Node：console，log.ts:44-151）+ `ts/app/lib/logs-server.cjs`（服务端汇聚落盘，见 ts/index.md「同源代理」节） | FULL | 功能等价（统一日志出口 + 落盘 + 轮转）。差异：① 轮转参数不同（Python 50MB × 10 份 vs TS RN 5MB × 1 份 `.1`；服务端日志轮转在 logs-server.cjs，非本片文件）；② Python 的「Streamlit rerun 幂等注册」问题在 TS 不存在（React 无 rerun 模型，模块级单例天然幂等，log.ts:135-144）。均为机制差异，无能力缺失 | NON_BLOCKER |
| M2 | 启动日志 `logger.info("Starting the Stock Analysis Application")`（main.py:25） | `App.tsx:69` `info('应用启动:TS 版投资委员会(web)')`（+ `ts/app/lib/log.ts` 重导出） | FULL | 语义对齐（应用启动日志）；文案不同，无行为差异 | NON_BLOCKER |
| M3 | `load_dotenv()`（main.py:26）：启动时把 `.env` 读入 `os.environ` | ① `settings.ts:80-82` `loadSettings` 对 `EXPO_PUBLIC_LLM_*` env 兜底（settings.ts:60-83，注释「对齐 Python 读 .env 的配置语义」）；② Node server 侧 .env 由启动命令/服务端加载（server.mjs，非本片文件） | FULL | 机制不同但配置面等价：Python 进程内读 `.env`；TS web 端为构建期注入（EXPO_PUBLIC_*）+ localStorage 设置；Node 端仍走 .env。web 端密钥存储位置不同（localStorage vs .env）属设计决策（ts/index.md「能力接线」节：key 在 web 端 localStorage） | NON_BLOCKER |
| M4 | `main()` → `write_ui()`（main.py:28-31）：Streamlit 应用入口，顶层调用 | `App.tsx` 根组件（App.tsx:60 起）+ 入口副作用 useEffect（App.tsx:68-86：loadDemoData、loadSettings、LLM 三键告警、`setDataVersion`） | FULL | 入口职责对齐（初始化数据/设置 → 渲染 UI）。差异：Python 为脚本 rerun 模型（每次交互重执行 main.py 顶层，含 M1 幂等保护）；TS 为 React 状态驱动单次挂载。框架级差异，可观察行为等价 | NON_BLOCKER |
| M4a | 标题/页面配置（`display.py:366-368` 引用：`st.set_page_config` + `st.title`） | `App.tsx:231-236` header（`THEME_HEADING` + 副标题）+ `ts/app/theme.ts` | FULL | 见 slice 5（py-ui）细节；本片仅核对入口存在 | NON_BLOCKER |
| M4b | ticker 表单 + 六位数字校验（`display.py:386` 引用：`st.error("请输入有效的六位数字股票代码")`） | `App.tsx:147-152`：`/^\d{6}$/` + 同文案 error | FULL | 校验规则与错误文案对齐 | NON_BLOCKER |
| M4c | 北交所拦截（`display.py:387-388` 引用：`is_bj_ticker` → `st.error` BJ 提示；API 路径另有 `get_company_info.py:11-15` raise 明确中文错误） | `App.tsx:153-156`：`code.startsWith('4') \|\| code.startsWith('8')` → 同文案 error | BY_DESIGN | 北交所明确不支持（用户决策 08-13，出处：ts/index.md「能力接线」节「北交所/akshare：明确不支持（用户决策 08-13），App.tsx 入口拦截报错」）。**差异注记**：Python 在**API 路径**（get_company_info）也有 BJ 显式 raise，TS 仅 UI 入口拦截；`runner.run`/`buildStockInformation` 直调 BJ 代码无前置守卫（grep `ts/src` 无 BJ 检查，仅有 App.tsx:153）。需人工确认：TS headless 路径是否需要 Python 同款 API 层 BJ 报错 | NON_BLOCKER |
| M4d | 主 Tab 条 `[采集数据] + report_tabs()`（`display.py:406-408` 引用） | `App.tsx:239-242`：`[{ id: 'data', label: '采集数据' }, ...roles.map(...)]`，`roles = reportRoles()`（App.tsx:66） | FULL | Tab 顺序契约一致（注册表驱动，见 §2.2 功能点 R8） | NON_BLOCKER |
| M4e | LLM 三键门控（`display.py:24-31` 引用：`_llm_configured` 三键齐 → 放行，否则 `st.error` 返回、**不运行**） | `App.tsx:130-133` gateNotice（三键缺 → 提示「将使用演示占位报告」）+ `runner.ts:75-113` `demoLlm` 演示 stub + `runner.ts:121-124` `configError` | FULL | **行为差异（TS 增强）**：Python 缺键 → 阻断分析；TS 缺键 → 用演示 stub LLM 跑通全图产出占位报告（runner.ts:75 注释「演示 stub LLM(无三键时;按 system 消息路由角色)」）。门控能力 TS 完整覆盖且增加 demo 模式，属 TS 侧设计决策。三键判定语义对齐：`settings.ts:122-124` `llmConfigured` = 三键非空，与 Python `_llm_configured` 同契约 | NON_BLOCKER |
| M4f | 设置面板四节（模型密钥/LangSmith/能力开关/调用上限，`display.py:235-358` 引用；会话级覆盖经 `set_runtime_overrides`，持久化经 `update_env_file`） | `App.tsx:284-291` 侧边栏 `SettingsPanel` + `settings.ts`（四节同构；开关经 `applySwitchesToEnv` 写 process.env，settings.ts:106-114；持久化经 localStorage，settings.ts:44-52,83-86） | FULL | 功能面等价（详见 slice 5/8）。机制差异：Python 会话覆盖层（`utils/runtime_config.py`）→ TS 直接写 `process.env`（DISABLED 语义，消费点 `committee.envDisabledBool`/`webSearchEnabled` 同判定，settings.ts:105 注释）。行为等价（两处开关面板均驱动同一批消费点） | NON_BLOCKER |
| M4g | 事件/流式渲染（`display.py:479-520` 引用：队列消费 progress/report/error/done，观点轮次折叠） | `App.tsx:89-121` runner.subscribe（progress/token/roleStatus/report 清 partial/done/error）+ `App.tsx:299-333` 状态条/进度条/ReportContent | FULL | Python 事件面（progress/report/error/done 四型）全部覆盖；token/roleStatus 为 TS 08-11-ts-streaming-output 新增（Python 无流式 token，属方案 B 设计决策，出处 ts/index.md「流式输出」节）。详见 §2.3 功能点 C11 | NON_BLOCKER |

### 2.2 core/role_registry.py（角色注册表）

| # | 功能点（Python file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| R1 | `START_MARKER`/`END_MARKER` 字符串边表标记（role_registry.py:31-32） | `buildEdges` 内字面 `'START'`/`'END'`（committee.ts:83-99）+ 装配处映射常量（committee.ts:140-142） | FULL | 纯数据模块不 import langgraph 的约束在 TS 侧同样成立（边表函数本身用字符串，与顶层 import 无关） | NON_BLOCKER |
| R2 | `_always()` 恒真谓词（role_registry.py:35-36） | `() => true` 内联（committee.ts:57-69 各常开角色 enabled） | FULL | 等价 | NON_BLOCKER |
| R3 | `information_analyst_enabled()`：`billions_cap_switch("ANALYST") ∧ (billions_enabled("SEARCH") ∨ billions_enabled("TWITTER") ∨ web_search_enabled())`（role_registry.py:39-55；亿信路径受 `BILLIONS_API_KEY` 主闸 key 硬约束，utils/billions_config.py:58-63,70-86） | `informationAnalystEnabled()`：`billionsEnabled('ANALYST') ∧ (billionsEnabled('SEARCH') ∨ billionsEnabled('TWITTER') ∨ webSearchEnabled())`（committee.ts:43-48） | **PARTIAL** | 公式同形，但**TS `billionsEnabled` 无主闸 key 约束**（committee.ts:36-40 仅查 `BILLIONS_DISABLED`/`BILLIONS_{CAP}_DISABLED`；key 判定被显式下沉到工具工厂单点 `billionsTools.ts:150-157` `billionsCapEnabled` 与 `makeBillionsIntel`）。**具体差异场景**：`BILLIONS_API_KEY` 缺失 + 联网搜索关（WEB_SEARCH_DISABLED 开）+ SEARCH/TWITTER env 开关开 → Python 不注册分析师（亿信路径 key 硬约束、联网路径关）；TS 注册（无 key 约束）。committee.ts:44-47 注释承认「TS billionsEnabled 无 key 约束（现状），分析师默认 env 恒注册」——注册**谓词**的 key 约束未移植，key 约束改由工具绑定层承担。可观察影响：该组合下 TS 多出「信息面分析」Tab（Python 无）。**需人工确认**是否接受该注册面差异（TS 行为为超集，未丢 Python 能力） | NON_BLOCKER |
| R4 | `Role` dataclass：node_name/kind/state_key/tab_title/opinion/enabled/factory/method_name/revise_node_name + `resolved_method`/`revise_method` 属性（role_registry.py:57-87） | `Role` interface：nodeName/kind/stateKey/tabTitle/opinion/enabled/factory/reviseNodeName（committee.ts:15-26） | FULL | **扩展点注记**：TS 无 `method_name`/`resolved_method` 覆盖字段——节点方法名硬编码 `agent[role.nodeName]`（committee.ts:134-135），依赖「方法名 == 节点名」约定。Python 注释明确现状 7 角色全部同名（role_registry.py:80），`method_name` 覆盖能力当前零使用 → 行为完全等价，仅丢失未使用的扩展点。TS 侧 `Role.enabled` 为必填（无 `_always` 默认），各常开角色显式 `() => true`，等价 | NON_BLOCKER |
| R5 | `_expert_factory`/`_trader_factory` 构造器包装（role_registry.py:90-99）：专家忽略 tools、trader/manager 收 tools | `expert`/`trader` AgentFactory 包装（committee.ts:50-54） | FULL | 签名形状一致 `(llm, config, progress, tools)`，专家忽略 tools | NON_BLOCKER |
| R6 | `ROLES` 7 条角色名册（role_registry.py:102-157） | `ROLES` 7 条（committee.ts:57-69） | FULL | 字段逐一对齐：节点名（fundamental_analysis_expert/trend_analysis_expert/technical_indicator_analyst/information_analyst/bullish_trader/bearish_trader/investment_manager）、kind、stateKey、tabTitle（基本面分析/趋势分析/技术指标分析/信息面分析/看涨观点/看跌观点/最终结论）、opinion（bullish/bearish）、reviseNodeName（bullish_revise/bearish_revise）、enabled 谓词（仅 information_analyst 条件，其余恒真）、factory 类引用（7 agent 类同名导入，committee.ts:7-11 vs role_registry.py:20-26） | NON_BLOCKER |
| R7 | `enabled_roles()`：谓词调用时求值，装配方调用一次节点/边共用（role_registry.py:160-162） | `enabledRoles()`：`ROLES.filter(r => r.enabled())`（committee.ts:67-69） | FULL | 语义一致；TS 消费点（events.ts:82-96 pushReport/pushDelta/pushStatus 查表、App.tsx:92-104 事件时刻求值）均在调用时求值，与 Python「装配/渲染各自求值」契约一致 | NON_BLOCKER |
| R8 | `report_roles(roles=None)`：有 state_key 且 tab_title 的角色，顺序即 Tab 顺序（role_registry.py:165-171） | `reportRoles(roles?)`：`selected.filter(r => r.stateKey !== undefined && r.tabTitle !== undefined)`（committee.ts:71-74） | FULL | 过滤条件、缺省参数、顺序语义一致 | NON_BLOCKER |
| R9 | `build_node_names(roles)`：专家+交易员节点 + 交易员 revise + 经理（role_registry.py:174-180） | `buildNodeNames(roles)`（committee.ts:76-81） | FULL | 逻辑逐行等价（含 manager 必存在假设：Python `next(...)` 缺 manager 抛 StopIteration vs TS 非空断言 `!`，等价错误面） | NON_BLOCKER |
| R10 | `build_edges(roles)`：4 阶段固定形状 START→专家∥→交易员(N 入边 join)→对抗修订(双入边 join)→经理→END（role_registry.py:183-200） | `buildEdges(roles)`（committee.ts:83-99） | FULL | 边集逐行等价（专家×交易员全连接、交易员相互连接双方 revise、revise→经理、经理→END）。TS 侧单测钉死两形态：`ts/test/committee.test.ts:87-94`（9 节点 19 边，分析师开）、`:96-103`（8 节点 16 边，分析师关），与 Python `test_role_registry.py` 冻结期望同构 | NON_BLOCKER |

### 2.3 core/investment_committee.py（委员会图 + 入口）

| # | 功能点（Python file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| C1 | `build_stock_information(target_ticker, progress=None, _billions_intel=None)`：图前 enrichment 五段拼接（个股信息 → 技术指标 → 财务指标 → 实时情报 → 亿信；唯一组装点，display 与 make_investment_decision 共用）（investment_committee.py:23-75） | `buildStockInformation(ticker, deps)`（pipeline.ts:178-213） | FULL | 五段顺序、各段占位/降级语义对齐：① 个股信息段——Python `get_stock_info`（stock 缺失 raise 唯一 raise 点）vs TS `store.getStock` + `formatStockOutput`（数据缺失差异见 slice 2/6）；② 技术指标——降级占位文本（`trendIndicatorsText` pipeline.ts:199）；③ 财务指标——无 raw 缓存降级占位（`financialIndicatorsText` pipeline.ts:150-165）；④ 实时情报——TS `deps.mcp ?? fallbackMarketIntel()`（pipeline.ts:207,223-226，fallback 文本「（未配置 TDX_API_KEY，跳过实时市场情报）」与 Python `_FALLBACK_TEXT` 逐字一致）；⑤ 亿信——`deps.billions` 未注入 → 空串段自然不出现（pipeline.ts:210-211，对齐 Python 开关关返回空串）。**差异**：progress 回调语义——Python `safe_progress` 有「非脚本线程 → debug 日志」线程判定（progress.py:22-34），TS `safe()` 仅 try/catch（pipeline.ts:214-218）；TS 事件驱动无线程面，行为等价。**亿信段缓存差异**：Python 每次调用现查现拼；TS App 预查询一次生成缓存闭包（runner.ts:131-153 `makeBillionsIntel`），`buildStockInformation` 预览与 `runner.run` 双算共享同一文本（App.tsx:204-221 注释「不重复触发 120s 网络」）——TS 增强，终态文本一致 | NON_BLOCKER |
| C2 | `make_investment_committee(config, progress_updater=None, _llm=None)`：`llm = _llm or make_llm()`（investment_committee.py:80,104） | `makeInvestmentCommittee(config, progressUpdater, _llm, _tools?)`：**无 `_llm` 直接抛 `M2: _llm required`**（committee.ts:118,124） | **PARTIAL** | **签名/缺省行为差异（设计注释 M2/M3 明确）**：Python 独立可用（env 三键配置时缺省 `make_llm()` 即得真 LLM，见 core/llms/llm_factory.py）；TS committee 层要求调用方显式传 LLM，真入口 `events.ts:118` 补 `opts.llm ?? makeLlm()`（events.ts:117-119）。08-13 审查 W33 已记录（committee.ts:146-156 makeInvestmentDecision 死导出 + M2 签名偏离，建议 phaseout 后删除而非对齐）。LLM 构造契约本身对齐（`makeLlm`/`readLlmEnv` 三键必填校验，llm.ts:12-38）。**阻断评估**：所有生产调用点（events.ts:117-119、App.tsx:165-171 buildLlm）均显式传 llm → 无实际功能缺口；仅 committee 作为独立 API 使用时与 Python 语义不同 | NON_BLOCKER |
| C3 | 工具装配（图内）：联网搜索开关判定 + 亿信三件套工厂（开关/key → None 过滤），空 → `tools = None`（investment_committee.py:108-125） | 工具注入位置外移：`_tools ?? (webSearchEnabled() ? [makeWebSearchTool()] : [])`（committee.ts:129）；App 层 `assembleTools`（runner.ts:168-177，web_search + 亿信三件套经 localStorage key 注入）→ events.ts:119 传入 | **PARTIAL** | **注入位置差异（committee.ts:126-128 注释承认的设计）**：Python 亿信三件套**图内自动装配**（env key 存在即绑，investment_committee.py:118-123）；TS 必须经调用方 `_tools` 注入（web 端 key 在 localStorage，committee 无法自读）。**具体影响场景**：不经 App 的 `runner.run`（如 `ts/tools/probe.mts:84` 探针直调不带 tools）→ TS 仅绑 web_search、亿信工具**不绑**（即使 Node env 有 BILLIONS_API_KEY），且亿信/mcp 情报段亦未注入（Python 对应 headless 入口 `make_investment_decision` 会包含）。生产 web 链（App）完整无缺；Node/探针链路差异需人工确认是否接受。另：空工具形态 Python `None` vs TS `[]` 经 `agents.ts:66` `if (tools.length && ...)` 判定等价（Python `base.py:57-66` `if tools:`，语义一致） | NON_BLOCKER |
| C4 | 注册表驱动装配：专家（无 tools）∥ → 交易员（tools）∥ → 对抗修订（同实例第二节点）→ 经理（tools）（investment_committee.py:127-159） | 同构装配（committee.ts:130-139）：`for role of roles` 统一建节点 + reviseNodeName 建第二节点；专家/交易员/经理按 Role.factory 形状收 tools | FULL | 节点集/join 语义一致（Python 用 `resolved_method`，TS 用同名约定；见 R4）。Python `trader_instances` 字典复用同一实例建 revise 节点（investment_committee.py:139-151）↔ TS 同一 `agent` 实例挂两个节点（committee.ts:132-137） | NON_BLOCKER |
| C5 | 边表装配：`build_edges(roles)` + START/END 字符串映射 langgraph 常量（investment_committee.py:161-168） | `buildEdges(roles)` + `from === 'START' ? START : ...`（committee.ts:140-142） | FULL | 等价 | NON_BLOCKER |
| C6 | checkpointer：每次调用新建 `InMemorySaver()`，`compile(checkpointer=...)`（investment_committee.py:106,170） | 每次调用新建 `MemorySaver()`（committee.ts:143） | FULL | 等价 → **thread_id 复用安全**（见 C8） | NON_BLOCKER |
| C7 | `make_investment_decision(target_ticker)`：独立 headless 入口——内部 `build_stock_information` + 缺省 `make_llm()` + `thread_id="1"` + `graph.stream` 迭代（investment_committee.py:174-186） | ① `committee.ts:146-156` `makeInvestmentDecision`：**死导出**（全仓库 grep 仅 committee.ts 自身定义一处，无任何调用；08-13 W33 记录）；签名偏离 Python（要求调用方传 `stockInformation`，无 `_llm` 抛 M2，非独立可用入口）② **真实等价入口**：`events.ts:104-159` `runner.run()`——内部 `buildStockInformation` + `makeInvestmentCommittee` + stream 迭代 + `getState` 组装 `FinalReport` + done/error 事件 | **PARTIAL** | 功能面由 events.ts 完整承接（FULL 等价）；committee.ts 的 `makeInvestmentDecision` 为死导出且语义偏离，按 08-13 W33 建议 phaseout 时删除而非对齐（本片只记录差距，不修）。**证据**：grep `makeInvestmentDecision` 全仓库仅 committee.ts:146-156 自身（ts/test 无引用、probe.mts 用 runner.run）；Python 侧 `make_investment_decision` 生产调用者同样为零（display.py:455 直接调 `make_investment_committee`，grep core/ 无其它调用；作为 headless API 见 spec core/investment-committee.md:37） | NON_BLOCKER |
| C8 | thread_id 复用语义：`{"configurable": {"thread_id": "1"}}` 恒值 + 每次新建图/checkpointer → reducer 通道（messages/bullish_opinions/bearish_opinions）不跨分析累积（investment_committee.py:106,170,175） | `events.ts:117` `opts.config ?? { configurable: { thread_id: '1' } }` + committee.ts:143 每次新建 MemorySaver；App 不传 config → 恒默认 | FULL | 语义完全一致（08-13 py-orchestration.md:51 已核 Python 侧无害；TS 侧同构）。agents 均不读 `state.messages`（base.py 注释确认），thread_id 复用无副作用 | NON_BLOCKER |
| C9 | `load_dotenv()` 图装配内调用（investment_committee.py:100） | 无（TS env 由构建期/Node 进程注入；committee.ts 无 env 读取副作用） | FULL | TS 无对应需求（web 端经 EXPO_PUBLIC_*/localStorage，Node 端进程 env）。`makeInvestmentCommittee` 纯函数化，副作用更少 | NON_BLOCKER |
| C10 | 图前 enrichment 的 BJ API 路径守卫（`get_company_info.py:11-15` raise；经 `build_stock_information` 图前触发） | 无 API 层 BJ 守卫（仅 App.tsx:153-156 UI 拦截；grep `ts/src` 无 BJ/北交所检查） | BY_DESIGN | 北交所整体不移植（ts/index.md「能力接线」节）；Python API 路径的明确报错（BJ raise）在 TS headless 路径缺失，fallback 为 TDX 采集通用失败。非阻断（北交所为设计排除项） | NON_BLOCKER |
| C11 | 事件协议（对照）：Python 侧 `ProgressBridge.info/push_report`（progress.py:37-53）+ display 队列循环消费 progress/report/error/done 四型（display.py:479-520） | `events.ts:15-21` PipelineEvent 六型联合（progress/report/token/roleStatus/done/error）+ `createPipelineRunner`（events.ts:67-160） | FULL | Python 四型全部覆盖；token/roleStatus 为 TS 流式新增（08-11-ts-streaming-output 方案 B，出处 ts/index.md「流式输出」节——Python LangGraph 侧无对应，属 TS 增强非缺失）。`pushReport` 的 tabTitle 查表（events.ts:84-87）、node→roleKey 映射（events.ts:88-95）、报告权威覆盖（App.tsx:92-104 用事件时刻 `enabledRoles()` 清 partial）均对齐 spec 事件协议 | NON_BLOCKER |
| C12 | 错误处理（对照）：Python display 捕获异常 → `logger.exception` + `st.error` 中文提示（display.py:521-527 引用） | `describeError`（events.ts:49-63，LangGraph 聚合异常 `errors[]` 提取）+ App.tsx:228-232 catch 分支 | FULL | TS 增加 errors[] 聚合提取（Python 无对应，LangGraph JS 特有异常形态）——TS 增强 | NON_BLOCKER |

**MISSING 统计**：本片 **0 条 MISSING**（所有功能点均在 TS 侧找到等价物；搜索覆盖 `ts/src`、`ts/app`、`ts/test`、`ts/tools` 全仓库）。

---

## ③ MISSING / PARTIAL 汇总清单（移植/决策时照此逐条）

### PARTIAL（3 条，全部 NON_BLOCKER）

| # | Python 功能点 | TS 等价物 | 具体差异 | 处置建议 |
|---|---|---|---|---|
| P1 | `information_analyst_enabled`（role_registry.py:39-55，亿信路径受 key 硬约束） | `informationAnalystEnabled`（committee.ts:43-48，无 key 约束） | 注册谓词缺 key 约束：`无 BILLIONS_API_KEY + 联网关 + SEARCH/TWITTER 开` → Python 不注册分析师，TS 注册（committee.ts:36-40 注释「现状」、billsTools.ts:150-157 key 判定下沉工具层）。**需人工确认**是否接受该注册面超集 | 若接受（推荐）：phaseout 时在 spec 记录注册谓词差异；若需对齐：committee.ts `informationAnalystEnabled` 增加 key 判定（但 web 端 key 在 localStorage，谓词需经 deps 注入） |
| P2 | `make_investment_committee` 缺省 `_llm or make_llm()`（investment_committee.py:104）+ 图内自动装配亿信三件套（:118-123） | `makeInvestmentCommittee` 无 `_llm` 抛 M2（committee.ts:124）+ 亿信工具须调用方注入（committee.ts:129，App 经 assembleTools 注入 runner.ts:168-177） | ① committee 层独立调用语义不同（需显式传 LLM）；② 不经 App 的 `runner.run`（Node 探针 probe.mts:84）不绑亿信工具、不注入亿信/mcp 情报段——与 Python headless 入口行为不同。生产 web 链完整。**需人工确认** Node/探针链路是否需补齐 | 建议：保留 M2 设计（08-13 W33 建议 phaseout 后删除 `makeInvestmentDecision` 死导出）；Node 探针若需对齐 Python headless 入口，接线 `makeBillionsIntel`/`makeMcpIntel`/`assembleTools`（runner.ts 已有现成工厂） |
| P3 | `make_investment_decision` 独立入口（investment_committee.py:174-186） | `makeInvestmentDecision` 死导出 + 签名偏离（committee.ts:146-156） | 全仓库零调用；真实等价入口为 `events.ts:104-159` `runner.run()`（功能 FULL）。08-13 W33 已记录 | phaseout 时删除 committee.ts 死导出（events.ts 已内联等价逻辑），不移植对齐 |

### BY_DESIGN（2 条，均 NON_BLOCKER）

| # | Python 功能点 | 出处 | 说明 |
|---|---|---|---|
| B1 | 北交所（display.py:387-388 UI 拦截 + get_company_info.py:11-15 API raise） | ts/index.md「能力接线」节：北交所/akshare 明确不支持（用户决策 08-13），App.tsx 入口拦截报错 | App.tsx:153-156 已拦截；TS API 路径无 BJ 守卫（见 M4c 注记，需人工确认是否补） |
| B2 | akshare 备用路径（不在本片文件，清单层面注记） | 同上 | 本片无涉及 |

### MISSING（0 条）

无。全片功能点在 TS 侧均有等价物（grep 覆盖 `ts/src`、`ts/app`、`ts/test`、`ts/tools`；「名字不同但功能等价」按防假阳性规则已核查，如 `report_roles→reportRoles`、`build_edges→buildEdges`、`build_stock_information→buildStockInformation`、`ProgressBridge→ProgressUpdater/events`、`enabled_roles→enabledRoles`、`ROLES→ROLES`）。

---

## ④ spec 符合性结论（ts/index.md「能力接线」节核对）

| 能力接线点（spec 要求） | 证据（file:line） | 存在 |
|---|---|---|
| 事件协议：`PipelineEvent` 六型联合（progress/report/token/roleStatus/done/error） | events.ts:15-21 | ✅ |
| node→roleKey 映射（初稿查 nodeName、修订查 reviseNodeName，查不到原样用 node） | events.ts:88-95 | ✅ |
| 报告权威覆盖（report 事件清空该 role 全部 node 的流式 partial，实现用**事件时刻** enabledRoles） | App.tsx:92-104（`enabledRoles()` 调用时求值） | ✅ |
| ProgressUpdater 协议：扩展接口可选方法 + `safePushDelta`/`safePushStatus` 守卫 | progress.ts:10-17（可选 `pushDelta?`/`pushStatus?`）、progress.ts:42-64（守卫 no-op 不阻断图） | ✅ |
| 亿信接线：`makeBillionsIntel`（pipeline 段）+ `assembleTools`（委员会工具）→ App.tsx 传入 | runner.ts:131-153、runner.ts:168-177、App.tsx:204-207（Promise.all 预查询）、App.tsx:222-226（双注入 buildStockInformation + runner.run）；key 单点判定 billsTools.ts:150-157 | ✅ |
| mcp 实时情报接线：`makeMcpIntel` → App.tsx 传入 deps.mcp | runner.ts:155-166、App.tsx:204-207、App.tsx:222-226（`...(mcp ? { mcp } : {})`）；无 key 占位由 `getMarketIntel`/`fallbackMarketIntel` 承担（pipeline.ts:207,223-226） | ✅ |
| qfq 前复权生产链：web 采集 → /tdx-collect 代理 → `collectAll` 内 qfq（日期契约双向转换） | 接线点存在：App.tsx:184 `collectForWeb` → runner.ts:36-39（`collectViaProxy` + `applyCollectedToStore`，webCollect.ts）→ server /tdx-collect（proxies.cjs，非本片文件）；qfq 细节归 slice 6（quoteClient.ts） | ✅ |
| 北交所/akshare：入口拦截报错 | App.tsx:153-156 | ✅ |
| 角色注册表/图装配（Python 单一事实源等价物）：ROLES、enabledRoles、buildEdges、reportRoles | committee.ts:57-69、67-69、83-99、71-74；TS 侧单测钉死 committee.test.ts:87-103 | ✅ |

**结论**：本片覆盖的 ts/index.md「能力接线」点**全部存在**，0 MISSING、0 BLOCKER。3 条 PARTIAL（P1 分析师注册谓词 key 约束、P2 committee 层 LLM/工具注入位置、P3 死导出）均为「签名/注入位置/谓词面」差异且全部 NON_BLOCKER——删 Python 对应文件前**无需强制补齐项**；P3 建议 phaseout 时顺手删除（08-13 W33 既有建议），P1/P2 需人工确认后决定对齐或记录为设计差异。
