# 分片 2：数据采集/汇总面 Python→TS 功能差距审计

- 分片归属：Slice2DataAcq
- Python 侧：`core/data_acquisition.py`、`core/legacy_akshare.py`、`core/stock_output_formatter.py`
- TS 对照面：`ts/src/webCollect.ts`、`ts/src/pipeline.ts`、`ts/src/overview.ts`、`ts/src/reports.ts`、`ts/src/tdx/quoteClient.ts`（采集链），另核 `ts/src/gates.ts`、`ts/src/store.ts`、`ts/app/App.tsx`、`ts/app/lib/runner.ts`、`ts/app/lib/proxies.cjs`、`ts/tools/probe.mts`、`ts/src/f10.ts`
- 参考 spec：`.trellis/spec/ts/index.md`（能力接线节）、`.trellis/spec/core/data-acquisition.md`、`.trellis/spec/core/index.md`、`.trellis/spec/data_source/index.md`
- 只读审计：零业务代码改动 ✓

---

## ① 认领文件清单（逐文件读过）

| 文件 | 读取方式 | 说明 |
|---|---|---|
| `core/data_acquisition.py`（401 行） | 全文逐行 | FetchScope + DataAcquisition 主流程 |
| `core/legacy_akshare.py`（255 行） | 全文逐行 | LegacyAksharePaths 备用路径 |
| `core/stock_output_formatter.py`（43 行） | 全文逐行 | StockOutputFormatter |
| `ts/src/webCollect.ts` | 全文 | applyCollectedToStore / collectViaProxy |
| `ts/src/pipeline.ts` | 全文 | formatStockOutput / buildStockInformation |
| `ts/src/overview.ts` | 全文 | composeOverview（22 列） |
| `ts/src/reports.ts` | 全文 | composeReports（15 列） |
| `ts/src/tdx/quoteClient.ts` | 全文 | collectAll / fetchDailyBars / applyQfq |
| `ts/src/gates.ts`（补充） | 全文 | asiaToday / getLastBusinessDay / 三门 / FetchScope |
| `ts/src/store.ts`（补充） | 全文 | StoreLike 契约、addDatas / addPerformanceReports / replaceDatas |
| `ts/app/App.tsx`（149-243） | 目标区段 | start() 采集编排、BJ 拦截 |
| `ts/app/lib/runner.ts`（补充） | 全文 | store 单例、collectForWeb、情报段注入 |
| `ts/app/lib/proxies.cjs`（152-203） | 目标区段 | doCollect 采集链（F10 两节 + collectAll） |
| `ts/tools/probe.mts`（补充） | 全文 | Node 探针采集链（与 doCollect 同构） |
| `ts/src/f10.ts`（补充） | 全文 | parseIndicatorSection / parseCapitalStructure |
| 对照证据 | 区段 | `data_source/.../tdx/{mapping,overview,reports,adjust}.py`、`utils/{time_helper,formatting}.py`、`data_storage/.../ZODBStorage.py:53-57` |

---

## ② 功能点差距表

### A. `core/data_acquisition.py`（主流程：采集编排 / 缓存 / 交易日逻辑）

| # | Python 功能点（file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| 1 | **FetchScope 单遍拉取去重**：每源（daily/snapshot/capital/f10/xdxr）每 ticker 一次分析只拉一次，三个消费者共享；daily 复用判定按**请求尺寸**（cached_bars ≥ 请求）而非实际行数（data_acquisition.py:17-86） | gates.ts:52-63 `FetchScope`（同算法：record/canReuse 按请求尺寸）——但生产链未引用（仅 store-gates.test.ts 单测）；实际单次采集由结构达成：doCollect 五源一次拉齐（proxies.cjs:159-179）+ App 每次分析恰一次 `collectForWeb`（App.tsx:184）+ buildStockInformation 纯函数无网络（pipeline.ts:178-193） | **FULL**（语义） | 语义对齐：TS web/Node 流程每次分析恰一次采集、五源共享、无重复网络。gates.ts 的 FetchScope 类未接线属「死代码级」冗余（定义+单测、无生产调用），不构成能力差距；若后续出现多消费点需显式去重时再接线。Python 的 max_bars=250/全量区分在 TS 不存在（恒全量，见 #4） | NON_BLOCKER |
| 2 | **FetchScope 失败语义**：源抛异常/返回空 → 记 failed + （异常时）重抛；failed 后本 scope 内后续请求直接返回空 DataFrame（data_acquisition.py:39-74） | collectAll 逐源独立降级：snapshot 失败→null（quoteClient.ts:51-67）、xdxr 失败→[]（quoteClient.ts:94-104）、name 失败→null（quoteClient.ts:71-89）；daily 失败→collectAll 整体失败→代理 5xx→App 中止分析（proxies.cjs:181-203、App.tsx:192-197） | **PARTIAL** | 逐源降级对齐（snapshot/xdxr/name/capital 均不阻断）；**daily 失败语义不同**：Python 记 `logger.error` + 返回 False，get_stock_data 忽略返回值继续返回已构建 stock（分析照常，用旧/部分数据，data_acquisition.py:146-150,394）；TS 直接中止整个分析。TS 注释明确为设计决策（webCollect.ts:54「失败抛错(调用方应中止分析,不喂空数据)」）。错误可观测性：Python loguru 日志 vs TS describeError 错误透传 UI（App.tsx:192-197） | NON_BLOCKER（TS 为有意设计；若要 Python 式降级继续需另开增强） |
| 3 | **DataAcquisition.__init__ 进程级单例 storage** + 数据阶段全程持 `storage.lock`（RLock，get→mutate→commit 可重入，防 Streamlit 多会话并发）（data_acquisition.py:90-92,112-116,203-207,292-296） | runner.ts:17 `export const store = new InMemoryStore()` 单例（web）；probe.mts 用 `new Store(...)`（Node）；Node 单线程事件循环无并发写冲突，无锁需求 | **FULL** | 架构对齐（单例仓储）；TS 无锁属平台特性（无多线程），非能力缺失。ZODB flock 单例约束（get_zodb_storage）在 TS 无对应物 | NON_BLOCKER |
| 4 | **acquire_historical_data_tdx**（data_acquisition.py:94-175）：① freshness 门：`last_data_update == asia_today()` → 跳过；② 缺口 gap≤120 → 增量拉 gap 根 / gap>120 → 全量回填；③ capital 失败降级（换手率 NaN）；④ daily 失败→False；⑤ xdxr 失败降级（未复权）；⑥ mapping 12 列 → qfq_adjust（复权后重算振幅/涨跌幅/涨跌额）→ 批量 from_row + add_datas 单 commit | fetchDailyBars 全量分页（quoteClient.ts:29-46，KLINE_PAGE=800，count<800 停）→ applyQfq（quoteClient.ts:106-131，失败/无事件降级 raw bars）→ store.replaceDatas 单事务全量替换（store.ts:185-207）；capital 来自 F10 股本结构节解析（webCollect.ts:26-40、f10.ts parseCapitalStructure），失败→capital null→换手率 NaN | **PARTIAL** | 数据链路（mapping→qfq→批量单事务）、复权降级、capital 降级对齐。**行为差异：无 freshness 跳过、无增量窗口**——每次分析恒全量重拉日K（Python 同日内零拉取 / gap 增量拉取）；且 replaceDatas 全量替换 vs Python add_datas 按 date 去重增量（store.ts:129-150 addDatas 拒绝 `date <= last_data_update`，语义仍在，只是采集端不用）。最终存储数据等价（都到最新），但每次分析网络成本显著更高（全量历史分页 ≈ 800 根/页） | NON_BLOCKER（优化项：恢复「同日内跳过采集」需接线 gates.ts 门，见 #6/#8） |
| 5 | **ensure_stock**（data_acquisition.py:177-248）：无股→TDX build_overview→from_row→ChinaStock→put_stock；有股→`_overview_stale` 门→重建概览（best-effort：build 失败保留旧概览仍返回 True）；构建失败（无任何价格源）→logger.error+False；BJ ticker → warning+False | composeOverview 每次运行现算（overview.ts:69-134，pipeline.ts:178-193 内调用）；App.tsx:184-189 采集后立即预生成 stock_information；采集失败→中止（无「保留旧概览」路径） | **PARTIAL** | 22 列合成语义逐项对齐（见 #10）。**行为差异：TS 不持久化 overview**——applyCollectedToStore putStock 写 `overview: null`（webCollect.ts:27-33），每次运行由最新采集现算，恒新鲜；Python 的「刷新失败保留旧概览仍继续」路径在 TS 不存在（采集失败整体中止，见 #2）。旧值保留是 Python 门控架构的产物，TS 全量现算下无陈旧值可保，非能力缺失 | NON_BLOCKER |
| 6 | **`_overview_stale`**：`overview_last_update.date() < get_last_business_day(asia_today())`（data_acquisition.py:250-255） | gates.ts:24-27 `overviewNeedsRefresh` + gates.ts:15-21 `getLastBusinessDay`（周六→-1 周日→-2，与 Python `utils/time_helper.py:26-36` 逐位对齐，含单测 store-gates.test.ts:94-102） | **FULL**（函数）/ **未接线** | 函数语义完全对齐（含节假日日历未建模——两侧一致保留）。**但生产采集链不消费本门**：App/doCollect 每次无条件全量采集（App.tsx:184），`overviewNeedsRefresh` 仅测试引用。行为等价于 Python 门恒不命中（恒采集） | NON_BLOCKER |
| 7 | **`_history_gap`**：自然日缺口 = max(最近交易日 − last_data_update, 0)（data_acquisition.py:257-259） | 无等价函数；全量拉取语义下不需要 | **FULL** | 行为对齐：TS 恒全量（等价 Python gap 无限大分支 data_acquisition.py:160-163）；缺口计算逻辑可随 Python 删 | NON_BLOCKER |
| 8 | **`_reports_stale` + `_latest_past_quarter_end`**：最新 report_date == 最近已到截止日的季度末（0331/0630/0930/1231 四分支，'%Y%m%d' 字符串比较）（data_acquisition.py:261-284） | gates.ts:30-47 `latestPastQuarterEnd`（8 候选季度末 + `<= todayYmd` 取首个，语义同 Python 四分支，含单测 store-gates.test.ts:94-99）+ `reportsFresh`（同 261-265 语义） | **FULL**（函数）/ **未接线** | 函数对齐。**但生产链不消费业绩门**：doCollect 每次重拉 F10 财务分析节（proxies.cjs:163）并 composeReports（webCollect.ts:36-45），不查 `reportsFresh`。结果幂等（store.addPerformanceReports 按 report_date 去重，store.ts:153-171），数据恒最新，但每次分析多一次 F10 网络往返；Python 该门承诺的「该季已入库则不重复拉」在 TS 未生效 | NON_BLOCKER（优化项） |
| 9 | **acquire_performance_report_tdx**（data_acquisition.py:286-340）：storage 无股→logger.error+False；业绩门命中→跳过（不拉远端）；build_reports 返回 None（F10 失败/无报告）→warning+True（无报告不算失败）；批量 from_row（15 列恒等路径）+ add_performance_reports 单 commit | doCollect F10 财务分析节（proxies.cjs:152-157,163-164）→ parseFinanceIndicatorsAllTables + composeReports（webCollect.ts:36-45）→ store.addPerformanceReports（store.ts:153-171）；无报告→空数组不写（`if (reports.length)` webCollect.ts:44）；「storage 无股→False」语义不存在（TS 采集先行，无股即建） | **PARTIAL** | 批量/单事务/去重/「无报告不失败」对齐；**freshness 门未接线**（见 #8）；「storage 无股→False」的 expected-absence 协议在 TS 采集流程中无对应场景（结构化差异，非缺失） | NON_BLOCKER |
| 10 | **22 列概览字段语义**（data_acquisition 消费 overview.py 契约）：price 快照→日K末根回退；prev_close 倒数第二根；volume/amount 仅末根 bar 为当日时取值（盘中 NaN）；eps/每股净资产最新报告期；量比/涨速/5分钟涨跌恒 NaN；换手率=vol×100/流通股本×100；60日=倒数第 61 根；YTD 三分支（跨年停牌 NaN/上年末收盘/当年首根）；PE/PB 分母 ≤0→NaN；name 失败回退 ticker（overview.py:124-231） | composeOverview（overview.ts:69-134）：latestPeriodValue（30-38，period 字典序最大）、lastBarIsToday（40-43）、ytdBaseClose（46-54，三分支同 overview.py:124-143）、divide 除零保护（23-27）、换手率公式同 mapping.py:96-98（LOT_SIZE=100）、60日= `bars[bars.length-61]`（overview.ts:118-119）；name 回退 ticker（pipeline.ts:181） | **FULL** | 逐字段对齐（含 NaN 约定、盘中语义、YTD 三分支、除零保护）。唯一结构差异：Python build_overview 在 snapshot 与日K 全失败时返回 None（overview.py:252-255）→ ensure_stock 失败；TS composeOverview 无失败路径（price 恒可退化为 NaN），但采集链中 daily 失败整体中止（见 #2）→ 等效于「无价格源即失败」，语义一致 | NON_BLOCKER |
| 11 | **get_stock_data 编排**（data_acquisition.py:342-401）：创建 FetchScope → 预播种 daily（首建全量 / 已有按门算最大尺寸，两门全 fresh 零拉取）→ ensure_stock（失败→返回 None）→ acquire_historical_data_tdx → acquire_performance_report_tdx → 返回 storage.get_stock(ticker)；历史/业绩失败记日志不阻断 | App.tsx:149-230 start()：BJ 拦截 → collectForWeb（单次采集全链）→ buildStockInformation 预生成 → runner.run（events.ts:65-108 内二次 buildStockInformation，纯函数零网络）→ done/error 事件；采集失败→中止 | **PARTIAL** | 编排等价（采集→概览→历史→业绩一次成链；双算共享同一 store 与注入闭包，不重复触发网络）。**行为差异**：① 失败语义——Python 单步失败降级继续返回 stock，TS 采集失败整体中止（设计决策，见 #2）；② Python 的 stock/None + boolean 结果协议在 TS 无对应 API（UI 事件流替代，API 形态差异）；③ 预播种的「零拉取」优化路径在 TS 不存在（恒全量，见 #4） | NON_BLOCKER |
| 12 | **北交所拒绝**：is_bj_ticker（4/8 前缀）→ warning + 返回 False，不静默 NaN（data_acquisition.py:220-229；tdx_source.is_bj_ticker） | App.tsx:153-156（`code.startsWith('4') \|\| '8'` → 报错返回）；ts/index.md 能力接线「北交所/akshare：明确不支持(用户决策 08-13)」 | **FULL** | 能力对齐（UI 入口拦截 vs 构建期拒绝），均显式报错不静默。Python 侧该分支在删除时随主流程删除即可 | NON_BLOCKER |
| 13 | **惰性 akshare 导入**：legacy 方法内局部 import，`import core.data_acquisition` 不触发 akshare 加载（legacy_akshare.py:57,71,78,85,110,201；test_module_import_lazy_akshare 钉死） | TS 无 akshare 依赖，天然满足 | **FULL** | 无差距（不适用但无损） | NON_BLOCKER |

### B. `core/legacy_akshare.py`（备用路径——08-13 用户决策 akshare 不移植，全部 BY_DESIGN）

| # | Python 功能点（file:line） | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| 14 | `YJBB_COLUMN_MAP`：stock_yjbb_em 14 列名契约（legacy_akshare.py:29-46） | 无 | **BY_DESIGN** | akshare 专用列契约（08-09 from_row 命名构造原型）。仅被本文件 deprecated 方法引用；F10 版契约由 reports.ts METRIC_COLUMNS 承担（见 #26） | NON_BLOCKER |
| 15 | `acquire_daily_overview`：全市场概览刷新（check_need_update_overview 17:00 门 + 沪/深/北三市场 + set_overview_updated_now）（legacy_akshare.py:53-67） | 无全市场扫描——TS 架构为按需单股采集（App.tsx:184；quoteClient.ts:29-46）。storage 17:00 门仅本路径使用（ZODBStorage.py:53-57 注释明示） | **BY_DESIGN** | 主流程零外部调用（grep 全仓：仅本文件内部引用 + deprecated 测试）。TS 无全市场概览能力属架构差异（按需单股，与 Python 主流程一致），非差距。删除时 17:00 门（ZODBStorage.check_need_update_overview/set_overview_updated_now）随删 | NON_BLOCKER |
| 16 | `update_shex/szex/bjex_overview`（legacy_akshare.py:69-88） | 无 | **BY_DESIGN** | 同 #15；北交所分支单列 08-13 决策不做（App.tsx:153-156 拦截） | NON_BLOCKER |
| 17 | `update_overview_in_storage`：akshare spot 行→StockOverview→put/update（legacy_akshare.py:90-105） | applyCollectedToStore putStock（webCollect.ts:26-33） | **BY_DESIGN** | 写入 storage 的等价位存在（TS 代理载荷→store），akshare 全市场行形态按决策不移植 | NON_BLOCKER |
| 18 | `acquire_historical_data`：akshare 日K 备用（freshness 门 + 按自然日缺口拉 + add_data 逐行去重）（legacy_akshare.py:107-144） | fetchDailyBars+applyQfq+addDatas（quoteClient.ts:29-131；store.ts:129-150） | **BY_DESIGN** | TDX 版能力已 FULL（#4）；akshare 数据源形态按决策不移植。add_data 逐行 vs TS 批量——均随主流程覆盖 | NON_BLOCKER |
| 19 | `get_next_report_date`：报告期步进（0331/0630/0930/1231 顺序推进）（legacy_akshare.py:146-157） | 无直接等价；gates.ts:30-42 latestPastQuarterEnd 只覆盖「最近已过季度末」不含步进 | **BY_DESIGN** | 仅被 deprecated `acquire_performance_report` 轮询循环（legacy_akshare.py:222-237）引用；主流程用 `_latest_past_quarter_end`（TS 已移植为 latestPastQuarterEnd） | NON_BLOCKER |
| 20 | `get_latest_possible_report_date`（legacy_akshare.py:160-176） | latestPastQuarterEnd（gates.ts:30-42）语义等价（四分支 1231/0331/0630/0930） | **BY_DESIGN** | TS 版存在且用于业绩门定义（虽未接线，见 #8）；akshare 轮询上限语义不移植 | NON_BLOCKER |
| 21 | `build_performance_report_from_row` + 列名存在性断言（缺失→error+None 不写库）（legacy_akshare.py:179-195） | composeReports（reports.ts:61-118） | **BY_DESIGN** | yjbb_em 列名断言契约（akshare 版本漂移防护）专用；F10 版 composeReports 已 FULL（#26），akshare 版断言随删 | NON_BLOCKER |
| 22 | `acquire_performance_report`：akshare 业绩轮询（demo 默认 '601988' + 每次调用 warning；列契约断言 + 逐行入仓）（legacy_akshare.py:197-240） | 无 | **BY_DESIGN** | 演示代码 + 备用路径双 deprecated（docstring 自证「主流程不调用」）；TS 用 F10 单股业绩（reports.ts）替代 | NON_BLOCKER |
| 23 | `add_performance_report_in_storage`（legacy_akshare.py:242-255） | store.addPerformanceReports（store.ts:153-171） | **BY_DESIGN** | 能力等价物存在（F10 版，report_date 去重 + 单事务）；akshare 调用形态不移植 | NON_BLOCKER |

### C. `core/stock_output_formatter.py`（报告格式化）

| # | Python 功能点（file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| 24 | **StockOutputFormatter.format_stock_output**（stock_output_formatter.py:10-43）：固定版式（`\n-----------\n` 起止 + 概览 5 行 + Last 60 days prices + Last 20 financial abstracts）；所有数值经 fmt_number（NaN/None→"N/A"，两位小数，2026-08-02 NaN 渲染修复） | formatStockOutput（pipeline.ts:43-83）+ fmtNumber（pipeline.ts:14-17）+ changePercentSeries（pipeline.ts:33-35）+ turnoverPct（pipeline.ts:38-41）；调用点 buildStockInformation（pipeline.ts:178-193） | **FULL** | 文本逐字对齐（分隔线/字段标签/顺序/小数位/百分比后缀/%）。差异仅在值来源：Python 读存储行（percentage_gain/turnover_rate 入库时由 mapping.py:88-98 计算），TS 渲染时现算——change%=相邻 close 自算（pipeline.ts:33-35 与 mapping.py:88-92 同公式；qfq 后均基于复权价重算 adjust.py:90-96）；换手率=vol×10⁴/股本（pipeline.ts:38-41 与 mapping.py:96-98 同公式）——输入相同时输出恒等。fmt_number（formatting.py:17-24）vs fmtNumber：NaN/None→"N/A" 对齐；∞ 渲染 Python "inf" vs TS "Infinity"（TDX 路径无此输入，可忽略）。首根 change% 两侧均 NaN→"N/A" | NON_BLOCKER |
| 25 | **15 列业绩报告契约**（data_acquisition 消费 reports.py REPORT_COLUMNS：ticker/name/eps/total_income/YoY/QoQ/net_profit/YoY/QoQ/每股净资产/ROE/每股现金流/毛利率/行业/report_date；QoQ 相邻季度门 [88,93] 天；sales_gross_margin 恒 NaN、industry 恒 ''；report_date '%Y%m%d'） | REPORT_COLUMNS（reports.ts:8-16）与 Python 逐项同序；METRIC_COLUMNS（reports.ts:19-39）为 Python 超集（新增通达信万元×10⁴ 双格式名：'营业总收(未调整:万)'/'营业总收(调整后:万)'/'归母净利(未调整:万)'/'归母净利(调整后:万)' + '总营收同比增长率(%)'）；adjacentQuarterGap [88,93]（reports.ts:42-45 vs reports.py:75-80）；qoqSeries 除零→NaN 负分母合法（reports.ts:49-58）；period 去重 aggfunc first（reports.ts:72-84 vs reports.py:108-110）；'YYYY-MM-DD'→'%Y%m%d'（reports.ts:88 vs reports.py:144-148） | **FULL** | 列契约/派生/去重/环比门全部对齐；TS 为超集（双 vendor 格式兼容，M0 发现）。差异：Python 的 F10 metric 命中率 <50% 告警（reports.py:100-106）TS 未移植（诊断性 logger.warning，非功能行为）；Python compose_reports 无映射指标→返回 None vs TS→返回 []（webCollect 均按「无报告不失败」处理，行为等价） | NON_BLOCKER |

**差距表状态统计**：FULL 12 / PARTIAL 7 / MISSING 0 / BY_DESIGN 10（#14-#23）

---

## ③ MISSING + PARTIAL 汇总清单（移植/删除时照此逐条）

### 无 MISSING（主流程全部能力在 TS 有等价物，legacy 全部 BY_DESIGN）

### PARTIAL（7 条，全部 NON_BLOCKER——TS 行为正确/恒新鲜，差异为设计决策或优化损失）

| # | 功能点 | 差异实质 | 性质 | 处置建议 |
|---|---|---|---|---|
| P1 (#2) | daily 拉取失败语义 | Python：降级继续（返回已构建 stock，分析照常）；TS：整体中止（「不喂空数据」设计决策，webCollect.ts:54） | 有意设计 | phaseout 无需补；如需 Python 式容错，另开增强（分析可用旧数据时继续） |
| P2 (#4) | 历史采集无 freshness 跳过/增量 | TS 每次全量重拉 + replaceDatas 全量替换（Python 同日内零拉取、gap 增量） | 优化损失 | 结果数据等价（恒最新）；网络成本差异。可后续接线 gates.ts 门恢复「同日跳过」（NON_BLOCKER 优化） |
| P3 (#5) | overview 不持久化 | TS 每次现算（applyCollectedToStore 写 overview:null，webCollect.ts:27-33）；无「刷新失败保留旧概览」路径 | 架构简化 | 无功能缺失；删除 Python 的持久化概览 + freshness 刷新逻辑时确认 UI 无存储侧消费（DataScreen 走 buildStockInformation 现算） |
| P4 (#6) | `_overview_stale` 门未接线 | gates.ts:24-27 函数存在+单测，生产采集链不消费 | 未接线（死代码级） | phaseout 删 Python 侧安全；TS 侧 gates.ts 保留（getLastBusinessDay 已被 agents.ts:8,60,84 生产使用；overviewNeedsRefresh 若永不用可随清理） |
| P5 (#8) | 业绩 freshness 门未接线 | gates.ts:44-47 reportsFresh 存在+单测，doCollect 每次重拉 F10；幂等靠 addPerformanceReports 去重 | 未接线（优化损失） | 同上；「同季已入库不重复拉」承诺在 TS 未生效，但无正确性影响 |
| P6 (#9) | 业绩入库「storage 无股→False」协议 | TS 无对应场景（采集先行、无股即建） | 结构化差异 | 无需补 |
| P7 (#11) | 编排失败语义 + boolean/对象协议 | TS 事件流 + 异常中止替代 stock/None + boolean 协议 | API 形态差异 | 无需补；删 Python 时确认无外部调用者依赖该协议（主流程仅 get_company_info 工具经 get_stock_data 消费） |

### 删除建议（随 phaseout 一并移除，避免遗留）
- `core/legacy_akshare.py` 整体（#14-#23，BY_DESIGN）+ `data_source/.../akshare/fetch_stcok_data.py`（若也无其他引用）+ `ZODBStorage.check_need_update_overview/set_overview_updated_now`（仅备用路径使用，ZODBStorage.py:53-57）
- `data_acquisition.py` 的 `_history_gap`（#7）、`_overview_stale`/`_reports_stale`/`_latest_past_quarter_end` 的 Python 实现（#6/#8，TS 已有等价函数）
- `stock_output_formatter.py` 中 `openpyxl.styles.builtins` 死导入（spec 已知 quirk，architecture.md 注明保留——删除时顺带清理）

---

## ④ spec 符合性结论（能力接线点）

对照 `.trellis/spec/ts/index.md`「能力接线」节，本分片相关接线点核查：

| 能力接线点（spec 要求） | 是否存在 | 证据 |
|---|---|---|
| **qfq 前复权生产接线**：collectAll 内 fetchXdxrEvents → applyQfq，失败降级 raw bars 不阻断 | ✓ | quoteClient.ts:133-141（collectAll 内 Promise.all 拉 xdxr）→ quoteClient.ts:106-131（applyQfq 失败 catch → raw bars）；spec「日期契约 YYYY-MM-DD（store 契约；qfqAdjust 输入 YYYYMMDD，接线层双向转换）」→ applyQfq 内 `replace(/-/g,'')` / slice 恢复（quoteClient.ts:109,120-122）✓ |
| **北交所/akshare 明确不支持**：App.tsx 入口拦截报错 | ✓ | App.tsx:153-156（4/8 前缀拦截）；legacy_akshare 全部方法 BY_DESIGN（本表 #14-#23） |
| **采集互斥（W4）**：/tdx-collect 45s 超时仅提前回 504，锁保持到 doCollect 真正 settle | ✓（非本分片功能面，接线点存在） | proxies.cjs:181-203（collecting 标志 + timer 仅发 504 + finally 释放） |
| **事件协议数据链**：run → buildStockInformation（数据段）→ 委员会（LLM 段） | ✓ | events.ts:65-108（runner.run 先 buildStockInformation 后 makeInvestmentCommittee，stock_information 注入 initial state）；App.tsx:205-222（预生成 + runner.run 双算共享同一 store/注入闭包，不重复触发网络） |
| **采集源覆盖**：data_acquisition 五源（daily/snapshot/capital/f10/xdxr）在 TS 采集链全部有对应 | ✓ | doCollect（proxies.cjs:159-179）= F10 财务分析节 + 股本结构节 + collectAll（快照/全量日K/名称/xdxr）；与 probe.mts 数据链同构（注释自证「对齐 tools/probe.mts 数据链」） |

**结论**：
1. 本分片范围内**无缺失的能力接线点**；主流程数据采集/汇总功能在 TS 侧全部有等价物（FULL 12 / PARTIAL 7 / MISSING 0），legacy akshare 备用路径全部 BY_DESIGN（08-13 决策，出处：`.trellis/spec/ts/index.md`「北交所/akshare：明确不支持」+ 各方法 docstring「deprecated（备用路径，主流程不调用）」+ 全仓 grep 确认无外部调用者）。
2. **唯一需要人工确认的点**（防假阳性纪律）：`gates.ts` 的 `overviewNeedsRefresh` / `reportsFresh` / `FetchScope` 三个导出在生产链零引用（仅 store-gates.test.ts 单测）——若视为「TS 已具备 freshness 能力」，则 #6/#8 可标 FULL；本报告按「函数对齐但未接线」标 PARTIAL（行为差异：TS 恒采集）。是否在 phaseout 前接线（恢复同日跳过采集优化）属产品决策，不影响删除 Python 的可行性（TS 恒采集语义是正确超集）。
3. 本分片**无 BLOCKER**：删 Python 前无需补任何能力；全部 7 条 PARTIAL 均为 NON_BLOCKER（设计决策差异 ×4、未接线优化 ×2、API 形态差异 ×1）。
