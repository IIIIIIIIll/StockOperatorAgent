# 分片 4：py-agents —— Python Agent 面 → TS agents.ts 功能差距审计

> 审计日期：2026-08-14。纯只读审计，零业务代码改动（本文件是唯一产出）。
> 比对方法：逐文件精读 + AST/模板字面量脚本字节级比对（`/tmp/gap_py_queries.py`、`/tmp/gap_ts_templates.js`，工作树外）：
> - Python 侧：ast 解析 9 个查询 f-string + prompt.py 全部字符串，插值替换为标记（TICKER/SI/FA/TA/TIA/BU/BE/INFO/CTX/OPP/OWN）后求值，repr 固化为字节基线；
> - TS 侧：提取 agents.ts / prompt.ts 全部模板字面量，`${expr}` 替换为同标记后 eval（`\n` 转义还原），JSON 输出；
> - 两侧同标记字符串逐字节比对（Python 侧基线同时被 `test/agents/test_query_baselines.py` 的 repr 基线钉死，2026-08-08 实跑抓取）。
> 结论：**10/10 系统提示词（system_prompt + 9 角色消息）逐字节一致；9/9 查询模板存在空白字节漂移（下述）；无 MISSING。**

---

## ① 认领文件清单（逐文件已读）

| 文件 | 行数 | 已读方式 |
|---|---|---|
| `agents/base.py` | 142 | 全文 raw |
| `agents/chinese_mainland/fundamental_analysis_expert.py` | 31 | 全文 raw |
| `agents/chinese_mainland/trend_analysis_expert.py` | 30 | 全文 raw |
| `agents/chinese_mainland/technical_indicator_analyst.py` | 30 | 全文 raw |
| `agents/chinese_mainland/information_analyst.py` | 211 | 全文 raw |
| `agents/chinese_mainland/bullish_trader.py` | 69 | 全文 raw |
| `agents/chinese_mainland/bearish_trader.py` | 69 | 全文 raw |
| `agents/chinese_mainland/investment_manager.py` | 54 | 全文 raw |
| `ts/src/agents.ts` | 539 | 全文 3 段 + 关键行号 grep |

支撑证据（跨片引用，非认领）：
- `core/llms/prompt.py`（10 常量）vs `ts/src/prompt.ts`（10 常量）——逐字节一致（脚本比对 ALL MATCH）。
- `core/role_registry.py`（谓词/工厂）vs `ts/src/committee.ts`（ROLES/谓词/工具装配）。
- `core/investment_committee.py:110-126`（工具绑定）vs `ts/src/committee.ts:128-129` + `ts/app/lib/runner.ts:168-177`。
- `utils/time_helper.py:25-39`（get_last_business_day）vs `ts/src/gates.ts:15-20`——语义一致（周六→周五、周日→周五、其余当天，输出 YYYY-MM-DD）。
- `core/llms/tool_loop.py:29`（默认 15 轮）vs `ts/src/toolLoop.ts:12`（MAX_TOOL_ROUNDS=15）——一致。
- `core/llms/retry.py:22-26` vs `ts/src/retry.ts:10-16`——attempts 3 / base 1.0 / max 8.0 / 可重试 429,500,502,503,504 一致。
- `core/llms/progress.py` vs `ts/src/progress.ts`——safe_progress/push_report 对齐；TS 另有 safePushStatus/safePushDelta（扩展）。
- `core/llms/tools/web_search.py:83-101`（_summarize_results）vs `ts/src/webSearch.ts:27-43`——格式逐字节一致。
- `test/agents/test_query_baselines.py`（Python 查询字节基线）与 `ts/test/agents.test.ts`（TS 预抓查询/参数钉死）、`ts/test/query-content.test.ts`（TS 查询子串断言）。

---

## ② 功能点差距表

### A. `agents/base.py`（AgentNode 基类）→ `ts/src/agents.ts:44-172`

| # | 功能点 | Python | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| A1 | 构造器：prompt 壳（system_prompt + `query` MessagesPlaceholder）+ `system_message`/`current_date` partial | base.py:47-55 | agents.ts:51-70（systemText 替换 + ChatPromptTemplate） | FULL | `system_prompt` 文本两侧逐字节一致（`必须使用提供的真实数据…{system_message}…当前日期：{current_date}。`）；current_date=本地"最近交易日"：PY `get_last_business_day(datetime.date.today())`（time_helper.py:25-39）vs TS `getLastBusinessDay(localToday())`（gates.ts:15-20）——周末回退语义一致 | NON_BLOCKER |
| A2 | 构造器：可选 bind_tools + NotImplementedError 回退 | base.py:56-63 | agents.ts:62-68 | PARTIAL | TS 先判 `typeof llm.bindTools === 'function'` 再 try/catch（catch 全部）；Python 直接调 `llm.bind_tools(tools)` 只捕获 NotImplementedError——无 bind_tools 的 LLM 在 Python 抛 AttributeError，TS 静默跳过。仅离线假 LLM 边角；真实 LLM 均有 bind_tools | NON_BLOCKER |
| A3 | 构造器：保存 tools 列表 | base.py:64-66 | agents.ts:69-70 | FULL | — | NON_BLOCKER |
| A4 | `build_chain`（revise 第二条链：同壳 partial + 复用已绑定 llm） | base.py:68-82 | agents.ts:81-92 | FULL | 双链共享同一已绑定实例 | NON_BLOCKER |
| A5 | `complete_expert` 骨架：safe_progress → invoke_with_retry(`{"query": query}`) → push_report → `{"messages": [query[0], response], state_key: content}` | base.py:84-104 | agents.ts:116-132（streamOrInvoke + status/delta） | PARTIAL | ① TS 增 node 状态 `running`/`done`（safePushStatus）与流式 delta（有 `.stream()` 走 streamWithRetry，无则 invokeWithRetry+单次全量 delta）——**TS 超集（能力扩展，非缺口）**；② Python 有 `logger.debug` 查询/响应日志，TS 无（log.ts 不记节点查询）；③ messages 通道里 response 形状：Python AIMessage（langchain）vs TS `{content, tool_calls?}` 普通对象——events/App 消费需人工确认 | NON_BLOCKER |
| A6 | `complete_with_tools` 骨架：invoke_with_tools(chain 缺省 self.llm；max_tool_rounds None→tool_loop 默认 15；修订轮传 3) → push_report → `{"messages": 全量, state_key: content}` | base.py:106-132 | agents.ts:135-158 + toolLoop.ts:12,49 | FULL | 轮数默认两侧均 15（tool_loop.py:29 / toolLoop.ts:12），修订轮两侧均 3；progress_updater 透传一致；TS 增 onDelta/onRetry/onReset（流式扩展） | NON_BLOCKER |
| A7 | `info_section` 信息面条件段（key 缺失→空串） | base.py:135-142 | agents.ts:166-172 | FULL | 模板 `\n        信息面分析报告: \n        {x}\n        ` 逐字节一致（脚本比对） | NON_BLOCKER |
| A8 | 节点级即时 push_report（不等同 superstep 慢节点） | base.py:99,124 | agents.ts:126,149 | FULL | — | NON_BLOCKER |

### B. 三专家（FundamentalAnalysisExpert / TrendAnalysisExpert / TechnicalIndicatorAnalyst）

| # | 功能点 | Python | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| B1 | 构造：role_message 注入，无 tools（专家工厂忽略 tools） | fundamental:11-13 / trend:11-13 / technical:11-13 | agents.ts:193-195 / 207-209 / 221-223 | FULL | 3 个角色 system 消息逐字节一致（脚本比对） | NON_BLOCKER |
| B2 | 查询构建 f-string（ticker + stock_information） | fundamental:18-22 / trend:17-21 / technical:17-21 | agents.ts:198 / 212 / 226 | PARTIAL | **字节漂移（每查询 1 处）**：Python 标题行尾为 `分析\n`（转义）＋源行换行 → `分析\n\n        SI`；TS 为 `分析\n        SI`（少 1 个 `\n`）。脚本比对：fundamental PY 59B vs TS 58B；trend 58 vs 57；technical 60 vs 59（标记值 TICKER/SI 下）。差异为空白行，不影响语义；TS 测试仅 toContain（query-content.test.ts:84）不钉字节 | NON_BLOCKER（若 M3 逐字契约须严格成立则 phaseout 前需统一字节——见 ③） |
| B3 | complete_expert 入参：state_key / start-done 文案 / log_label | 各文件末尾 | agents.ts:199-204 / 213-217 / 227-231 | PARTIAL | **progress 文案 9/9 不同**（见下表 C8 汇总）：PY「开始基本面分析报告生成。。。」/「基本面分析报告生成完成。。。」vs TS「基本面分析师开始分析...」/「基本面分析师完成分析」；log_label 一致（Fundamental Analysis Expert / Trend Analysis Expert / Technical Indicator Analyst） | NON_BLOCKER |

### C. `agents/chinese_mainland/information_analyst.py` → `ts/src/agents.ts:326-470`

| # | 功能点 | Python | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| C1 | 构造：`_client`/`_searcher` 注入保留（测试 fake，house style） | information_analyst.py:71-78 | agents.ts:327-335 | FULL | 注入点两侧均保留 | NON_BLOCKER |
| C2 | `_get_client` 懒加载 BillionsClient | :80-85 | agents.ts:340-344 | FULL | 均懒构造、构造零副作用 | NON_BLOCKER |
| C3 | `_get_web_tool` 懒加载（make_web_search_tool 单点复用） | :87-95 | agents.ts:331（构造默认 `_searcher = defaultSearcher()`） | PARTIAL | 实现差异：Python 首次 web 回退时才构造（langchain DuckDuckGoSearchResults，cn-zh，max_results=5）；TS 在**实例构造时**求值 `defaultSearcher()`（浏览器→同源 `/web-search` 代理；Node→Tavily 优先/DDG html+news.js）。供应商/时机不同，降级语义等价（webSearch.ts 属 slice 3 详审） | NON_BLOCKER |
| C4 | `_search_section`：单源 search 预抓（fast + count + time_range），失败/空 →「【标签】检索失败/无返回结果」注明，不 raise | :97-115 | agents.ts:348-368 | PARTIAL | ① **`_COUNT`：PY=5（:53）vs TS=10（agents.ts:238）**——每源实际请求条数不同（素材量与成本不同；TS 测试钉死 count 10，ts/test/agents.test.ts:140）；② **`_QUERY_TEMPLATES["announcement"]`：PY「{} 最新公告」（:58）vs TS「{} 公告」（agents.ts:243）**——检索词不同（TS 测试钉死 '600036 公告'，agents.test.ts:134）；report/web/twitter 检索词一致（券商研报/最新新闻/最新市场讨论）；分节失败/空文案逐字节一致 | NON_BLOCKER |
| C5 | `_twitter_section`：twitter 预抓，失败/空注明 | :118-135 | agents.ts:371-393 | PARTIAL | 同 C4 的 count 5 vs 10；twitter 检索词与失败/空文案一致 | NON_BLOCKER |
| C6 | `_web_search_section`：固定 1 次 DDG 查询（`{} 最新新闻`）→ 中文摘要节；失败 → 占位不 raise | :138-151 | agents.ts:396-404 | FULL | 占位「（联网搜索失败：…）」一致；summarizeResults（webSearch.ts:27-43）与 _summarize_results（web_search.py:83-101）格式逐字节一致（`标题：/链接：/摘要：/日期：`＋`；`连接、`- `前缀、`【联网搜索结果】\n` 头、空结果「（联网搜索失败：无返回结果）」） | NON_BLOCKER |
| C7 | `_prefetch` 门控：billions_enabled(SEARCH/TWITTER) + web_search_enabled() + 主闸 key；「检索结果】」真实素材判定；双失败→返回 []（调用方落固定回退文本）；全关→不构造 client | :153-186 | agents.ts:416-447 | PARTIAL | ① 主闸位置不同但净行为一致：PY 在 `billions_enabled` 内（无 key→SEARCH/TWITTER 直接 False，:153-186 调 utils/billions_config.py:19-38），TS 在 `client.hasApiKey`（agents.ts:427）——两侧无 key 均静默关亿信路径；② 门控开关机制：PY 读 runtime 覆盖层（runtime_config）+ env，TS 仅 env（committee.ts:37-40）——web 端 UI 开关经 settings.ts applySwitchesToEnv 写 process.env（等效控制，机制不同）；③ **web 端接线缺口（需人工确认）**：committee 工厂 `expert(BillionsInformationAnalyst)`（committee.ts:61）不传 `_billionsClient`，App/runner 也无注入（仅 assembleTools 给 trader/manager 工具与 makeBillionsIntel 给 pipeline 段注 key）→ web 端分析师预抓的亿信三源+twitter 恒关（key 进不来，Metro 不内联非 EXPO_PUBLIC env），只走 DDG web 回退；Python 桌面端（.env 配 key）亿信预抓可用。spec 能力接线节把「agents.ts 信息面分析师预抓」列为接线点但无 key 注入路径 | ③ 需人工确认；NON_BLOCKER（不阻断删 Python；若产品要求 web 端亿信预抓则为接线缺口） |
| C8 | `information_analyst` 节点：safe_progress 预抓进度 → context 组装 → complete_expert | :188-210 | agents.ts:451-470 | PARTIAL | ① **查询字节漂移 4 处**（见 ③）；② progress 文案：预抓段 PY「开始信息面素材检索。。。」与 TS「开始信息面素材检索。。。」**一致**；LLM 段 PY「开始信息面分析报告生成。。。」vs TS「信息面分析师开始分析...」；③ ticker 取值：PY `state['target_stock_ticker']`（缺失 KeyError）vs TS `target(state)`→`''`（容错）；固定回退文本「（本次运行未检索到任何信息面素材：所有来源均不可用或未启用）」逐字一致 | NON_BLOCKER |
| C9 | 条目收集/格式化（collect_content_items / _format_item / _format_tweet 收敛单点） | :97-135 + core/llms/tools/billions_*.py + _items.py | agents.ts:263-317（**agents.ts 内复制一份**；billionsTools.ts:47-100 另有一份） | PARTIAL | 行为对齐（字段契约容错、无标题无链接→null、推特无正文→null、`- `＋` — ` 连接格式）；但 TS 存在**双副本**（agents.ts 与 billionsTools.ts），Python 是单点（billions_search._format_item）——未来改契约需改两处，漂移风险（维护面差异，非行为缺口） | NON_BLOCKER |

### D. `bullish_trader.py` → `ts/src/agents.ts:471-495`

| # | 功能点 | Python | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| D1 | 构造：role_message=bullish_trader_message + revise_llm=build_chain(bullish_revise_message) | bullish_trader.py:11-18 | agents.ts:472-475 | FULL | 两个 system 消息逐字节一致 | NON_BLOCKER |
| D2 | `bullish_trader` 初稿（3 专家报告 + info_section 条件段；complete_with_tools 默认轮数 15） | :20-43 | agents.ts:477-483 | PARTIAL | **查询字节漂移 6 处**（`基本面报告: `/`趋势报告: `/`技术指标分析报告: ` 后及 FA/TA/TIA 后各少 1 个 `\n`——PY 双换行 vs TS 单换行；info_section 插值位置一致在技术指标段后）；progress 文案 PY「开始多方观点生成。。。」/「多方观点生成完成。。。」vs TS「多头交易员开始分析...」/「多头交易员完成分析」 | NON_BLOCKER |
| D3 | `bullish_revise`（对方观点 + 自己初稿；chain=revise_llm、max_tool_rounds=3） | :45-67 | agents.ts:485-494 | PARTIAL | **查询字节漂移 3 处 + 尾部 `\n        `（换行+8 空格）缺失**——与经理同款"尾部漂移"（08-13 只审到经理，修订轮同样存在）；progress 文案 PY「开始多方观点修订。。。」vs TS「多方修订开始...」 | NON_BLOCKER |
| D4 | opinions 读取：PY `state['bullish_opinions'][-1].content`（key 缺失 KeyError/空表 IndexError）vs TS `?.at(-1)?.content ?? ''` | :47-48,53-54 | agents.ts:486-487 | PARTIAL | 边界容错差异（图中由 join 保证恒有值，仅防御性差异） | NON_BLOCKER |

### E. `bearish_trader.py` → `ts/src/agents.ts:497-520`

| # | 功能点 | Python | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| E1-E4 | 同 BullishTrader（镜像：bearish_trader_message / bearish_revise_message；空方初稿/空方修订） | bearish_trader.py:11-67 | agents.ts:497-520 | PARTIAL | 与 D2-D4 相同差异（镜像字节漂移：初稿 6 处、修订 3 处 + 尾部 `\n        ` 缺失；progress 文案 PY「开始空方观点生成/修订。。。」vs TS「空头交易员开始分析...」/「空方修订开始...」） | NON_BLOCKER |

### F. `investment_manager.py` → `ts/src/agents.ts:523-539`

| # | 功能点 | Python | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| F1 | 构造：role_message=investment_manager_message（工具角色，接委员会 tools） | investment_manager.py:11-13 | agents.ts:524-526 | FULL | system 消息逐字节一致；工具绑定面等价（见 G） | NON_BLOCKER |
| F2 | `investment_manager` 节点：3 专家报告 + info_section **中段**（技术指标与多头观点之间）+ 双方观点 `[-1].content`；complete_with_tools 默认轮数 | :15-46 | agents.ts:527-539 | PARTIAL | **查询字节漂移 8 处 + 尾部 `\n        ` 缺失**（已知 08-13「经理查询尾部 8 空格漂移」确认，且**中段还有 8 处 `\n` 缺失为本次新发现**）；info_section 插值位置一致（`\nINFO\n` 两侧相同）；progress 文案 PY「开始最终投资建议生成。。。」vs TS「投资经理开始终审...」 | NON_BLOCKER |
| F3 | 观点读取：PY `state['bullish_opinions'][-1].content` vs TS `?.at(-1)?.content ?? ''` | :22-23 | agents.ts:528-530 | PARTIAL | 同 D4 容错差异 | NON_BLOCKER |

### G. 条件注册谓词（信息面分析师）与工具绑定（委员会装配侧）

| # | 功能点 | Python | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| G1 | 信息面分析师启用谓词：ANALYST 能力开关开 且（SEARCH/TWITTER 至少一者开 或 联网搜索开） | role_registry.py:44-57（billions_cap_switch("ANALYST") + billions_enabled(SEARCH/TWITTER) + web_search_enabled） | committee.ts:42-47（billionsEnabled ×3 + webSearchEnabled） | PARTIAL | 关键语义差异：PY 谓词 SEARCH/TWITTER 段经 `billions_enabled`（**含主闸 BILLIONS_API_KEY 硬约束**，billions_config.py:19-38），TS 谓词三段均 env-only（**无 key 约束**，committee.ts:31-40 注释自述「现状」）。边角组合（无 key + web 关 + SEARCH env 开）：PY 不注册（8 节点图）vs TS 注册（9 节点图，产出回退文本报告）。TS 测试已固化此行为（committee.test.ts:105-108「SEARCH 未禁用 → 分析师仍注册（9 节点断言不变）」）——有意差异或疏漏**需人工确认**；web 开（默认）时两侧均注册，无差异 | NON_BLOCKER（边角配置） |
| G2 | 委员会工具绑定：web_search（开关过滤）+ 亿信三件套 → 交易员/经理；专家/分析师不绑 | investment_committee.py:110-126（make_web_search_tool + 亿信三件套工厂） | committee.ts:128-129 + runner.ts:168-177（assembleTools：web + makeBillionsTools；App 层注入） | FULL | 绑定面等价（web_search 开关语义一致；亿信三件套细节归 slice 3）；专家/分析师工厂均忽略 tools（role_registry.py:94-104 vs committee.ts:51-55） | NON_BLOCKER |

### H. 汇总行（跨 7 agent 的系统提示词）

| # | 功能点 | Python | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| H1 | system_prompt + 9 角色消息（fundamental/trend/technical/information/bullish/bearish/bullish_revise/bearish_revise/manager） | core/llms/prompt.py（10 常量） | ts/src/prompt.ts（10 常量） | FULL | 脚本字节比对 **10/10 ALL MATCH**（含长度 62/555/364/660/437/367/367/331/331/383） | NON_BLOCKER |

---

## ③ MISSING / PARTIAL 汇总清单（移植/修复时逐条照做）

**MISSING：0 项。** 全部功能点（基类管道、7 角色、预抓、谓词、工具绑定）在 TS 侧均有等价物。

**PARTIAL：**（按严重度排序，阻断判定：本片无 BLOCKER，全部 NON_BLOCKER）

| # | 差异 | Python 证据 | TS 证据 | 性质 |
|---|---|---|---|---|
| P1 | **查询模板空白字节漂移（9/9 查询）**：Python 源行尾 `\n` 转义 + 源行换行 = 双换行；TS 统一为单换行。各查询少 `\n` 数：三专家各 1 处；分析师 4 处；多/空初稿各 6 处；多/空修订各 3 处；经理 8 处。另：**修订 2 条 + 经理 1 条尾部缺 `\n        `（换行+8 空格）**——即 08-13 已知「经理尾部 8 空格漂移」，本次确认修订轮同款漂移 + 全查询中段双换行缺失为新增发现 | 9 个 f-string（各 agent 文件查询构建处）+ test_query_baselines.py:39-58（_BULL_BEAR_BASELINE/_MANAGER_BASELINE 钉死 Python 双换行与尾部 `\n        `） | agents.ts:198,212,226,461-465,479,505,488-492,514-517,533（脚本比对 PY/TS 字节） | 空白行差异不影响 LLM 语义；但 agents.ts:2-3 头注释「M3 逐字对齐 Python agents/（test_query_baselines 契约）」**与事实不符**。phaseout 前二选一：① 按 Python 基线补 `\n`（若 M3 契约须严格成立）；② 更新头注释/契约说明（TS 为最终实现，Python 基线随删）。**需人工确认** |
| P2 | **亿信预抓参数漂移**：`_COUNT` PY 5 vs TS 10；`_QUERY_TEMPLATES["announcement"]` PY「{} 最新公告」vs TS「{} 公告」 | information_analyst.py:53,58 | agents.ts:238,243（TS 测试钉死 count 10 与 '600036 公告'，agents.test.ts:134,140） | 检索条数与公告检索词不同 → 素材量/成本/结果集不同；TS 行为自洽（有测试），仅与 Python 不等价 |
| P3 | **web 端亿信预抓 key 注入缺失（需人工确认）**：committee 工厂不传 _billionsClient，App 侧无注入 → web 端分析师预抓亿信三源+twitter 恒关，只走 DDG web 回退；Python 桌面端（.env key）可用 | information_analyst.py:153-186（billions_enabled 含 key） | committee.ts:61（expert(BillionsInformationAnalyst) 不传 client）；agents.ts:340-344（new BillionsClient() 无 apiKey）；spec ts/index.md:130-145（接线节列预抓但无 key 路径） | 若产品要求 web 端亿信预抓 → 需 committee 工厂/App 注入 `_billionsClient`（localStorage key）；否则属现状降级（DDG 兜底），注明即可 |
| P4 | **无 key 谓词语义差异**：PY 谓词 SEARCH/TWITTER 段含 key 硬约束；TS 无 → 边角配置（无 key+web 关+SEARCH 开）PY 8 节点 vs TS 9 节点 | role_registry.py:44-57 + billions_config.py:19-38 | committee.ts:42-47（注释自述无 key 约束）+ committee.test.ts:105-108（TS 固化 9 节点） | 有意差异或疏漏，需人工确认；默认配置（web 开）两侧一致 |
| P5 | **progress 文案 9/9 不同**（safe_progress 通道用户可见）：三专家/分析师 LLM 段/多空初稿/多空修订/经理的 start-done 文案全部与 Python 不同（例：PY「开始基本面分析报告生成。。。」vs TS「基本面分析师开始分析...」）；log_label 一致；分析师预抓段文案一致 | 各 agent 文件 complete_* 调用处 | agents.ts:199-204,213-217,227-231,464-468,481-483,491-493,507-509,517-519,536-538 | UI 文案差异，非功能缺口；若需逐字对齐 UI 文案则改 TS |
| P6 | **state 访问容错差异**：PY `state['x']` / `[-1].content`（KeyError/IndexError）vs TS `?? ''` 容错 | 各 agent 节点方法 | agents.ts:178-190,486-487,512-513,528-530 | 防御性差异，图中由 join 保证恒有值 |
| P7 | **messages 通道 response 形状**：PY AIMessage vs TS `{content, tool_calls?}` 对象（complete_expert 的 messages[1]） | base.py:101 | agents.ts:129 | events.ts/App 消费兼容性需人工确认（归 slice 1 核对） |
| P8 | **bind_tools 边界**：无 bind_tools 的 LLM 两侧行为不同（PY 抛 AttributeError vs TS 静默跳过）；TS catch 无类型过滤 | base.py:56-63 | agents.ts:62-68 | 离线假 LLM 边角 |
| P9 | **日志**：PY logger.debug 每节点查询/响应；TS 无（仅预抓失败 warn） | base.py:93,102,115,128 | agents.ts（无对应） | 非功能契约（log.ts 归 slice 8） |
| P10 | **web 回退工具构造时机/供应商**：PY 懒构造（langchain DDG cn-zh max_results=5）；TS 构造时求值 defaultSearcher()（浏览器 /web-search 代理；Node Tavily/DDG） | information_analyst.py:87-95 + web_search.py:110-128 | agents.ts:331 + webSearch.ts:77-85 | 实现差异（行为等价）；webSearch 详审归 slice 3 |
| P11 | **格式化函数双副本**：TS agents.ts:263-317 与 billionsTools.ts:47-100 各一份 formatSearchItem/formatTweetItem/collectContentItems；PY 单点（billions_search/billions_twitter/_items） | core/llms/tools/ 单点 | agents.ts + billionsTools.ts | 维护面差异（改契约需改两处），行为当前一致 |

**FULL 汇总**：A1、A3、A4、A6、A7、A8、B1、C1、C2、C6、D1、E1(部分)、F1、G2、H1 及 C8 的固定回退文本/分节文案、C6 的 web 摘要格式 = **15 项 FULL（含全部 10 条系统提示词逐字节一致）**；PARTIAL 17 项（含 9 条查询模板字节漂移、亿信预抓 2 参数、谓词 1 项、progress 文案 9/9、容错/日志/双副本等）。

---

## ④ spec 符合性结论（对照 `.trellis/spec/ts/index.md` 能力接线节）

| 能力接线点 | 结论 | 证据 |
|---|---|---|
| 事件协议（节点状态 running/done、delta、retry/reset） | **存在**（TS 扩展，Python 无此协议） | agents.ts:116-158（completeExpert/completeWithTools 全量接 safePushStatus/safePushDelta/onRetry/onReset）+ progress.ts:41-64；spec ts/index.md:45-79（方案 B agent 级流式、retry/reset 语义） |
| 流式（agent 级，方案 B） | **存在** | agents.ts:94-105（streamOrInvoke）、135-158（invokeWithTools onDelta） |
| 代理面（7 角色 + 对抗修订双链 + info_section 条件段） | **存在**，但 M3 逐字对齐契约**未完全成立**（查询模板空白字节漂移 P1；system 提示词 10/10 成立） | agents.ts:192-539；P1 证据 |
| 能力接线·亿信（client/tools/预抓） | **部分存在**：client（billionsClient.ts）与工具三件套（billionsTools.ts → runner assembleTools → App 注入）接线完整；**分析师预抓的 web 端 key 注入缺失**（P3，需人工确认——spec 接线节 ts/index.md:138-143 列「agents.ts 信息面分析师预抓」为接线点，但无 localStorage key 注入路径，web 端亿信预抓恒关、DDG 兜底） | committee.ts:61,128-129；runner.ts:168-177；agents.ts:340-344 |
| 能力接线·北交所/akshare | BY_DESIGN（不在本片，spec ts/index.md:151-152 用户决策 08-13） | — |
| 能力接线·mcp/qfq | 不在本片（归 slice 2/6） | — |

**结论**：TS 代理面整体接线存在、可运行（7 角色 + 修订轮 + 流式 + 预抓降级均有生产路径）；本片未发现 BLOCKER。phaseout 前需处置 2 项人工确认（P3 web 端亿信预抓 key 注入、P1 M3 契约口径）+ 1 项记录（P2 预抓参数与 Python 不等价，TS 自洽）。零业务代码改动（工作树仅新增本文件于任务 research/ 目录）。
