# 分片 5：py-ui —— Python UI 面 → TS 功能差距审计

> 审计日期：2026-08-14 ｜ 纯只读审计，零业务代码改动
> Python 侧逐文件通读（display.py 527 行 / charts.py 202 行 / data_markdown.py 384 行 / theme.py 122 行）；TS 对照面通读（App.tsx / theme.ts / screens/DataScreen、SettingsPanel、ReportScreen / components/IndicatorChart、ReportContent、MarkdownText）+ 交叉核实（committee.ts ROLES、runner.ts、settings.ts、events.ts、overview.ts、f10.ts、billionsTools.ts、pipeline.ts、store.ts、tdx_source.py is_bj_ticker、.streamlit/config.toml）。
> 防假阳性：TS 侧等价物按 grep 全仓库 + 语义等价判定（名字不同不算 MISSING）；拿不准处标注「需人工确认」。

---

## ① 认领文件清单（确认逐文件读过）

| Python 侧（认领） | 行数 | TS 对照面（读毕） |
|---|---|---|
| `core/ui/display.py` | 527 | `ts/app/App.tsx`、`ts/app/screens/SettingsPanel.tsx`、`ts/app/lib/settings.ts`、`ts/app/lib/runner.ts`（assembleTools/demoLlm）、`ts/src/committee.ts`（reportRoles/ROLES）、`ts/src/events.ts`（runner）、`ts/src/agents.ts`（pushReport 调用点） |
| `core/ui/charts.py` | 202 | `ts/app/components/IndicatorChart.tsx`（全量）、`ts/app/screens/DataScreen.tsx`、`ts/app/theme.ts`、`ts/src/overview.ts`、`ts/src/store.ts`（DailyBar） |
| `core/ui/data_markdown.py` | 384 | `ts/app/screens/DataScreen.tsx`、`ts/src/f10.ts`（parseIndicatorSection）、`ts/src/pipeline.ts`（buildStockInformation/五段拼接）、`ts/src/overview.ts`（composeOverview） |
| `core/ui/theme.py` | 122 | `ts/app/theme.ts`、`.streamlit/config.toml`、`ts/app/components/IndicatorChart.tsx`（色板消费）、`ts/app/components/MarkdownText.tsx` |
| —（契约源头） | — | `core/role_registry.py`（ROLES/report_roles）↔ `ts/src/committee.ts`（ROLES/reportRoles）双向比对 |

**关键认知（先纠正一个易误判点）**：`data_markdown.py` **不是** LLM 报告 markdown 渲染器——它是「采集数据」Tab 的定宽文本 → markdown 表格转换器（LLM 报告渲染在 Python 侧走 `st.write`，display.py:514/516）。因此：
- Python `st.write` 渲染 LLM markdown 的等价物 = `MarkdownText.tsx`（react-native-markdown-display，RN 原生 + web 通用）；
- `data_markdown.py` 的等价物 = `DataScreen.tsx` 的结构化 JSX 表格 + `f10.ts parseIndicatorSection` + `overview.ts composeOverview`（TS 走**数据驱动**：直接消费 store 的 bars/performance_reports/F10，而非解析拼接文本——数据同源，架构差异，行为等价）。

---

## ② 功能点差距表

### 2.1 `core/ui/display.py`（527 行）

| # | 功能点（Python file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| D1 | 模块级 `committee = InvestmentCommittee()` 单例（display.py:18） | `store`/`runner` 模块级单例（ts/app/lib/runner.ts:12,22） | FULL | 架构等价（图实例的持有方式） | — |
| D2 | `_LLM_REQUIRED_ENV` + `_llm_configured()` 门控（display.py:21-32） | `llmConfigured`/`missingLlmKeys`（settings.ts:85-88,118-127）+ App `gateNotice`（App.tsx:173-176） | PARTIAL | **行为差异**：Python 缺三键 → `st.error` + `return` **硬阻断**（display.py:375-377）；TS 缺三键 → 仅顶部 warn 提示，分析继续并以「演示占位 LLM」跑全图（runner.ts buildLlm/demoLlm:90-123，App.tsx:200-202）。TS 为刻意设计的 web 演示模式（代码注释「演示占位 LLM」）。 | NON_BLOCKER（TS 刻意设计；若 phaseout 要求与 Python 一致的硬阻断可再议） |
| D3 | `DATA_TAB_TITLE = "采集数据"`（display.py:40） | App.tsx:239-241 `{ id: 'data', label: '采集数据' }` | FULL | 同名同序（数据 Tab 恒为第一个） | — |
| D4 | `report_tabs()` 注册表驱动 Tab 契约（display.py:44-53） | `reportRoles()`（committee.ts:71-74），App.tsx:66/240-241 | FULL | 同契约：`enabled 且 state_key+tab_title 非空`，按 ROLES 顺序；7 角色 stateKey/tabTitle 逐一相同（committee.ts:47-64）。**ANALYST 条件开关**：Python 谓词 `information_analyst_enabled`（role_registry.py:33-41）≡ TS `informationAnalystEnabled`（committee.ts:37-41，公式逐项一致） | — |
| D5 | `OPINION_REPORT_KEYS`（display.py:58） | `Role.opinion` 标志（committee.ts:58-59 bullish/bearish `opinion: true`），App.tsx:321 `opinion={activeRole.opinion === true}` 传入 ReportContent | FULL | 同一注册表派生，两 key（bullish_opinions/bearish_opinions）一致 | — |
| D6 | `_report_content` 状态值归一（list→[-1].content，display.py:61-71） | 无直接等价（TS 无 superstep 状态兜底） | FULL | 架构差异：Python 因「agent 桥事件 + superstep update 双通道」需消化 add_messages 包装；TS 只发事件通道（agents.ts:127,160 pushReport 一次），内容恒为字符串。行为等价 | — |
| D7 | `iter_report_items` 按 key 分发（display.py:73-82） | App.tsx:283-285 `events.filter(type==='report' && key===activeTab)` | FULL | 等价（TS 由 App 过滤，Python 由事件循环查 `report_tabs_map`） | — |
| D8 | `_stream_graph_events` 后台线程驱动 graph.stream（display.py:85-100） | `createPipelineRunner` 异步迭代（events.ts:66-133，graph.stream 内「报告已由 pushReport 事件发出」） | FULL | 架构等价（线程 vs async）；**去重差异**：Python 因双通道用 `rendered` (key,content) 集去重（display.py:486），TS 单通道无重复（无 superstep 兜底推送）——输出等价 | — |
| D9 | `_env_enabled`（display.py:109-112，DISABLED 负极性翻转） | `envDisabledBool`（committee.ts:27-31） | FULL | 语义一致（未设置或显式假值 → 启用） | — |
| D10 | `_env_billions_max_calls`（display.py:114-117，env→int 回退默认） | `DEFAULT_CAPS`（settings.ts:46）+ `maxCallsFor`（billionsTools.ts:159-163） | PARTIAL | **接线缺口（重要）**：Python 面板上限经 `set_runtime_overrides` 写 env `BILLIONS_{CAP}_MAX_CALLS`，工具读 env 生效（display.py:143-146, 154-166, 395）；TS 面板 caps **只存 localStorage，从未接线到 `makeBillionsTools`**（runner.ts assembleTools:170-177 不传 `maxCalls`，App.tsx start() 不写 env）——面板改上限无任何效果，工具实际取 env 或默认值（3/2/3）。控件存在但失效。 | **BLOCKER**（设置控件需接线到 billsTools `maxCalls` 才等价；需人工确认是否补） |
| D11 | `_panel_enablements` 亿信置灰决策（display.py:120-128：无 key 或总闸关 → 5 能力 toggle 置灰） | SettingsPanel.tsx:48 `billionsGreyed = !key.trim() || !billionsMaster` + disabled（134-138） | FULL | 逻辑逐项一致；warn 文案一致（「未配置亿信 API Key…」「亿信总闸已关…」） | — |
| D12 | `_SESSION_TOGGLE_WIDGETS` 8 开关（display.py:133-141） | `SwitchState` 8 字段（settings.ts:9-17）+ `applySwitchesToEnv`（settings.ts:106-116） | FULL | 8 开关一一对应（tdxMcp/webSearch/billionsMaster + findb/search/twitter/fetch/analyst），DISABLED 语义写入一致；**接线点差异**：Python 提交分析时经 `set_runtime_overrides`（display.py:395），TS 变更即 `applySwitchesToEnv`（App.tsx:164）+ start() 再写（App.tsx:186）——时机不同但两处均生效 | — |
| D13 | `_SESSION_NUMBER_WIDGETS` 3 上限（display.py:143-146） | `CapsState` 3 字段（settings.ts:18-22） | PARTIAL | 同 D10：控件存在、未接线 | **BLOCKER**（同 D10） |
| D14 | `_PERSISTED_PASSWORD_WIDGETS` 4 密钥 + LangSmith（display.py:159-165） | `KeysState`（settings.ts:24-33：llmApiKey/tdxApiKey/billionsApiKey/langsmithKey/langsmithProject/langsmithTracing） | PARTIAL | ① 存储介质：Python 持久化到 `.env`（update_env_file 原子写 + 同步 os.environ，立即生效）；TS 持久化 localStorage（settings.ts:97-103）。② **LangSmith：Python 写入 .env 后 LangSmith SDK 真正消费；TS 仅持久化、未接线**（SettingsPanel.tsx:13 注释「TS 侧未接入，仅持久化」）——遥测开关无实际效果 | NON_BLOCKER（LangSmith 遥测非产品功能；**需人工确认**是否移植遥测接线） |
| D15 | `_collect_session_overrides`（display.py:154-166） | `applySwitchesToEnv`（settings.ts:106-116） | PARTIAL | toggle 部分 FULL；caps 部分见 D10 未接线 | BLOCKER（caps 部分） |
| D16 | `_collect_persisted_updates`（display.py:168-203：密码框空=不修改、模型/endpoint 恒收集、LANGSMITH_TRACING 布尔化） | SettingsPanel `update`/`saveAndCheck`（SettingsPanel.tsx:53-77） | PARTIAL | **校验形态差异**：Python 空 LLM_MODEL/LLM_BASE_URL 由 env_file 必填校验拒绝保存 + `st.error` 提示（display.py:198-199 注释）；TS 由「三键不齐 → 保存按钮红色禁用 + 点名缺失」拦截（SettingsPanel.tsx:81-90）——两者都拦住非法配置，交互形态不同（框架差异） | NON_BLOCKER |
| D17 | `_save_settings`（display.py:189-215，返回 (ok,message)） | `saveAndCheck`（SettingsPanel.tsx:68-77） | PARTIAL | Python 落 .env + `st.success/error` 反馈；TS 存 localStorage + **LLM 可达性检测**（checkLlmReachability，settings.ts:149-166——Python 无此功能，TS 超集） | NON_BLOCKER |
| D18 | `_write_settings_panel` 四节布局（display.py:218-355） | SettingsPanel.tsx（5 节：LLM/外部服务密钥/LangSmith/能力开关/调用上限） | PARTIAL | 细节差异（均 NON_BLOCKER 框架/UX）：① 密码框 Python **每次渲染不留值**（空=不修改，R6 不明文回显，display.py:232-233, 251-285）；TS `secureTextEntry` 回显当前值（SettingsPanel.tsx:84）。② Python 一次「保存」按钮统一落盘；TS 变更即自动保存 + LLM 区独立保存按钮。③ 初始值来源：Python 面板读 `.env`（`_env_enabled`），TS 读 localStorage/默认（settings.ts:64-88，仅 EXPO_PUBLIC_LLM_* 环境兜底）——**Python 的 `WEB_SEARCH_DISABLED=1` 等 .env 初值在 TS 面板不体现**。④ TS 面板 caption「重新加载后恢复默认」与 localStorage 实际持久化行为不符（TS 侧文案瑕疵，非 Python 差距） | NON_BLOCKER |
| D19 | `write_ui` 页面配置（display.py:366-368：page_title「超绝AI股票分析系统」/📈/wide） | `THEME_HEADING = '超绝AI股票分析系统 📈'`（theme.ts:53）+ App.tsx header（265-269）+ 宽屏自适应（App.tsx:45,55） | FULL | 标题/图标等价；wide ↔ `width>=900` 响应式（框架差异） | — |
| D20 | ticker 表单 + 校验（display.py:379-388：`max_chars=6`、`isdigit()+len==6`） | App.tsx:274-281（maxLength 6）+ start() `/^\d{6}$/`（App.tsx:188-190） | FULL | 校验等价；表单提交方式（st.form Enter vs 按钮）为框架差异 | — |
| D21 | 北交所拦截 `is_bj_ticker`（display.py:387-388） | App.tsx:190-193 `startsWith('4')||startsWith('8')` | FULL | `is_bj_ticker` 即 `startswith(("4","8"))`（tdx_source.py:51-57），逐字等价；报错文案基本一致（Python 表单 label「沪深京A股」vs TS「沪深A股」文案微差） | — |
| D22 | 提交时 `set_runtime_overrides` 应用会话覆盖（display.py:395） | App.tsx:186 `applySwitchesToEnv(settings.switches)` + 变更即应用（App.tsx:164） | FULL | 见 D12；Python 的 caps 部分见 D10 | — |
| D23 | `st.tabs([DATA_TAB_TITLE]+报告标题)` 动态 Tab 装配（display.py:401-408） | App.tsx:238-241 tabs 数组（data + reportRoles） | FULL | 同序同内容；Python 开关竞态守卫（未知 key 跳过，display.py:493-501）≡ TS 自然过滤（events.filter by key） | — |
| D24 | enrichment `build_stock_information` + 分步进度（display.py:410-423, 447） | App.tsx:204-246（collectForWeb + buildStockInformation + makeBillionsIntel/makeMcpIntel 预查） | FULL | 数据面细节归分片 2/6；UI 侧进度提示等价（Python `updatable_container.info` vs TS progress bar + log） | — |
| D25 | 采集数据 Tab：图表循环（display.py:441-445，charts 先于表格） | DataScreen.tsx 技术图区块（62-72，web-only IndicatorChart） | PARTIAL | 聚合差异详见 2.2 图表行（收盘价/涨跌幅/财务线） | 见 2.2 |
| D26 | 采集数据 Tab：`render_sections` 表格（display.py:445） | DataScreen.tsx 结构化 JSX（概览 chips/日K 表/盈利能力 chips/业绩卡片） | PARTIAL | 详见 2.3 data_markdown 行 | 见 2.3 |
| D27 | 事件循环渲染：进度/报告/观点 expander/轮次标签/去重（display.py:464-525） | App.tsx subscribe（95-141）+ ReportContent.tsx | PARTIAL | ① **观点轮次**：Python 通用计数「第 n 次观点」、n==1 默认展开（display.py:509-516）；TS 固定 2 槽「初稿/对抗修订」（ReportContent.tsx:61-93），流式中默认展开、**完成后默认折叠**——Python 完成后初稿仍展开。② 多轮扩展性：Python 第 3+ 轮自然追加，TS 固定 2 槽丢弃第 3 份（当前图仅初稿+修订，行为等价）。③ **流式是 TS 超集**（partials + ▍光标 + roleStatus chips，Python 无 token 级流式）。④ 每份观点 expander 文案「第 n 次观点」vs「初稿/对抗修订」标签措辞 | NON_BLOCKER（均为展示细节；「第 n 次观点」轮次语义与「初稿/对抗修订」等价） |
| D28 | 最终结论渲染（display.py:513-516：最终结论是普通报告 Tab + st.write） | ReportContent.tsx:46-59（roleKey==='final_decision' 特判 finalCard + MarkdownText；空态 muted 提示） | FULL | 等价（Python 空态为空白 tab，TS 有占位文案——超集） | — |
| D29 | 错误处理（display.py:418-423 采集异常 / 521-525 图异常 → 中文 st.error + logger.exception） | App.tsx:247-255（catch → `setError(detail)`，error 事件 → setError） | FULL | 等价；TS 错误显示在表单区（App.tsx:283），Python 全屏 st.error——展示位置框架差异 | — |
| D30 | 报告内容 markdown 渲染（display.py:514,516 `st.write`） | `MarkdownText`（react-native-markdown-display；组件内样式 markdownStyles:8-38） | FULL | 见 2.4 MarkdownText 行 | — |

### 2.2 `core/ui/charts.py`（202 行）

| # | 功能点（Python file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| C1 | `UP_COLOR`/`DOWN_COLOR` 涨跌语义色（charts.py:28-29，#E03131/#0B9464，双模式固定） | `theme.colors.up/down`（theme.ts:35,42 亮 / 53,60 暗） | PARTIAL | **色值差异**：Python 图表固定 `#E03131/#0B9464`（与主题色板不同值）；TS 图表用主题 up/down：亮 `#D32F2F/#1a8f3d`、暗 `#EF5350/#4caf6d`（IndicatorChart.tsx:151-158,171-175）。两者均 A 股红涨绿跌语义、经 validate_palette 验证可读；TS 图表与 TS 主题自洽。纯外观差异 | NON_BLOCKER |
| C2 | `_FINANCIAL_LINES` 财务线三色（charts.py:32-36） | 无 | MISSING | 随 C6 财务折线整体缺失（色值无消费点） | 随 C6 |
| C3 | `candlestick_chart` K线（rule 影线 + bar 实体，红涨绿跌、y 轴 zero=False、tooltip 含涨跌幅、ordinal 日期轴）（charts.py:70-107） | IndicatorChart pane0 蜡烛 + MA/EMA/BOLL 叠加（IndicatorChart.tsx:151-164） | FULL | **TS 为超集**（主图多叠加 9 条均线/布林）；行为对齐点：A 股涨跌色（close≥open 涨）、非零基 y 轴（lightweight-charts 默认）、交易日不等距无假空隙（lightweight-charts time 轴天然跳过空档，等价 Python ordinal）。差异仅 tooltip：Python 自定义悬浮含开收高低+涨跌幅，lightweight-charts 为原生 crosshair（无涨跌幅字段）——细节差异 | NON_BLOCKER |
| C4 | `volume_chart` 成交量柱（涨跌同色、图例）（charts.py:108-126） | IndicatorChart pane1 量柱 + VOL_MA5（IndicatorChart.tsx:171-177） | FULL | TS 超集（+VOL_MA5 均线）；涨跌着色一致（半透明 up/down）；y 轴标题不带单位（两方一致） | — |
| C5 | `close_line_chart` 收盘价趋势线（charts.py:127-143） | 无独立线图 | PARTIAL | 独立「收盘价」图缺失，但信息被 K线主图完全覆盖（蜡烛收盘价 + MA 均线叠加）——用户可获取等价信息 | NON_BLOCKER |
| C6 | `change_percent_chart` 涨跌幅柱（正红负绿、图例、tooltip）（charts.py:144-163） | 无 | **MISSING** | **按日涨跌幅可视化完全缺失**：TS 无此图；日K 表也无涨跌幅列（见 P6）；仅「最新指标」/概览 chip 有最新一日涨跌幅（DataScreen.tsx:52）。数据在手（pipeline.ts:64 已算 changePct），纯展示缺口 | **BLOCKER**（删 Python 前需补图或 phaseout 显式决策接受损失） |
| C7 | `financial_charts` 净利润/销售毛利率/每股收益跨期折线（各自成图、单位不混轴、全 N/A 跳过）（charts.py:165-184） | 无 | **MISSING** | 财务跨期趋势图缺失。底层数据存在：业绩卡片（DataScreen.tsx:118-135，最近 4 期、8/9 字段——**缺「销售毛利率」**）+ 盈利能力 chips（DataScreen.tsx:91-104，仅最新期）。无任何跨期折线 | **BLOCKER**（需补或 phaseout 显式决策接受损失；数据齐备补图成本低） |
| C8 | `iter_data_charts` 编排：K线→成交量→收盘价→涨跌幅→财务（空数据空迭代不画图）（charts.py:186-202） | DataScreen 图表区块编排（DataScreen.tsx:62-72 + IndicatorChart 内部 9 pane） | PARTIAL | 聚合：K线/成交量 FULL；收盘价/涨跌幅/财务缺失（C5/C6/C7）；空数据守卫等价（`klineBars.length > 1`） | 见 C6/C7 |

### 2.3 `core/ui/data_markdown.py`（384 行）

| # | 功能点（Python file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| MD1 | `KEY_LABELS` 键→中文标签映射（data_markdown.py:49-101，22+ 键） | DataScreen 中文表头硬编码（DataScreen.tsx:78-82 日K 表头；chips 标签） | PARTIAL | 日K 表：Python 8 列（日期/开盘价/收盘价/最高价/最低价/涨跌幅/成交量/换手率），TS 6 列（日期/开/收/高/低/量(手)）——**缺涨跌幅/换手率列**；标签措辞微差（开盘价 vs 开，纯展示）。业绩卡片缺「销售毛利率」字段（见 C7）。概览 chips 缺「动量」字段（Python 概览表 5 行含动量；TS 原文底部可见 Momentum） | 涨跌幅/换手率列 **BLOCKER**（核心行情列，数据在手 pipeline.ts:64-65 已算）；动量/毛利率 NON_BLOCKER（原文或 F10 可见） |
| MD2 | `ParsedStockInfo` 结构化解析产物（data_markdown.py:104-118） | DataScreen 自 store 直取（bars/f10/reports）+ composeOverview + parseIndicatorSection | FULL | 架构差异（文本解析 vs 数据驱动），数据同源等价 | — |
| MD3 | `iter_sections` 分节（7 节：overview/daily/financial/intel/profitability/billions + 通用注册）（data_markdown.py:216-258） | 无文本分节器；各段数据源分别取：概览=composeOverview（overview.ts:59-112）、日K=store bars、财务=performance_reports、指标=computeAll（indicators.ts）、盈利能力=F10 parseIndicatorSection（f10.ts:109-111）、情报/亿信=buildStockInformation 注入（pipeline.ts:209-211） | PARTIAL | 段落覆盖核对：**实时情报（intel）与亿信金融数据库（billions）两段在 TS 采集 Tab 无结构化区块**——仅出现在底部「分析上下文原文」（DataScreen.tsx:146-157）。内容不丢（原文可见），结构化展示缺失 | NON_BLOCKER（内容可见；是否补结构化段落需 phaseout 决策） |
| MD4 | `render_sections` 渲染：加粗标题 + 列向/扁平表 + 降级占位透传（data_markdown.py:259-283） | DataScreen JSX 区块（概览 chips 73-87 / 日K 表 74-89 / 盈利能力 chips 91-104 / 业绩卡片 106-135 / 原文 146-157） | PARTIAL | ① 占位透传：Python 分节渲染内保留「（无…跳过…）」占位；TS 占位只在原文可见、结构化区块（如盈利空→不渲染）静默。② 表格结构：Python 列向表（首行键为表头）vs TS 固定 JSX 行——等价。③ intel/billions 见 MD3 | NON_BLOCKER |
| MD5 | `to_markdown_tables`（data_markdown.py:284-292，文本→markdown 字符串） | 无直接等价（TS 不再生成展示用 markdown 表格；LLM 上下文由 pipeline buildStockInformation 生成，与 UI 展示解耦） | FULL | 架构差异：该函数仅服务采集 Tab 展示，TS 用结构化 JSX 替代；公共签名保留在 Python 测试/e2e 种子（测试留待 phaseout 决策） | — |
| MD6 | `_rows_from_sections` 行推导 + 数值归一（`_to_number`：去 %/lots 后缀、N/A→None、Date 升序）（data_markdown.py:294-345） | store.getDatas 升序 bars（store.ts:207-219）+ pipeline 计算 changePct/turnoverPct（pipeline.ts:60-65）+ f10.ts toNum（f10.ts:16-22） | FULL | 数值语义等价（NaN ↔ N/A、后缀剥离）；TS DailyBar 无持久化涨跌幅/换手率字段、按需现算——与 Python data 行同源等价 | — |
| MD7 | `parse_stock_info` / `parse_daily_rows` / `parse_financial_rows`（data_markdown.py:347-384） | DataScreen 直接读 store（`store.getDatas`/`getPerformanceReports`）+ computeAll | FULL | 消费方式不同（解析文本 vs 数据驱动），产出等价（daily_rows ↔ bars，financial_rows ↔ performance_reports） | — |

### 2.4 `core/ui/theme.py`（122 行）+ MarkdownText

| # | 功能点（Python file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| T1 | `PALETTE` 亮/暗色板（theme.py:23-38） | `light`/`dark`（theme.ts:17-49） | FULL | **逐值一致**：primary #D32F2F/#EF5350、background #FFFFFF/#0E1117、secondary(surface) #F6F7F8/#262730、text #31333F/#FAFAFA；且与 `.streamlit/config.toml` [theme.light]/[theme.dark] 三方同值。TS 新增派生色（border/textSecondary/warn/error/ok/up/down） | — |
| T2 | `CSS` 注入：紧凑布局/圆角/表格圆角+斑马纹+表头品牌色下边框/expander 悬停（theme.py:46-121，@media prefers-color-scheme 分亮暗） | `useTheme` + 各组件 makeStyles（RN StyleSheet）+ MarkdownText markdownStyles | PARTIAL | Python 表格美化（斑马纹、表头 `2px solid $primary` 下边框、单元格圆角、expander 悬停变色）为 **Streamlit 专属 CSS 选择器**（`[data-testid=stMarkdownContainer]` 等），TS 无对应表格美化（日K 表为朴素行）。纯框架差异——Streamlit 渲染形态与 RN 渲染形态不同，非功能缺失 | NON_BLOCKER |
| T3 | 主题切换（@media prefers-color-scheme 精确匹配 Streamlit 主题） | `useColorScheme()`（theme.ts:50-54） | FULL | 语义等价：跟随系统亮/暗 | — |
| T4 | `baseRadius: 0.5rem`（theme.py:29,36） | `radius: { sm: 6, md: 8 }`（theme.ts:44,51） | FULL | 0.5rem≈8px 与 md 相当；框架差异可忽略 | — |
| T5 | MarkdownText（LLM 报告 markdown 渲染，Python 侧 = `st.write` display.py:514/516） | `MarkdownText.tsx`（react-native-markdown-display + 主题化样式 markdownStyles:8-38） | FULL | 覆盖：标题 h1-h4/粗斜体/删除线/链接/引用/列表/行内+块级代码/表格/分隔线/段落——与 st.markdown 常见渲染面等价（Github-Flavored 子集；edge 差异如 task list/脚注未测，**需人工确认**是否产品需要） | NON_BLOCKER |

---

## ③ MISSING / PARTIAL 汇总清单（移植/补齐时照此逐条）

### MISSING（无 TS 等价物）

| 编号 | 功能点 | Python 证据 | 缺口详情 | 阻断 |
|---|---|---|---|---|
| M1 | 按日涨跌幅柱图（change_percent_chart） | charts.py:144-163 | TS 无按日涨跌幅图；日K 表亦无涨跌幅列（见 P6）；仅最新一日 chip。数据可算（pipeline.ts:64） | **BLOCKER**（需补图或 phaseout 显式接受） |
| M2 | 财务跨期趋势折线（净利润/销售毛利率/每股收益） | charts.py:165-184（_FINANCIAL_LINES:32-36） | TS 无跨期财务图；数据在 performance_reports（store）齐全，业绩卡片仅 4 期且缺销售毛利率 | **BLOCKER**（需补或显式接受；数据齐备） |
| M3 | （框架面）TS `ReportScreen.tsx` 为**死代码**（未被任何文件 import；主路径是 App.tsx + ReportContent） | —（TS 侧备注） | 非 Python 差距；phaseout 时可清理 | — |

### PARTIAL（等价物存在但有功能缺失/行为差异）

| 编号 | 功能点 | 差异详情 | 阻断 |
|---|---|---|---|
| P1 | LLM 三键门控（display.py:21-32,375-377 vs settings.ts:85-88 + App.tsx:173-176） | Python 缺键硬阻断；TS 降级演示 LLM 继续跑（runner.ts buildLlm/demoLlm）。TS 刻意设计 | NON_BLOCKER |
| P2 | **亿信调用上限面板控件（display.py:143-146 收集 → set_runtime_overrides 生效 vs settings.ts caps 仅存储）** | TS 面板改上限**无效果**：assembleTools（runner.ts:170-177）不传 maxCalls、App.tsx 不写 env；billsTools 实际取 env/默认（billionsTools.ts:159-163）。控件存在但失效——接线缺口 | **BLOCKER**（需把 caps 注入 makeBillionsTools 或写 env） |
| P3 | LangSmith 设置（display.py:159-165,168-203 vs SettingsPanel.tsx:122-128） | Python 落 .env 被 SDK 消费；TS 仅持久化未接线（SettingsPanel.tsx:13 注释自认）。**需人工确认**是否移植遥测 | NON_BLOCKER |
| P4 | 配置持久化介质（update_env_file .env vs localStorage） | Python 服务端环境变量立即生效（同次 run 门控即通过）；TS localStorage 仅 web 端、不涉服务端 env（LLM 配置经 settings.keys 注入）。行为差异但各自自洽 | NON_BLOCKER |
| P5 | 密码框回显（display.py:232-233,251-285 R6 不留值 vs SettingsPanel.tsx:84 secureTextEntry 回显） | Python 不明文回显、不 log；TS 显示掩码值 | NON_BLOCKER |
| P6 | 日K 表（Python 60 行×8 列 data_markdown.py:313-314,259-283 vs TS 20 行×6 列 DataScreen.tsx:75-89,105-116） | **缺涨跌幅/换手率列**（核心行情列，BLOCKER）；行数截尾 20/60（展示取舍，NON_BLOCKER） | 列 **BLOCKER**；行数 NON_BLOCKER |
| P7 | 实时情报/亿信段结构化展示（MD3/MD4） | Python 分节表格渲染；TS 仅在「分析上下文原文」底部可见 | NON_BLOCKER（内容可见） |
| P8 | 收盘价独立线图（charts.py:127-143） | 被 K线主图（蜡烛+MA）覆盖，无独立图 | NON_BLOCKER |
| P9 | 观点 expander（display.py:509-516 vs ReportContent.tsx:61-93） | ① 默认展开态：Python 完成后初稿仍展开；TS 完成后默认折叠（仅流式中展开）。② 轮次标签「第 n 次观点」vs「初稿/对抗修订」。③ Python 通用 n 轮计数 vs TS 固定 2 槽（第 3+ 份丢弃；当前图仅 2 轮，等价） | NON_BLOCKER |
| P10 | 表格美化 CSS（theme.py:46-121） | Streamlit 专属选择器（斑马纹/表头品牌色/圆角/悬停）无 TS 对应；RN 朴素表 | NON_BLOCKER |
| P11 | 图表色值（charts.py:28-29 vs theme.ts up/down） | Python 固定 #E03131/#0B9464；TS 主题 up/down（亮 #D32F2F/#1a8f3d、暗 #EF5350/#4caf6d）。均为红涨绿跌、可读性已验证 | NON_BLOCKER |
| P12 | 概览 chips（Python 5 行表含「动量」 vs TS 6 chips 无动量） | 动量仅原文可见（DataScreen.tsx:146-157 底部） | NON_BLOCKER |
| P13 | 开关初始值来源（display.py:109-117 读 .env vs settings.ts:64-88 读 localStorage/默认） | Python `.env` 的 DISABLED 初值在 TS 面板不体现（TS 默认全开）；TS 开关跨重载持久化（与面板 caption 文案不符） | NON_BLOCKER |
| P14 | 财务表字段（Python 9 列 vs TS 业绩卡片 8 字段） | TS 缺「销售毛利率」字段展示（数据在 F10 盈利能力节有，chips 可见部分） | NON_BLOCKER |

---

## ④ spec 符合性结论（ts/index.md「能力接线」节核对）

| spec 接线点（ts/index.md） | UI 侧实现 | 结论 |
|---|---|---|
| 事件流协议（progress/report/token/roleStatus/done/error 六事件） | App.tsx:95-141 全量处理：report 清该 role 所有节点 partial（用事件时刻 `enabledRoles()` 而非挂载闭包——App.tsx:104-117 逐字对齐 spec）；roleStatus 'retry' 清 partial（App.tsx:125-130）；done 取 FinalReport（App.tsx:131-134） | ✅ 存在 |
| 流式输出（partials + 光标；槽位 partial ?? report 权威覆盖） | ReportContent.tsx streamText（32-44）+ slots（61-93）+ ▍光标 + 流式中默认展开 | ✅ 存在 |
| 图表（web-only、动态 import、多 pane stretch 布局、数据同源 computeAll、NaN 过滤、C/LEGEND 单点同源、柱 base:0 + 正负着色、theme up/down 半透明） | IndicatorChart.tsx 逐项实现（import type + 动态 import:126-136；PANE_STRETCH + setStretchFactor:137-141,185；useMemo 同源:DataScreen.tsx:44-47；lineData/histData NaN 过滤:143-164；C/LEGEND:23-66；base:0:175-177；hexToRgba up/down:179-181） | ✅ 存在 |
| 能力接线（亿信/mcp 情报段 → buildStockInformation；BILLIONS_{CAP}_MAX_CALLS env 可覆盖） | makeBillionsIntel/makeMcpIntel（runner.ts:118-158）→ App.tsx:213-218 → buildStockInformation → DataScreen 原文；**但面板 caps 未接线到 billsTools maxCalls（P2）——spec「env 可覆盖」仅剩 env 路径，面板控件失效** | ⚠️ 部分存在（P2 BLOCKER） |
| 主题（theme.ts） | light/dark 与 Python PALETTE + config.toml 三方逐值一致（T1） | ✅ 存在 |

**结论**：UI 能力接线点整体存在（事件/流式/图表/主题均按 spec 实现）；两处接线缺口需 phaseout 前处理——**P2 亿信上限控件未接线（BLOCKER）**、**P3 LangSmith 仅持久化（需人工确认）**；另 M1/M2/P6 为删 Python 前需补的用户可见展示缺口。

---

## 附：审计说明

- **防假阳性处理**：`report_tabs` ↔ `reportRoles`、`OPINION_REPORT_KEYS` ↔ `Role.opinion`、`is_bj_ticker` ↔ `startsWith('4'||'8')`、`_env_billions_max_calls` ↔ `maxCallsFor`、`to_markdown_tables` ↔ DataScreen JSX 均为「名字不同但功能等价」的配对，已按语义判定而非名字匹配；未发现因忽略设计注释（如 TS demoLlm 刻意降级）或变量误读导致的误报。
- **BY_DESIGN 标注**：北交所拦截（D21）与 akshare 备用路径不涉及本分片；无其他 BY_DESIGN 项。
- **交叉核对边界**：数据面（build_stock_information 五段、亿信/mcp 预查）归分片 2/6 详核，本分片仅核对 UI 消费形态。
