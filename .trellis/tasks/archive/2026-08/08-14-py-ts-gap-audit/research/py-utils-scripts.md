# 分片 8：Python 工具/配置/脚本面 → TS 功能差距审计

> 任务：08-14-py-ts-gap-audit 分片 8（Slice8UtilsScripts）。纯只读审计，零业务代码改动。
> 认领面：`utils/` 全部 8 文件 + `scripts/` 全部 2 文件 + `ts/tools/export_fixtures.py`。
> 对照面：`ts/src/format.ts`、`ts/src/log.ts`、`ts/src/gates.ts`、`ts/app/lib/settings.ts`、`ts/src/store.ts`、`ts/app/lib/runner.ts`，以及 grep 全仓（含 `ts/app`、`ts/test`）确认的功能等价物。

---

## ① 认领文件清单（逐文件已读）

| Python 文件 | 读取确认 |
|---|---|
| `utils/constants.py` | ✅ 全读（1.0KB） |
| `utils/formatting.py` | ✅ 全读（789B） |
| `utils/market_time.py` | ✅ 全读（2.4KB） |
| `utils/time_helper.py` | ✅ 全读（997B） |
| `utils/env_file.py` | ✅ 全读 raw（7.6KB） |
| `utils/runtime_config.py` | ✅ 全读 raw（4.7KB） |
| `utils/state.py` | ✅ 全读（572B） |
| `utils/billions_config.py` | ✅ 全读（4.4KB） |
| `scripts/backfill_f10_quarters.py` | ✅ 全读 raw（4.7KB） |
| `scripts/export_seed_002027.py` | ✅ 全读 raw（2.4KB） |
| `ts/tools/export_fixtures.py` | ✅ 全读 raw（4.2KB） |

TS 对照文件已读：`ts/src/format.ts`、`ts/src/log.ts`（raw）、`ts/src/gates.ts`（raw）、`ts/app/lib/settings.ts`（raw）、`ts/src/store.ts`（raw）、`ts/app/lib/runner.ts`（raw）、`ts/src/committee.ts`（raw）、`ts/src/billionsTools.ts`（raw）、`ts/src/webSearch.ts`、`ts/src/mcp.ts`、`ts/src/llm.ts`、`ts/src/pipeline.ts`、`ts/src/tdx/quoteClient.ts`、`ts/app/lib/logs-server.cjs`、`ts/app/App.tsx`、`ts/app/screens/SettingsPanel.tsx`、`ts/test/fixtures/*`。
参考 spec：`.trellis/spec/ts/index.md`（事件协议/流式/代理/图表/能力接线）、`.trellis/spec/architecture.md`（utils 定位）、`.trellis/spec/data_storage/index.md`、`.trellis/spec/data_structure/index.md`、归档任务 `08-13-ts-capability-completion/design.md`（is_trading_time 决策）。

---

## ② 功能点差距表

### utils/constants.py

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 1 | `default_start = 1997-01-01`（"无数据"时间基线；消费方 ZODBStorage 种子 `overview_last_updated`、ChinaStock 种子 `last_data_update`） | `utils/constants.py:4`；`data_storage/.../ZODBStorage.py:22`；`data_structure/.../ChinaStock.py:20` | TS 用 `null` 哨兵表达"无数据"：`StockRecord.lastDataUpdate: string \| null`；`addDatas` 以 `last === null → 全部新鲜` 过滤 | `ts/src/store.ts:25,132-133`；`ts/src/store-memory.ts:38-39` | **FULL** | 语义等价：Python 用 1997-01-01 日期基线（早于一切真实数据），TS 用 null。无墙钟下限常量需要（TS 采集侧 `fetchDailyBars` 从 start=0 全量分页拉取，`ts/src/tdx/quoteClient.ts:29-36`，去重靠 store）。 | NON_BLOCKER |
| 2 | `REPO_ROOT`（锚定仓库根，CWD 无关路径解析） | `utils/constants.py:7` | 无单一常量；路径按文件解析：日志 `path.join(process.cwd(), '..', 'logs')`（`SOA_LOG_DIR` 可覆盖） | `ts/app/lib/logs-server.cjs:29-31` | **BY_DESIGN** | TS 无 ZODB/parquet 缓存树等 CWD 依赖面（store 为 SQLite/InMemory），日志路径经 `SOA_LOG_DIR` 显式化。无等价常量需要。 | NON_BLOCKER |
| 3 | `china_db_path`（ZODB 文件路径） | `utils/constants.py:13` | 无 ZODB；TS 存储为 SQLite（构造 `dbPath` 参数，默认 `:memory:`） | `ts/src/store.ts:78` | **BY_DESIGN** | ZODB 整体不移植（存储分片覆盖）。 | NON_BLOCKER |
| 4 | `LOG_DIR` + main.py loguru sink（`logs/stock_operator_agent.log`，50MB 轮转 / 保留 10，幂等注册） | `utils/constants.py:15`；`main.py:14-21` | TS 统一日志多 transport：console（`[soa <level>]`）+ web POST 同源 `/logs`（server 落盘 `logs/soa-ts.log`，5MB 轮转 `.1`、4KB 截断、`\r\n` 净化）+ RN 沙盒文件（5MB 轮转）+ Node console | `ts/src/log.ts:24-27,92-104`（console/formatLine）；`ts/src/log.ts:105-145`（report/RnFile）；`ts/app/lib/logs-server.cjs:29-43,64-72` | **FULL** | 能力等价（console + 持久化 + 轮转 + 防注入）。参数差异（50MB/10 份 vs 5MB/1 份轮转、文件名不同）为实现参数非功能差异。 | NON_BLOCKER |

### utils/formatting.py

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 5 | `fmt_number(value, digits)`：None/NaN → `"N/A"`，数值 `f"{value:.{digits}f}"` 固定小数位 | `utils/formatting.py:20-24` | `fmtNumber(value, digits)`：null/undefined/NaN → `'N/A'`，`value.toFixed(digits)` | `ts/src/pipeline.ts:14-17`（消费点 pipeline.ts:55-77 与 Python stock_output_formatter 同构） | **FULL** | 行为对齐。判定实现差异：Python `isinstance(value, float) and pd.isna(value)`（pandas/numpy 标量）；TS `Number.isNaN(value)`——对两仓输入（pytdx NaN 浮点）行为一致。 | NON_BLOCKER |

### utils/market_time.py

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 6 | `is_trading_time(now=None)`：北京时间工作日 9:30–11:30 / 13:00–15:00 时段判定（now 可注入、任意时区转北京时间、naive 视为北京；周末/节假日保守 False） | `utils/market_time.py:35-52`；消费方唯一：`core/llms/tools/get_market_intel.py:92-95`（MCP 缓存判定） | **无等价函数**；且为显式设计决策不做 | `ts/src/mcp.ts:5-6`（「缓存简化决策：TS 无 is_trading_time 完整移植 → 不做缓存，每次实时查询」）；`.trellis/tasks/archive/2026-08/08-13-ts-capability-completion/design.md:30`；`.trellis/spec/ts/index.md`「能力接线」节 | **BY_DESIGN** | 决策出处明确：08-13-ts-capability-completion/design.md:30「TS 无 is_trading_time 完整移植（Python 节假日语义本身未实现）——不做缓存，每次实时查询」；`mcp_intel_cache.py` 不移植（ts/src/mcp.ts:6）。TS 无消费点需要该能力。grep 全仓（含 ts/app、ts/test）无 isTradingTime/tradingTime 等价实现。**注意**：本切片确认「现状 = 仍无移植」——08-13 mcp 设计提到的缺口维持原状，非本次审计遗漏。 | NON_BLOCKER |
| 7 | `latest_trading_day(stock)`：从日K 末根 bar 取最近交易日（零网络），无数据 → None | `utils/market_time.py:60-68` | 无同名函数；能力由 store 语义承载：`getDatas` 升序返回、末根即最近交易日；store 另维护 `lastDataUpdate` 作"最新数据日" | `ts/src/store.ts:205-216`（getDatas 升序）；`ts/src/store.ts:132-139`（lastDataUpdate 维护） | **PARTIAL** | TS 无独立封装（需要时 `store.getDatas(t).at(-1)?.date` 或读 `lastDataUpdate`）。且 Python 侧该函数当前**无生产消费方**（仅 test/utils/test_market_time.py 与 spec 08-02-market-hours-util R2 提及；get_market_intel 只用 is_trading_time）——TS 侧同样无消费方，随 Python 删无影响。 | NON_BLOCKER |

### utils/time_helper.py

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 8 | `asia_today()`：北京时间"今天"（全仓唯一"今天"来源，ZoneInfo 显式时区） | `utils/time_helper.py:12-15` | `asiaToday()`：`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })` | `ts/src/gates.ts:5-12`（注释：对齐 Python asia_today，全仓唯一"今天"来源） | **FULL** | 语义对齐（Asia/Shanghai 显式时区，不受进程 TZ 影响）。输出格式差异：Python date vs TS `YYYY-MM-DD` 字符串（TS 侧统一字符串契约）。 | NON_BLOCKER |
| 9 | `get_last_business_day(input_date)`：周六→周五(-1)、周日→周五(-2)、其余当天 | `utils/time_helper.py:17-28` | `getLastBusinessDay(dateStr)`：dow===0(日)→-2、dow===6(六)→-1 | `ts/src/gates.ts:15-20`（注释：移植自 Python time_helper） | **FULL** | 行为一致（UTC 日解析保证字符串日期逐字计算）。Python 的 `logger.debug` 无功能影响。无节假日日历为两侧共知缺陷（gates.ts:3 注释「节假日日历未建模，与 Python 侧一致保留」）。 | NON_BLOCKER |

### utils/env_file.py

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 10 | `UPDATE_WHITELIST`（UI 可写 .env 白名单 8 键，白名单外拒绝写入） | `utils/env_file.py:31-41` | 无（TS 无 .env 写路径） | — | **BY_DESIGN** | TS 配置持久化走 localStorage（web），无服务器文件写；`ts/app/.env.example` 仅读侧（EXPO_PUBLIC_*）。白名单概念不适用。 | NON_BLOCKER |
| 11 | `_validate(updates)`：LLM_MODEL 非空；LLM_BASE_URL http(s) 前缀；LANGSMITH_TRACING true/false 归一；密钥类键非空；LANGSMITH_PROJECT 可空 | `utils/env_file.py:55-78` | 校验能力分散等价：LLM 三键非空（`llmConfigured`/`missingLlmKeys`）；LLM_BASE_URL http(s) 前缀（`readLlmEnv`） | `ts/app/lib/settings.ts:122-124,131-137`；`ts/src/llm.ts:23-26`（URL 前缀校验） | **PARTIAL** | 部分等价：LLM 三键非空 + URL 前缀校验存在。差异：① LANGSMITH_TRACING 布尔归一不需要（TS `KeysState.langsmithTracing` 本身就是 boolean，settings.ts:40）；② 密钥类键非空校验在 TS UI 层缺失——`saveSettings` 允许保存空密钥（settings.ts:97-103 无校验；仅 LLM 三键经按钮禁用门控，SettingsPanel.tsx:85-90），Python 则对 4 个密钥键全部非空校验。 | NON_BLOCKER |
| 12 | `env_file_path()`：`ENV_FILE_PATH` env 覆盖 / `REPO_ROOT/.env`（e2e 隔离点） | `utils/env_file.py:80-90` | 无（TS 无 .env 写；读侧由 Expo 注入 EXPO_PUBLIC_*） | `ts/app/.env.example:1-4` | **BY_DESIGN** | e2e 隔离点属 Python Streamlit 测试基建，随 Python e2e 套件删。 | NON_BLOCKER |
| 13 | `update_env_file(updates, env_path)`：原子写 .env（保留行序/注释/白名单外键、原位替换、新键末尾追加带注释、`.env.tmp.<pid>` + `os.replace`、失败清理 tmp 返回 `(False, msg)` 不抛、成功后同步 os.environ 立即生效、密钥纪律不 log 值） | `utils/env_file.py:92-146`（消费方：`core/ui/display.py:208-215` 设置面板持久化区保存） | 用户可见能力等价：`saveSettings`（localStorage 持久化）+ `applySwitchesToEnv`（写入 process.env DISABLED 键，立即生效）；App 层接线 `onSettingsChange → saveSettings + applySwitchesToEnv` | `ts/app/lib/settings.ts:97-103,106-117`；`ts/app/App.tsx:128-133` | **PARTIAL** | 功能等价物 = settings.ts（持久化 + 立即生效），但机制差异显著：① 持久化介质 localStorage（per-browser）vs .env（服务器全局）——reload 后 web 保留、跨浏览器不共享；② 无原子写/行序保留（JSON 全量覆盖）；③ 无 `(False, 中文消息)` 失败契约（TS 保存失败静默 catch，settings.ts:100-103）；④ 无 os.environ 同步（以 process.env 突变替代——注意 Node 侧 process.env 突变不写回磁盘，服务器重启后 web 端保存的密钥丢失，Python 侧 .env 写则持久）。**需人工确认**：phaseout 后若 web 端保存的 LLM 密钥需要跨重启持久（当前 server.mjs 无配置落盘路径），需在 server 侧补配置持久化（不在本切片范围，标记为后续设计点）。 | NON_BLOCKER |

### utils/runtime_config.py

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 14 | `env_disabled(name)`：env 负极性判定原语（假值元组 `("", "0", "false", "no")`，**大小写敏感**） | `utils/runtime_config.py:32-38`（docstring：全库唯一假值判定） | 两个重复实现：`envDisabled`（webSearch.ts）+ `envDisabledBool`（committee.ts）；**均大小写不敏感**（`v.toLowerCase()`） | `ts/src/webSearch.ts:16-20`；`ts/src/committee.ts:31-35` | **PARTIAL** | ① TS 侧双实现漂移（Python 收敛单点，TS 两份同语义副本 + mcp.ts:197 第三处内联假值元组）；② 大小写差异：Python `"FALSE"`（大写）→ 禁用；TS `toLowerCase()` 后 → 不禁用。边界值（非小写假值）行为不同。 | NON_BLOCKER |
| 15 | `env_int(name, default)`：env 整数原语，缺失/非法 → 回退默认 | `utils/runtime_config.py:41-47` | 无通用原语；`maxCallsFor` 内联 env 读（`/^\d+$/` 校验，非法回退默认） | `ts/src/billionsTools.ts:159-166` | **PARTIAL** | 能力仅覆盖亿信上限路径（`BILLIONS_{CAP}_MAX_CALLS`）；Python 的通用 env_int（display.py:118-121 面板初始值也用它）在 TS 无对应——与 #18 面板 caps 未接线同源。 | NON_BLOCKER |
| 16 | `set_runtime_overrides` / `clear_runtime_overrides`：会话级内存覆盖层（键归一化：`_MAX_CALLS`→int 非法丢弃、其余→env-truthy bool；清空/全量替换；重启后消失回到 .env） | `utils/runtime_config.py:50-67`（消费方 display.py:169-183,395 会话区） | 机制不同：`applySwitchesToEnv` 直接突变 process.env（DISABLED 键，开→delete、关→'1'）；`mcpDisabled` 内联读 `TDX_MCP_ENABLED` 覆盖 | `ts/app/lib/settings.ts:106-117`；`ts/src/mcp.ts:194-200` | **PARTIAL** | 开关效果等价（TDX MCP / web 搜索 / 亿信总闸 / 5 能力闸均可达），但：① 机制：Python 独立 overlay 不碰 env；TS 直接写 env；② 持久性语义差异：Python 会话覆盖 reload 后清空回 .env；TS 开关持久化在 localStorage（reload 保留——比 Python 更持久）；③ `TDX_MCP_ENABLED` 覆盖在 TS 由 mcp.ts 内联处理（假值元组一致，mcp.ts:197）。 | NON_BLOCKER |
| 17 | `runtime_bool(key, env_fallback)`：覆盖层读（TDX_MCP_ENABLED / WEB_SEARCH_ENABLED / BILLIONS_MASTER / BILLIONS_{CAP}） | `utils/runtime_config.py:69-76`；消费方 `get_market_intel.py:45-46`（TDX_MCP_ENABLED）、`web_search.py:47-48`（WEB_SEARCH_ENABLED） | 部分覆盖：`TDX_MCP_ENABLED` 由 mcp.ts mcpDisabled 内联实现（等价）；**`WEB_SEARCH_ENABLED` 无覆盖支持**——TS `webSearchEnabled` 只读 `WEB_SEARCH_DISABLED`；`BILLIONS_*` 经 applySwitchesToEnv 的 env 突变表达 | `ts/src/mcp.ts:194-200`；`ts/src/webSearch.ts:22-24` | **PARTIAL** | 具体差异：手动设置 `WEB_SEARCH_ENABLED=false` 时 Python web_search_enabled 返回 False，TS webSearchEnabled 忽略该键仍按 WEB_SEARCH_DISABLED 判定。TS 面板开关经 applySwitchesToEnv 写 DISABLED 键（settings.ts:106-117）故面板路径不受影响——仅外部 env 直接注入场景差异。 | NON_BLOCKER |
| 18 | `runtime_int(key, env_fallback)` + 面板亿信上限（SEARCH 3 / TWITTER 2 / FETCH 3，display.py:343-358 收集 → set_runtime_overrides → bills_config.billions_max_calls 消费） | `utils/runtime_config.py:78-86`；`core/ui/display.py:343-358`；`utils/billions_config.py:84-103` | **面板 caps 未接线**：`CapsState`（searchMax/twitterMax/fetchMax）定义并渲染（SettingsPanel CAP_ROWS），`onSettingsChange` 仅 saveSettings + applySwitchesToEnv（**不含 caps**）；`assembleTools`/`makeBillionsTools` 不传 maxCalls → 工具只读 env 或默认值 | `ts/app/lib/settings.ts:18-22,46`；`ts/app/screens/SettingsPanel.tsx:31-34,55-63`；`ts/app/App.tsx:128-133`；`ts/app/lib/runner.ts:168-180`（assembleTools 无 maxCalls 参数）；`ts/src/billionsTools.ts:159-166`（maxCallsFor 仅 env/注入） | **MISSING（接线缺口）** | TS 设置面板的「亿信调用上限」输入保存后**无任何效果**（grep ts/app 全仓仅 settings.ts 定义 + SettingsPanel 渲染，无消费点）；Python 侧完整生效（面板 → 覆盖层 → 工具工厂）。仅 `env BILLIONS_{CAP}_MAX_CALLS`（Node/服务器端）与构造注入 maxCalls（测试）生效。修复建议（一行级）：App.tsx/runner.ts 把 `settings.caps` 传入 `assembleTools` → `makeBillionsTools({ maxCalls })`（billionsTools.ts:159-166 已支持 injected 参数）。 | **BLOCKER**（删 Python 前必须接线——用户可感知的 UI 功能在 TS 无效） |
| 18b | （配套）env truthy 归一化（`""/"0"/"false"/"no"` → False） | `utils/runtime_config.py:23,58-62` | TS 各实现同样基于同一假值元组（大小写不敏感） | `ts/src/webSearch.ts:16-20`、`ts/src/committee.ts:31-35`、`ts/src/mcp.ts:197` | FULL | 归一化语义一致（覆盖层路径两侧都大小写不敏感；差异仅 env_disabled 原语本身，见 #14）。 | NON_BLOCKER |

### utils/state.py

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 19 | `State` TypedDict（LangGraph 图状态 10 键：target_stock_ticker / stock_information / messages / fundamental_analysis / trend_analysis / technical_indicator_analysis / information_analysis / bullish_opinions / bearish_opinions / final_decision；messages 与双 opinions 用 `add_messages` reducer） | `utils/state.py:10-20` | `StateAnnotation = Annotation.Root({...})`：10 键逐一对齐，messages/bullish_opinions/bearish_opinions 用 `addMessages` reducer + `default: () => []`；`makeInvestmentCommittee` 用 `new StateGraph(StateAnnotation)` 装配；agents 节点按 stateKey 写回 | `ts/src/committee.ts:101-112`（StateAnnotation）；`ts/src/committee.ts:118`（makeInvestmentCommittee 图装配）、`ts/src/committee.ts:146`（makeInvestmentDecision 初始态注入）；`ts/src/agents.ts:25-27,129`（StateLike/写回）；`ts/src/agents.ts:178-190`（target/stock_information 读取） | **FULL** | 键集与 reducer 行为完全对齐（10/10 键，addMessages 追加语义一致——agents.ts:486-487 以 `.at(-1)` 读修订版与 Python 同）。类型严谨度差异：Python 强 TypedDict（Optional[str]）；TS `Annotation<string>()` 隐式可选 + agents.ts `StateLike = Record<string, unknown> & { messages?: unknown[] }` 松散（committee.ts:103 `CommitteeState = typeof StateAnnotation.State` 提供强类型面）——运行时语义一致，仅编译期约束不同。 | NON_BLOCKER |

### utils/billions_config.py

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 20 | `billions_enabled(capability)`：主闸 `BILLIONS_API_KEY` 存在 **且** 总闸开 **且** 能力闸开；覆盖层优先（BILLIONS_MASTER False→全关、BILLIONS_{CAP}） | `utils/billions_config.py:35-57`（消费方：billions_fin_db.py:59、billions_search/twitter/fetch 工厂、investment_committee.py:68） | `billionsEnabled(cap)`：总闸 + 能力闸；**无主闸 key 约束**（committee.ts:44-45 注释明示「TS billionsEnabled 无 key 约束（现状）」）；key 硬约束单点下放到工具层 `billionsCapEnabled`（`!apiKey && !process.env.BILLIONS_API_KEY → false`） | `ts/src/committee.ts:37-40`；`ts/src/billionsTools.ts:153-157`（billionsCapEnabled）；接线：runner.ts:131-138（makeBillionsIntel 判 FINDB）+ assembleTools（runner.ts:168-180） | **PARTIAL** | 语义结构等价（总闸/能力闸/默认开），key 约束位置不同：Python 在谓词层（图装配前决定工具不绑定/段为空串），TS 在工具工厂层（谓词恒 True，工厂返回 undefined）。净效果（工具绑定）一致，但对信息面分析师注册谓词的级联差异见 #21。差异已被 08-13 决策记录接受（committee.ts:44-45 注释 + ts/index.md 能力接线）。 | NON_BLOCKER |
| 21 | `billions_cap_switch(capability)`：无 key 约束的能力开关（信息面分析师 ANALYST 段谓词用）；分析师注册 = cap_switch(ANALYST) ∧ (billions_enabled(SEARCH) ∨ billions_enabled(TWITTER) ∨ web_search_enabled()) | `utils/billions_config.py:61-82`；`core/role_registry.py:50-54` | 无独立 cap_switch（TS billionsEnabled 本身即无 key 约束 ≈ Python cap_switch 语义）；分析师谓词 `informationAnalystEnabled()`：billionsEnabled(ANALYST) ∧ (billionsEnabled(SEARCH) ∨ billionsEnabled(TWITTER) ∨ webSearchEnabled()) | `ts/src/committee.ts:42-47,61`（informationAnalystEnabled + ROLES 注册） | **PARTIAL** | 公式同构，但边界组合差异：无 `BILLIONS_API_KEY` 且亿信开关开、web 搜索关时——Python 的 SEARCH/TWITTER 项因 key 约束为 False → 分析师不注册；TS 的 SEARCH/TWITTER 项为 True → 分析师注册（预抓走亿信无 key 降级占位或 DDG）。committee.ts:42-47 注释记录该现状（「分析师默认 env 恒注册，web 开时经 /web-search/DDG 兜底预抓」）。 | NON_BLOCKER |
| 22 | `billions_max_calls(capability, default)`：env `BILLIONS_{CAP}_MAX_CALLS` + 覆盖层读上限，非法回退默认（search 3 / twitter 2 / fetch 3） | `utils/billions_config.py:84-103` | `maxCallsFor(cap, injected?)`：env `/^\d+$/` 校验 + `BILLIONS_DEFAULT_MAX`（SEARCH 3/TWITTER 2/FETCH 3）+ 构造注入 maxCalls；调用上限计数 `cappedCall`（counter 闭包，超限占位不 raise） | `ts/src/billionsTools.ts:17-21,121-136,159-166`（cappedCall/maxCallsFor）；消费点三工具工厂 | **PARTIAL** | env + 默认值等价；差异：① 无 runtime overlay（TS 用构造注入替代——但面板 caps 未接线，见 #18）；② Python 上限可被覆盖层每会话改，TS 仅 env/注入。其余（非法回退默认、超限占位文本不 raise）对齐。 | NON_BLOCKER（除 #18 的 BLOCKER） |

### scripts/backfill_f10_quarters.py

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 23 | 运维脚本（一次性）：枚举有 raw 缓存的 ticker → `build_reports`（非 vendor 解析器，表 1+表 2 含季度）→ 按 report_date 合并替换 ZODB `performance_reports`（绕过 freshness 门与 add_performance_reports 递增去重；幂等）；支持 `--ticker` 单只；批量计数 | `scripts/backfill_f10_quarters.py`（docstring:1-22、_ticker_from_ts_code:38-43、_cached_tickers:45-54、backfill_one:56-88、main:90-106） | 无等价物；且无需 | TS F10 解析自始全表：`parseFinanceIndicatorsAllTables`（ts/test/f10.test.ts:9「matches Python (180 rows)」）；收集时即全表入库：`applyCollectedToStore` 内 `setMeta('f10:…')` + `composeReports`（ts/src/webCollect.ts:31-38、ts/src/reports.ts） | **BY_DESIGN** | 成因是 Python vendor 解析器历史 bug（docstring:1-6）导致存量 ZODB 缺季度期——TS 自始无此缺陷，store（SQLite/InMemory）无历史数据问题，无需重灌。随 Python 删（NON_BLOCKER）。 | NON_BLOCKER |

### scripts/export_seed_002027.py

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 24 | 运维脚本（一次性，需网络/存储）：`build_stock_information("002027")` 输出原样写入 `test/e2e/seed/fixture_002027.txt`（Python Playwright UI 测试种子；含无 TDX_API_KEY 降级占位段确定性说明） | `scripts/export_seed_002027.py`（docstring:1-22、main:26-47）；消费方 `test/e2e/mock_app.py:46-64` | 无等价物；TS 无 Playwright e2e（ts/test 全 vitest 单测，无 e2e 目录）；TS 演示种子机制 = `loadDemoData`（demo.json 250 根日K + F10） | `ts/app/lib/runner.ts:20-29`；`ts/app/data/demo.json` | **BY_DESIGN** | Python 测试基建，随 Python e2e 套件删（phaseout 后无 mock_app 消费方）。TS 侧演示数据走 demo.json（等价"静态种子"角色）。 | NON_BLOCKER |

### ts/tools/export_fixtures.py（Python 侧工具，服务 TS 测试）

| # | Python 功能点 | Python 证据 | TS 等价物 | TS 证据 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|---|
| 25 | 生成器：以 Python 仓库为 oracle 产出 TS 等价性测试 fixtures——`600036_daily.json`（raw 12 列 mapping + qfq adjusted + xdxr 事件）、`600036_indicators.json`（最近 250 根 compute_all + MACD_VH/LIU_BIAS extra）、`f10_tdx.txt`（通达信 F10）、`f10_hk.txt`（港澳资讯 F10） | `ts/tools/export_fixtures.py`（docstring:1-12、main:32-74；依赖 tdx_source fetch、mapping.to_akshare_hist_schema、adjust.qfq_adjust、scripts.data_pipeline.indicators.compute_all、core.llms.tools.extra_indicators、`/tmp/f10_text.txt` 手工预拉取） | 无 TS 版生成器；但 fixtures **已静态入库**且被 9 个 TS 测试消费：events/f10/indicators/live.integration/overview/pipeline/qfq/reports（prompt 用 prompts.json，另源） | `ts/test/fixtures/{600036_daily.json,600036_indicators.json,f10_tdx.txt,f10_hk.txt}`（gitignore-aware glob 确认已入库）；消费点 `ts/test/qfq.test.ts:8-11,38-39`、`ts/test/indicators.test.ts:5-10`、`ts/test/reports.test.ts:83-118` 等 | **PARTIAL** | 现状不阻断：fixtures 静态入库，不重生成测试仍绿。phaseout 后 Python oracle 消失，重生成需 TS 侧生成器——可行性已具备（TS 已移植全部数据能力：quoteClient.fetchDailyBars 全量拉取、adjust.ts qfqAdjust、indicators.ts computeAll + extra 指标、collectAll 产出 F10 文本），建议移植为 `ts/tools/export-fixtures.mts`（或在 phaseout 任务中明确冻结 fixtures + 冻结回归语义——等价性测试退化为自回归测试）。注意脚本含硬编码 `/tmp/f10_text.txt` 与 `/home/tan/StockOperatorAgent` REPO 路径（export_fixtures.py:6,67），本就属一次性手工步骤。 | NON_BLOCKER |

### TS 对照面补充核对（format.ts / gates.ts / settings.ts / store.ts / runner.ts）

| TS 文件 | 内容 | 与本切片 Python 面的对应 | 状态 |
|---|---|---|---|
| `ts/src/format.ts:7-8` `fmtDate`（YYYYMMDD → YYYY-MM-DD 幂等） | TS 独有展示 helper | Python utils 层无对应函数；Python 显示层（data_markdown/charts）内联做日期格式化（UI 分片覆盖）。无缺口。 | —（非差距） |
| `ts/src/gates.ts` `asiaToday`/`getLastBusinessDay`/`overviewNeedsRefresh`/`latestPastQuarterEnd`/`reportsFresh`/`FetchScope` | 移植自 Python data_acquisition/time_helper（gates.ts:1-3 注释） | asiaToday/getLastBusinessDay = time_helper #8/#9（FULL）；其余（overview/reports 新鲜度门、FetchScope）属数据采集分片，与本切片无重叠 | 见 #8/#9 |
| `ts/app/lib/settings.ts` 全量 | 设置状态四节（模型密钥/LangSmith/开关/上限） | = env_file #10-13 + runtime_config #16-18 的 TS 承载面（差异已列） | 见上 |
| `ts/src/store.ts` | SQLite 仓储（与 state.py 的 State 无直接对应——State 是图状态，store 是持久层；state.py 对应物为 committee.ts StateAnnotation #19） | 对照任务描述修正：`store.ts` 用于核对 `lastDataUpdate`/getDatas（#1/#7）而非 State 键 | 见 #1/#7/#19 |
| `ts/app/lib/runner.ts` | 事件桥接线：store/demo 数据/LLM 构建/亿信+mcp 情报段/工具组装 | env 读取语义：LLM 三键来自 localStorage + `EXPO_PUBLIC_LLM_*` env 兜底（settings.ts:58-93 loadSettings，注释「对齐 Python 读 .env 的配置语义」）；亿信 key 经 `settings.keys.billionsApiKey` 构造注入（runner.ts:131-138,168-180，注释「不读 process.env——Metro 不内联非 EXPO_PUBLIC 变量」）——与 Python 直接读 .env/os.environ 的差异已并入 #13/#20 | 见 #13/#20 |

---

## ③ MISSING + PARTIAL 汇总清单（phaseout 移植时逐条对照）

**MISSING（1 项）**

| # | Python 功能点 | 缺口 | 建议 |
|---|---|---|---|
| M1 | 亿信调用上限面板接线（Python：display.py:343-358 面板 → set_runtime_overrides → runtime_int → billions_max_calls 全链生效；TS：SettingsPanel caps 输入保存后无消费点） | TS 设置面板「亿信搜索/推特/抓取调用上限」UI 存在但不生效（settings.ts:18-22 定义、SettingsPanel.tsx:31-34 渲染、App.tsx:128-133 仅 saveSettings+applySwitchesToEnv；billionsTools.ts:159-166 maxCallsFor 只读 env/注入） | **BLOCKER**：删 Python 前接线——`assembleTools` 增加 maxCalls 参数，App.tsx 传 `settings.caps`；billionsTools.ts 的 `injected` 参数已就绪（:160-161） |

**PARTIAL（9 项）**

| # | Python 功能点 | TS 等价物 | 具体差异 |
|---|---|---|---|
| P1 | `latest_trading_day`（market_time.py:60-68） | store 语义（getDatas 升序末根 / lastDataUpdate） | 无独立函数封装；且 Python 侧亦无生产消费方（仅测试+spec），可随 Python 删 |
| P2 | `_validate` 密钥非空校验（env_file.py:55-78） | llmConfigured/missingLlmKeys + readLlmEnv | TS 无 4 密钥键非空校验（settings.saveSettings 可存空密钥）；LLM 三键经按钮禁用门控兜底；LANGSMITH_TRACING 归一不需要（boolean 类型） |
| P3 | `update_env_file` 原子写（env_file.py:92-146） | saveSettings + applySwitchesToEnv | 持久化介质 localStorage vs .env；无原子写/行序保留/白名单；无 (False, msg) 失败契约；Node 侧 process.env 突变不落盘（服务器重启丢 web 保存密钥）——**需人工确认**是否补 server 侧配置持久化 |
| P4 | `env_disabled`（runtime_config.py:32-38） | webSearch.envDisabled + committee.envDisabledBool | TS 双实现漂移（+mcp.ts:197 第三处内联元组）；大小写差异：Python "FALSE"→禁用，TS toLowerCase → 不禁用 |
| P5 | `env_int`（runtime_config.py:41-47） | billsTools.maxCallsFor 内联 | 无通用原语；仅亿信上限路径覆盖（与 M1 同源） |
| P6 | `set_runtime_overrides` 会话覆盖（runtime_config.py:50-67） | applySwitchesToEnv（env 突变）+ mcp.ts 内联 TDX_MCP_ENABLED | 机制不同（overlay vs env 突变）；持久性差异（TS 开关 localStorage 跨 reload 保留，Python 会话级 reload 清空） |
| P7 | `runtime_bool` 的 WEB_SEARCH_ENABLED 覆盖（runtime_config.py:69-76 + web_search.py:47-48） | webSearchEnabled（webSearch.ts:22-24） | TS 不读 WEB_SEARCH_ENABLED 键（外部 env 直接注入场景差异；面板路径经 DISABLED 键不受影响） |
| P8 | `billions_enabled` 主闸 key 约束（billions_config.py:35-57） | committee.billionsEnabled + billsTools.billionsCapEnabled | key 约束位置下移到工具层（谓词恒注册、工厂返回 undefined）；级联影响分析师注册谓词（#21 边界组合），08-13 决策已记录接受 |
| P9 | `billions_max_calls` 覆盖层读（billions_config.py:84-103） | maxCallsFor（env + 注入） | 无 runtime overlay（TS 注入替代）；面板 caps 未接线（M1） |

**BY_DESIGN（6 项，均有决策出处）**：#2 REPO_ROOT、#3 china_db_path（ZODB 不移植）、#6 is_trading_time（08-13-ts-capability-completion/design.md:30 + ts/src/mcp.ts:5-6 + spec ts/index.md 能力接线——**确认现状 = 仍无移植，决策留档完整**）、#10/#12 .env 白名单/ENV_FILE_PATH（web 无 .env 写）、#23 backfill_f10_quarters（TS 无历史数据缺陷）、#24 export_seed_002027（Python e2e 基建）。

**FULL（6 项）**：#1 default_start（null 哨兵等价）、#4 LOG_DIR/loguru（log.ts 多 transport + logs-server.cjs）、#5 fmt_number（pipeline.fmtNumber）、#8 asia_today（gates.asiaToday）、#9 get_last_business_day（gates.getLastBusinessDay）、#19 State 键（committee.StateAnnotation 10/10 对齐）。

**TS 侧附加发现（非 Python 缺口，供 phaseout 参考）**：
- TS 假值判定三处重复（webSearch.ts:16-20 / committee.ts:31-35 / mcp.ts:197），违反 Python 侧「全库唯一假值判定」收敛原则（code-reuse-thinking-guide），建议 phaseout 时收敛单点。
- ts/tools/export_fixtures.py 含硬编码绝对路径（`/home/tan/StockOperatorAgent`、`/tmp/f10_text.txt`），一次性手工步骤，移植 TS 生成器时一并清理。

---

## ④ spec 符合性结论（能力接线点核对）

对照 `.trellis/spec/ts/index.md`「能力接线（08-13-ts-capability-completion；Python phase out 后唯一实现）」节：

| spec 能力接线点 | 是否存在 | 证据 | 与本切片相关的缺口 |
|---|---|---|---|
| 亿信（billionsClient + billsTools 三件套 + 分析师预抓 + key web 端 localStorage 注入） | ✅ 存在 | billsClient.ts / billsTools.ts:168-270 / agents.ts:422-473 / runner.ts:131-138,168-180 | #20/#21 key 约束位置差异（spec 已记录）；**M1 caps 面板未接线**（spec「env `BILLIONS_{CAP}_MAX_CALLS` 可覆盖」成立，但 UI 上限输入无效果——接线点缺一环） |
| mcp 实时情报（门控 + 无 key 占位 + 摘要；**不做缓存**，TS 无 is_trading_time 移植） | ✅ 存在 | mcp.ts:194-243 / runner.ts:155-163 | is_trading_time 无接线点需求（BY_DESIGN，spec 明确记录）；本切片确认现状与 08-13 决策一致 |
| qfq 前复权（collectAll 内 fetchXdxrEvents → applyQfq，失败降级 raw） | ✅ 存在 | quoteClient.ts:106-131,133+ | 与本切片无重叠（数据采集分片覆盖） |
| 北交所 / akshare 不支持（用户决策 08-13） | ✅ 记录 | spec「北交所/akshare：明确不支持」；App.tsx 入口拦截 | 本切片无涉及 |
| 事件协议 / 流式 / 图表 | ✅ 存在 | events.ts / retry.ts / IndicatorChart.tsx | 与本切片无重叠（events/LLM/UI 分片覆盖） |
| 设置面板（四节：模型密钥/LangSmith/开关/上限）——本切片对应面 | ⚠️ 部分 | settings.ts:18-46（四节齐全）+ SettingsPanel.tsx（渲染齐全）+ App.tsx:128-133（保存/开关应用） | **开关与密钥节接线完整；上限节（caps）仅存 UI，未接线（M1，BLOCKER）**；密钥持久化介质差异（#13，需人工确认 server 侧是否需要配置落盘） |

**结论**：spec「能力接线」核心点（亿信/mcp/qfq/北交所决策）均存在且有生产接线，与 utils/scripts 面相关的接线点中**唯一缺口 = 亿信调用上限面板未接线（M1）**——删除 Python 前需补齐；`is_trading_time` 为 BY_DESIGN（无接线点需要，决策出处完整）。其余差异（env 原语大小写、双实现漂移、覆盖层机制差异、.env 写介质）为边界行为或架构差异，均 NON_BLOCKER，其中 #13（web 保存密钥跨重启持久化）建议 phaseout 计划中明确设计决策。

---

*审计日期：2026-08-14。防假阳性措施：TS 侧 grep 全仓（ts/src、ts/app、ts/test、含 dist 产物交叉验证）；所有 PARTIAL 差异均给出 Python/TS 双侧 file:line 并说明行为语义；「billionsEnabled 无 key 约束」「caps 未接线」等结论以源码直接核对为准（非设计注释推断，相关注释仅作佐证）；拿不准项（#13 持久化需求）已标注「需人工确认」。*
