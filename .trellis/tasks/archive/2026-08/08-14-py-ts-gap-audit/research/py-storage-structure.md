# 分片 7：存储/结构面 Python→TS 功能差距审计

- 分片归属：Slice7Storage
- Python 侧：`data_storage/chinese_mainland/ZODBStorage.py` + `data_structure/chinese_mainland/` 全部 5 个（`ChinaStock.py`、`StockInfo.py`、`StockOverview.py`、`StockPerformanceReport.py`、`ChinaStockData.py`）
- TS 对照面：`ts/src/store.ts`、`ts/src/store-memory.ts`、`ts/src/reports.ts`、`ts/src/overview.ts`；补充证据：`ts/src/gates.ts`、`ts/src/pipeline.ts`、`ts/src/webCollect.ts`、`ts/src/tdx/quoteClient.ts`、`ts/src/adjust.ts`、`ts/src/indicators.ts`、`ts/app/lib/runner.ts`、`ts/app/screens/DataScreen.tsx`、`ts/app/App.tsx`、`ts/app/lib/proxies.cjs`、`ts/tools/probe.mts`、测试套件
- 参考 spec：`.trellis/spec/ts/index.md`（事件协议/图表/能力接线节）、`.trellis/spec/data_storage/index.md`、`.trellis/spec/data_structure/index.md`、`.trellis/spec/guides/index.md`（AI review 防假阳性三模式）
- 后端决策出处：`.trellis/tasks/archive/2026-08/08-09-ts-rewrite/prd.md` C3「移动端存储用 SQLite，不移植 ZODB」+ `design.md:107`「无数据迁移：SQLite 从零建，不读 ZODB 文件」；`08-09-ts-rewrite-m1/prd.md` R4/C2（schema 设计 + expo-sqlite 预留）
- 只读审计：零业务代码改动 ✓

---

## ① 认领文件清单（逐文件读过）

| 文件 | 读取方式 | 说明 |
|---|---|---|
| `data_storage/chinese_mainland/ZODBStorage.py`（105 行） | 全文逐行 | ZODBStorageInstance + get_zodb_storage 单例 |
| `data_structure/chinese_mainland/ChinaStock.py`（~110 行） | 全文逐行 | 聚合根：datas/performance_reports/overview + 6 个 mutator |
| `data_structure/chinese_mainland/StockInfo.py`（16 行） | 全文逐行 | 9 字段 dataclass |
| `data_structure/chinese_mainland/StockOverview.py`（50 行） | 全文逐行 | 22 字段 dataclass + from_row |
| `data_structure/chinese_mainland/StockPerformanceReport.py`（43 行） | 全文逐行 | 15 字段 dataclass + from_row |
| `data_structure/chinese_mainland/ChinaStockData.py`（39 行） | 全文逐行 | 12 字段 dataclass + from_row |
| `ts/src/store.ts`（241 行） | 全文逐行 | StoreLike 契约 + SQLite Store（SCHEMA/事务/去重） |
| `ts/src/store-memory.ts`（90 行） | 全文逐行 | InMemoryStore（RN/web 用） |
| `ts/src/reports.ts`（118 行） | 全文逐行 | REPORT_COLUMNS/METRIC_COLUMNS/composeReports（15 列构造） |
| `ts/src/overview.ts`（134 行） | 全文逐行 | composeOverview（22 列构造） |
| `ts/src/gates.ts`（补充） | 全文 | getLastBusinessDay / overviewNeedsRefresh / reportsFresh |
| `ts/src/pipeline.ts`（补充） | 全文 | formatStockOutput / buildStockInformation（现算消费） |
| `ts/src/webCollect.ts`（补充） | 全文 | applyCollectedToStore（putStock nulls / replaceDatas / meta） |
| `ts/src/tdx/quoteClient.ts`（补充） | 目标区段 | fetchDailyBars 命名构造 DailyBar / applyQfq / collectAll |
| `ts/src/adjust.ts`（补充） | 全文 | qfq 后重算 amplitude/changePct/change（派生列现算证据） |
| `ts/src/indicators.ts`（补充） | 目标区段 | computeAll 输入契约（OHLCV）+ TURNOVER_RATE 现算 |
| `ts/app/lib/runner.ts`（补充） | 全文 | store 单例（InMemoryStore）、demo 载入、collectForWeb |
| `ts/app/screens/DataScreen.tsx`（补充） | 目标区段 | store 消费 + overview chips 字段名 |
| `ts/tools/probe.mts`（补充） | 目标区段 | 持久 SQLite Store 唯一生产侧使用点 |
| 对照证据 | 区段 | `core/data_acquisition.py:177-263`、`core/stock_output_formatter.py:26-28`、`core/llms/tools/get_trend_indicators.py:45-52`、`data_source/.../tdx/{mapping,overview,reports}.py`、`utils/constants.py`、`test/data_source/test_akshare.py`、`.trellis/tasks/archive/2026-08/08-13-full-codebase-review/research/ts-orchestration.md` |

**防假阳性核对（guides/index.md 三模式）**：① 信任边界——本分片数据均为内部持久化结构，无外部输入校验议题；② 设计注释——`check_need_update_overview`/`set_overview_updated_now` 的 deprecated docstring（ZODBStorage.py:51-52,66-67）与 spec「门标注 deprecated」为**有意设计**，据此标 BY_DESIGN 而非差距；③ 变量误读——`core/ui/data_markdown.py:104-105` 的 `ParsedStockInfo`（UI 解析结构）**不是** `StockInfo` dataclass（grep 命中已人工剔除）。

---

## ② 功能点差距表

### A. `data_storage/chinese_mainland/ZODBStorage.py`

| # | Python 功能点（file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| 1 | **存储后端 + 构造**：FileStorage 打开 `china_db_path`（锚定 REPO_ROOT/database/china_stock_data.fs，constants.py:7-9）→ DB/connection/root；seed `root.overview_last_updated = default_start`（1997-01-01，constants.py:3）；新库建 `root.stocks = OOBTree.BTree()`（ZODBStorage.py:17-24,30） | `Store` 构造：better-sqlite3 打开 dbPath（**默认 `':memory:'`**）+ SCHEMA 建 4 表 stocks/daily_bars/performance_reports/meta（store.ts:28-56,78-82）+ WAL pragma（store.ts:81） | **BY_DESIGN** | 后端差异本身是决策（08-09-ts-rewrite prd.md C3「移动端存储用 SQLite，不移植 ZODB」；design.md:107「无数据迁移：SQLite 从零建，不读 ZODB 文件」）。OOBTree→stocks 表、root 属性→meta 表均为关系化对应。**注意**：Store 默认 `:memory:`，生产 app 实际用 InMemoryStore（见 #9） | NON_BLOCKER |
| 2 | **线程安全**：连接非线程安全 + `self.lock = threading.RLock()`（读写链可重入，DataAcquisition 数据阶段持锁；ZODBStorage.py:25-29）；单例双检查锁 `_instance_lock`（ZODBStorage.py:83-105）；跨进程 flock 互斥（FileStorage 锁不可重入） | better-sqlite3 同步 API + Node 单线程事件循环 / RN 主线程串行渲染；无锁、无跨进程互斥需求（SQLite WAL 自带并发控制） | **BY_DESIGN** | 平台架构差异（08-09-ts-rewrite C2 选 better-sqlite3；Node 无多线程共享连接问题），非能力缺失 | NON_BLOCKER |
| 3 | **`__del__` 清理**：先 `transaction.abort()` 终止未提交事务 → `connection.close()` → `db.close()`（防 flock 锁泄漏；全程 try/except 不向外抛；ZODBStorage.py:32-49） | `close()` 显式关闭（store.ts:84-86 SQLite `db.close()`；store-memory.ts:11-16 清空 Map） | **FULL** | 生命周期清理等价；机制差异：Python GC 隐式析构 vs TS 显式调用。ZODB 特有的 abort/锁泄漏问题在 TS 无对应物（SQLite 无 flock；未提交事务由 db.close 自然丢弃） | NON_BLOCKER |
| 4 | **put_stock / get_stock**：`root.stocks[ticker] = stock` + commit；get 缺失返回 None（调用方分支）（ZODBStorage.py:72-80） | `putStock`/`getStock`：stocks 表 UPSERT（store.ts:102-127）；SELECT 缺失返回 null（store.ts:88-100；store-memory.ts:18-24） | **FULL** | 语义对齐（OOBTree ↔ stocks 表 ticker PK；None ↔ null） | NON_BLOCKER |
| 5 | **check_need_update_overview**（17:00 门：`overview_last_updated > 最近交易日 17:00` 才跳过；**deprecated**——仅 akshare 备用路径调用，主流程不走）（ZODBStorage.py:51-64） | 无全局 17:00 门；per-stock 门 `overviewNeedsRefresh(overviewLastUpdate < getLastBusinessDay(today))`（gates.ts:24-27）存在但生产零引用（见 #12） | **BY_DESIGN** | deprecated 证据：docstring（ZODBStorage.py:52-57）+ data_storage spec「check/set overview 门标注 deprecated (2026-08-02)」+ 全仓 grep：仅 legacy_akshare.py 引用。akshare 不移植（08-13 决策，ts/index.md「北交所/akshare：明确不支持」）→ 本门随删；TS per-stock 门语义见 #12 | NON_BLOCKER |
| 6 | **set_overview_updated_now**（盖章 root.overview_last_updated + commit；**deprecated**）（ZODBStorage.py:66-70） | 无 | **BY_DESIGN** | 同 #5（仅 akshare 备用路径 + 既有测试引用）；TS 无全局 stamp 需求（per-stock overviewLastUpdate 替代，见 #12） | NON_BLOCKER |
| 7 | **get_zodb_storage 进程级单例**（惰性 + 双检查锁；flock 不可重入约束）（ZODBStorage.py:83-105） | `runner.ts:17 export const store = new InMemoryStore()` 模块级单例（web/RN）；`probe.mts:26 new Store('probe-output/soa.sqlite')`（Node 探针） | **FULL** | 单例模式等价（模块级共享一个仓储实例）；TS 无 flock 跨进程约束 | NON_BLOCKER |
| 8 | **事务规则**：每写 commit；批量 mutator 一次 commit（0 = 全部重复不 commit）；get → mutate(commit=False) → put_stock → commit 单事务链（ZODBStorage.py:74；ChinaStock.py:33,56,83；data_storage spec 交易规则） | 每个写方法一个 `db.transaction()`（store.ts:103,139,157-169,191）；`addDatas`/`addPerformanceReports` 空 fresh 早退不写（store.ts:130,134,154,158） | **FULL** | 单事务/0-dup-不写语义逐项对齐（store.ts 头部注释自证「对齐 Python add_datas 语义」）；Python 的 commit 参数在 TS 无对应（每次 store 调用恒单事务，等价于 commit=False 链的最终效果） | NON_BLOCKER |
| 9 | **跨会话持久化**：`.fs` 文件库跨 run 保留（database/ 下 gitignored） | SQLite `Store` 实现完整（含测试 store-gates.test.ts / events.test.ts / pipeline.test.ts 全覆盖）+ Node 探针使用文件路径（probe.mts:26）；**但生产 web/RN app 接线为 `InMemoryStore`（runner.ts:17）**——浏览器无 better-sqlite3（native），`Store` 默认 `:memory:` 亦不可跨会话；无 IndexedDB/expo-sqlite 接线 | **PARTIAL** | 持久化能力存在（Store/SQLite）但 **app 生产接线缺失**：web 每次会话内存态、RN 真机注入点仅注释预留（runner.ts:2「真机留注入点」；08-09-m1 C2「RN 阶段换 expo-sqlite 时仓储接口保持同构」未实现）。Python phaseout 后跨会话数据缓存（已分析股票的历史/业绩）将不存在——每次会话经 /tdx-collect 重采集（App.tsx:184-190）。**功能不依赖**（恒重采集语义正确），但为体验/成本差异 | NON_BLOCKER，**需人工确认**（是否接受 app 无跨会话持久化；若要求，expo-sqlite/IndexedDB 接线为 phaseout 前置） |
| 10 | **root 全局属性**（overview_last_updated 等）作为 KV 存储 | meta 表 key/value（store.ts:45-48 SCHEMA；getMeta/setMeta store.ts:229-239；生产使用：`f10:<ticker>` 每股 F10 文本 webCollect.ts:33-34、`demo:f10` runner.ts:29） | **FULL** | 机制等价（root 属性 ↔ meta 表）；TS 新增 per-ticker F10 文本缓存（Python 无对应持久化，属附加能力，非差距） | NON_BLOCKER |

### B. `data_structure/chinese_mainland/ChinaStock.py`（聚合根）

| # | Python 功能点（file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| 11 | **构造 `(name, ticker, overview)` + 种子**：`overview_last_update = now`、`last_data_update = default_start.date()`（1997-01-01）、`datas`/`performance_reports` = PersistentList（ChinaStock.py:13-20） | `StockRecord{ticker,name,overview,overviewLastUpdate,lastDataUpdate}`（store.ts:20-26）+ putStock 由调用方全量传入：web 采集写全 null（webCollect.ts:27-33）、demo 写 lastDataUpdate=末根日期（runner.ts:21-27） | **PARTIAL** | 字段对应完整（datas/reports 外置为独立表，见 #24）。**种子语义差异**：Python 构造即盖章（now / 1997-01-01），TS 全 null。null 的 TS 语义与 Python 种子等价：addDatas null→全 fresh（store.ts:132-133）、overviewNeedsRefresh(null)→true（gates.ts:25）——即「从未更新」与「1997 年」在各自门逻辑下行为一致 | NON_BLOCKER |
| 12 | **update_overview(new_overview, commit=True)**：写 `self.overview` + `overview_last_update = now`（08-02 修复后 overview 为唯一写入槽位；commit=False 单事务链）（ChinaStock.py:22-33） | `updateOverview(ticker, overview, stamp)`（store.ts:174-178 SQLite UPDATE；store-memory.ts:60-65）——**生产零调用**（全仓 grep `updateOverview`：仅定义 + 测试，无任何调用方） | **PARTIAL** | 接口等价但**未接线**：Python 主流程每次分析经 ensure_stock 持久化概览 + 时间戳（core/data_acquisition.py:220-227 update_overview(commit=False) → put_stock）；TS 的 buildStockInformation 每次现算 composeOverview 不落库（pipeline.ts:189-196），applyCollectedToStore 恒写 `overview: null`（webCollect.ts:27-33）。行为差异：Python 跨会话/同日复用已存概览（`_overview_stale` 门跳过刷新，data_acquisition.py:250-255）；TS 每次分析重算恒新鲜。正确性无损（TS 恒最新），同日跳过优化丢失 | NON_BLOCKER（优化损失 + 门死代码，见 §④） |
| 13 | **add_data / add_datas**：`date > last_data_update` 全量过滤去重、推进 last_data_update、批量单 commit、返回实际追加数（0 = 全部重复不 commit）；输入须升序（ChinaStock.py:35-57） | `addDatas`：fresh = date > lastDataUpdate（store.ts:133；store-memory.ts:29-30）、单事务（store.ts:139-148）、推进 last_data_update、返回 fresh.length、空 fresh 早退（store.ts:130,134） | **FULL** | 契约输入（升序）下行为逐项对齐（含 0-dup-不写）；TS 多一层防御：SQLite `INSERT OR REPLACE` 幂等（store.ts:136-137）、InMemory 合并后排序 + 同日期 keep-last（store-memory.ts:32-37）。Python 侧 get_trend_indicators 仅读 OHLCV 子集（get_trend_indicators.py:45-52），与 TS 存储行差异（见 #21）不冲突 | NON_BLOCKER |
| 14 | **add_performance_report / add_performance_reports**：`report_date > 最后一份` 去重（仅与末尾比较）、批量单 commit、返回追加数（0 = 全部重复不 commit）；输入须 report_date 升序（ChinaStock.py:62-84） | `addPerformanceReports`：与**全部已存在 report_date 集合**去重（store.ts:155-156；store-memory.ts:52-53）、合并后排序（store.ts:165；store-memory.ts:54-56）、单事务、返回 fresh.length | **PARTIAL** | 契约输入（升序）下等价。**边界差异**：非升序输入 Python 丢弃「不新于最后一份」的行（ChinaStock.py:74-76），TS 接受任何未见过日期并排序入库；TS 去重基准为全量集合（补插历史缺期可行），Python 为末尾游标（不可补插旧期）。两实现均声明输入须升序（spec data_structure），差异仅越界输入下显式（并记录供 phaseout 参考） | NON_BLOCKER |
| 15 | **get_datas / get_performance_reports**：返回 PersistentList **活引用**（调用方可直接 mutate）（ChinaStock.py:59-60,86-87） | `getDatas`/`getPerformanceReports`：每次返回**新数组/新对象**（防御拷贝）（store.ts:205-219,221-227；store-memory.ts:67-73） | **FULL** | TS 为有意的语义改进（防调用方污染存储）：ts/index.md 图表节明确「store.getDatas 每次返回新数组」为契约（DataScreen.tsx:22 useMemo 依赖此语义），两实现均满足。TS 还多一层：SQLite 侧 ORDER BY date（store.ts:208）防御排序，Python 靠构造序 | NON_BLOCKER |
| 16 | （TS 内部）**Store 与 InMemoryStore 双实现边界分叉**——08-13 已审，记录 | store.ts vs store-memory.ts | **PARTIAL** | 08-13-full-codebase-review research/ts-orchestration.md:66-88（INFO×3）：① replaceDatas 空数组——Store 早退不清（store.ts:186）vs InMemory 先 delete 清空（store-memory.ts:46-47），空输入下 InMemory 抹掉该 ticker 全部日K；② addDatas 判重基准——Store 用 stock.lastDataUpdate（store.ts:132）vs InMemory 用现有 bars 末元素日期（store-memory.ts:29），未先 putStock 时语义分叉（计数虚高）；③ getStock 活引用（store-memory.ts:19）vs 新对象（store.ts:88-99）。当前调用链（webCollect/pipeline/probe）均先 putStock 且只读返回值，未触达 | NON_BLOCKER |

### C. 五个 dataclass（字段级对齐）

| # | Python 功能点（file:line） | TS 等价物（file:line） | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|
| 17 | **StockOverview 22 字段**（StockOverview.py:8-29）：ticker/name/latest_price/change_percent/change_amount/volume/**turnover**/amplitude/high/low/**open**/**previous_close**/volume_ratio/turnover_rate/pe_dynamic/pb/market_cap/circulating_market_cap/momentum/change_percent_5min/**change_percent_60days**/change_percent_ytd | `OverviewRow` = composeOverview 输出（overview.ts:66,108-128）：22 字段 1:1；**4 个更名**：turnover→amount、open→open_、previous_close→prev_close、change_percent_60days→change_percent_60d | **FULL** | 字段数 22=22，值语义逐字段对齐（含 NaN 约定：volume_ratio/momentum/change_percent_5min 恒 NaN、PE/PB 分母 ≤0→NaN，overview.ts:117,124-125,120-121 vs tdx/overview.py:186-215）。**更名仅为内部一致性**：TS 全部消费者用 TS 名（DataScreen.tsx:59-64、pipeline.ts:51、overview.test.ts:26-28），无任何 Python 名消费者；08-09 决策「无数据迁移」（design.md:107）→ 无存量数据名兼容问题 | NON_BLOCKER |
| 18 | **StockOverview.from_row**（命名构造：column_map 缺列 → KeyError 响亮失败；多余列忽略；overrides 覆写）（StockOverview.py:32-50） | composeOverview 对象字面量命名构造（overview.ts:108-128）；TDX 路径 column_map=OVERVIEW_COLUMN_MAP（tdx/overview.py:33-40）由 composeOverview 输入参数显式承担 | **PARTIAL** | 命名构造契约（列名承重）在 TS 等价成立。**机制差异**：TS 无 DataFrame 层，缺列/缺失源的失败模式为 NaN/undefined 静默（divide 守卫 overview.ts:23-27、latestPeriodValue 返回 NaN overview.ts:38）而非 KeyError——响亮性降低，但 TS 输入为强类型对象 + 单测钉死（overview.test.ts 全字段断言），列序漂移风险不存在（无位置构造）。akshare 全市场列形态路径 BY_DESIGN（akshare 不移植） | NON_BLOCKER |
| 19 | **StockPerformanceReport 15 字段**（StockPerformanceReport.py:7-22）：ticker/name/eps/total_income/total_income_YoY_rate/total_income_QoQ_rate/net_profit/net_profit_YoY_rate/net_profit_QoQ_rate/net_worth_per_share/net_worth_return_rate/cash_flow_per_share/sales_gross_margin/industry/report_date（'%Y%m%d' 字符串） | `PerformanceReport{report_date, fields}`（store.ts:15-18）+ `REPORT_COLUMNS` 15 列与 Python 同序同名（reports.ts:8-16）；composeReports 填全 15 列（reports.ts:61-118）：sales_gross_margin 恒 NaN、industry 恒 ''（reports.ts:104-106，对齐 Python reports.py 契约）；report_date 'YYYY-MM-DD'→'%Y%m%d'（reports.ts:88） | **FULL** | 字段/顺序/格式/NaN 约定全部对齐。**存储形态差异**：TS 平铺字段嵌套进 `fields` Record 存 fields_json（store.ts:16-17,44,161-166）vs Python dataclass 平铺列——store 内部契约（REPORT_COLUMNS 即文档），非行为差异 | NON_BLOCKER |
| 20 | **StockPerformanceReport.from_row**（column_map=None 恒等路径；akshare yjbb 传 YJBB_COLUMN_MAP）（StockPerformanceReport.py:24-43） | composeReports 命名构造（reports.ts:61-118）；恒等路径由 REPORT_COLUMNS 数组承担 | **PARTIAL** | 同 #18（机制差异：命名构造等价、无响亮 KeyError；TS 缺失指标 → NaN 静默，reports.ts:94-101 num() 守卫）。YJBB_COLUMN_MAP akshare 路径 BY_DESIGN（akshare 不移植，08-13 决策） | NON_BLOCKER |
| 21 | **ChinaStockData 12 字段**（ChinaStockData.py:7-19）：date(datetime.date)/ticker/open/close/high/low/volume(手)/turnover(成交额元)/amplitude/percentage_gain/price_change/turnover_rate | `DailyBar`（store.ts:5-13）：date('YYYY-MM-DD')/open/close/high/low/volume/amount——**7 字段** | **PARTIAL** | **字段裁剪明细**：① ticker 上提为 SQLite 表列（daily_bars PK(ticker,date)，store.ts:37），由查询参数承担（store.ts:208）——等价；② turnover→amount 更名（quoteClient.ts:45 amount/1000 元）；③ amplitude/percentage_gain/price_change/turnover_rate **不落库**，按需现算：qfq 后重算（adjust.ts:67-70）、涨跌幅序列 changePercentSeries（pipeline.ts:33-35）、换手率 turnoverPct（pipeline.ts:38-41）、指标行 TURNOVER_RATE（indicators.ts:212-242,230-231）。**Python 侧消费方核对**：formatter 读 percentage_gain/turnover_rate（stock_output_formatter.py:26-28）、指标层仅读 OHLCV（get_trend_indicators.py:45-52）、amplitude/price_change 生产零消费（charts/data_markdown 消费解析文本的 Change Percent/Turnover Rate，data_markdown.py:61-64）——TS 现算覆盖全部真实需求，无能力缺失。④ 日期格式：Python datetime.date 对象 vs TS 字符串，升序契约等价（mapping.py 输出 `.dt.date` vs quoteClient.ts:39 toISOString 前 10 位） | NON_BLOCKER |
| 22 | **ChinaStockData.from_row**（column_map=AKSHARE_HIST_COLUMN_MAP，mapping.py:27-41）（ChinaStockData.py:21-39） | fetchDailyBars 命名构造 DailyBar（quoteClient.ts:38-46：date/OHLCV/volume/amount 对象字面量） | **PARTIAL** | 同 #18（命名构造等价；无响亮 KeyError；12 列→7 列差异见 #21；akshare 列形态路径 BY_DESIGN） | NON_BLOCKER |
| 23 | **StockInfo 9 字段**（StockInfo.py:7-16）：value/ticker/name/total_shares/float_shares/market_cap/float_market_cap/industry/date_listed | **无等价物**（全仓 grep：TS 无 StockInfo/date_listed/total_shares 对应类型或表） | **MISSING** | Python 生产**零消费者**：grep core/agents/data_source/utils/scripts/data_storage 无引用；仅 `test/data_source/test_akshare.py:7,26`（akshare 路径测试，`StockInfo(*stock_dict.values())` 位置构造）消费。spec data_structure 自证「StockInfo exists but is only exercised in test_akshare.py」+ add_info/get_info 已删（无引用）。TS 侧等价信息源：CapitalData{zongguben,liutongguben}（overview.ts:15-18）+ composeOverview 市值派生（overview.ts:122-123）覆盖股本/市值语义 | NON_BLOCKER（随 Python 删除；TS 无需补——akshare 测试面不移植） |
| 24 | **持久化形态**：dataclass 继承 persistent.Persistent + PersistentList 对象图（整对象 pickle） | SQLite 关系表：stocks / daily_bars / performance_reports / meta（store.ts:28-56） | **BY_DESIGN** | 08-09-ts-rewrite-m1 prd.md R4（4 表设计）；08-09-ts-rewrite design.md:67-68。ZODB 写放大 34x（08-09 研究 q3-offline-data.md:83）为选 SQLite 的动因 | NON_BLOCKER |
| 25 | **批量 mutator commit 参数**（commit=True/False 单事务链，ChinaStock.py:39,66；data_structure spec「mutator commit 参数（2026-08-09）」） | 无 commit 参数——store 写方法恒单事务（每次调用一个 db.transaction） | **FULL** | 语义等价：Python commit=False 链由紧随 put_stock 一次 commit 持久化（data_acquisition.py:220-227）；TS 每次 store 调用即一事务，「0=全重复不写」早退（store.ts:130,134,154,158）使幂等重入不产生写放大 | NON_BLOCKER |

**差距表状态统计**：FULL 10 / PARTIAL 9 / MISSING 1 / BY_DESIGN 5

---

## ③ MISSING + PARTIAL 汇总清单（移植/删除时照此逐条）

### MISSING（1 条）

| # | 功能点 | 证据 | 性质 | 处置建议 |
|---|---|---|---|---|
| M1 (#23) | **StockInfo dataclass**（9 字段） | Python 生产零消费者（grep 全仓仅 test/data_source/test_akshare.py:7,26）；spec data_structure「only exercised in test_akshare.py」 | akshare 测试面产物（akshare BY_DESIGN 不移植） | **随 Python 整体删除，TS 无需补**。删除时注意：`StockInfo.float_market_cap` 与 `StockOverview.circulating_market_cap` 的语义孪生注释一并清理 |

### PARTIAL（9 条，全部 NON_BLOCKER）

| # | 功能点 | 差异实质 | 性质 | 处置建议 |
|---|---|---|---|---|
| P1 (#9) | **跨会话持久化未接线** | SQLite Store 实现完整（Node/probe/测试），但生产 web/RN app 用 InMemoryStore（runner.ts:17），无 expo-sqlite/IndexedDB 接线；Python `.fs` 库跨会话保留 | **需人工确认**（产品决策） | phaseout 前决策：接受「每次会话重采集」则可随删；要求跨会话缓存则在删 Python 前补 expo-sqlite（08-09-m1 C2 预留接口 StoreLike 同构）或 IndexedDB 适配 |
| P2 (#12) | **updateOverview + overviewNeedsRefresh 未接线** | 接口存在（store.ts:174-178；gates.ts:24-27），生产零调用；TS 每次现算 overview 不落库（pipeline.ts:189-196；webCollect.ts:27-33 恒 null）；Python 持久化概览 + 同日跳过门（data_acquisition.py:220-227,250-255） | 未接线（死代码级）+ 优化损失 | 删 Python 前确认：TS 恒现算语义正确（恒新鲜），同日跳过优化是否值得接线。`overviewNeedsRefresh` 若永不用可随清理（getLastBusinessDay 已被 agents.ts 生产使用，需保留） |
| P3 (#11) | **构造种子语义** | Python 构造盖章 now / 1997-01-01；TS null | 语义等价（各自门逻辑下行为一致） | 无需补；随删 Python 的 default_start 依赖（constants.py:3 若仅存储层使用可清理） |
| P4 (#14) | **业绩去重基准** | Python「仅 > 最后一份」（末尾游标）；TS「不在全量集合」（set）→ 非升序输入 TS 接受并排序、Python 丢弃；TS 可补插历史缺期 | 越界输入行为差异（契约输入下等价） | 无需补；phaseout 移植文档注明即可（若想严格对齐可在 addPerformanceReports 加升序断言，非必需） |
| P5 (#16) | **Store vs InMemoryStore 三处分叉** | replaceDatas 空输入 / addDatas last 基准 / getStock 引用语义（08-13-full-codebase-review research/ts-orchestration.md:66-88） | 已审边界（08-13 记录） | 记录即可（本任务要求）；修复建议见 08-13 报告（对齐 SQLite 语义：空数组早退前置、last 优先取 lastDataUpdate、getStock 浅拷贝） |
| P6 (#18/#20/#22) | **from_row 命名构造机制** | TS 无 DataFrame 层：命名构造内联（quoteClient.ts:38-46、overview.ts:108-128、reports.ts:61-118）；「缺列 KeyError 响亮失败」→「NaN/undefined 静默」（divide/latestPeriodValue/num 守卫） | 机制差异（列序漂移风险在 TS 不存在——无位置构造） | 无需补；TS 强类型 + 单测（overview.test.ts/reports.test.ts 字段断言）承当契约 |
| P7 (#21) | **ChinaStockData 12→DailyBar 7 字段裁剪** | ticker 上提表列；turnover→amount；amplitude/percentage_gain/price_change/turnover_rate 不落库按需现算（adjust.ts:67-70、pipeline.ts:33-41、indicators.ts:230-231）；Python 侧消费方全部有现算等价 | 存储裁剪（无能力缺失） | 无需补；删除 Python 时确认无其他代码读存储行派生列（grep 已核：amplitude/price_change 生产零消费） |
| P8 (#13 附属) | **getDatas 返回新数组语义** | Python 活引用 vs TS 防御拷贝（spec 契约化） | 有意改进 | 无需补（ts/index.md 图表节已契约化） |
| P9 (#17) | **概览字段 4 更名** | turnover→amount、open→open_、previous_close→prev_close、change_percent_60days→change_percent_60d | 内部一致性（TS 消费者全用 TS 名；无迁移） | 无需补；若未来有导出/迁移场景，以 REPORT_COLUMNS 式常量文档化（当前仅 overview.ts:108-128 字面量） |

### 删除建议（随 phaseout 一并移除，避免遗留）
- `ZODBStorage.check_need_update_overview` / `set_overview_updated_now`（#5/#6，deprecated 仅 akshare 备用路径）+ 对应测试
- `StockInfo.py` 整体（#23，仅 akshare 测试消费）+ `data_structure spec` 中 StockInfo 条目 + `StockInfo.float_market_cap` 孪生注释
- `default_start` 若仅存储层种子使用可清理（P3；需先 grep 其他层引用——time_helper/akshare 路径可能仍引用，属其他分片确认范围）
- `ChinaStockData` 的 amplitude/percentage_gain/price_change/turnover_rate 字段若保留 Python 运行（测试契约）则不动，phaseout 时确认无存储行派生列消费者后整体删除

---

## ④ spec 符合性结论（能力接线点）

对照 `.trellis/spec/ts/index.md`（事件协议/图表/能力接线）与 `.trellis/spec/data_storage/index.md`、`.trellis/spec/data_structure/index.md`：

| 接线点 / spec 要求 | 是否存在 | 证据 |
|---|---|---|
| **存储层能力接线（能力接线节关联）**：qfq 日期契约 YYYY-MM-DD（store 契约；qfqAdjust 输入 YYYYMMDD，接线层双向转换） | ✓ | quoteClient.ts:39（fetchDailyBars toISOString 前 10 位）、quoteClient.ts:106-131（applyQfq 内 replace(/-/g,'') / slice 恢复）；store daily_bars.date TEXT（store.ts:36） |
| **北交所/akshare 明确不支持** | ✓ | ts/index.md「北交所/akshare：明确不支持(用户决策 08-13)」；本分片 akshare 相关（StockInfo、YJBB/OVERVIEW_COLUMN_MAP 全市场形态、17:00 门）全部 BY_DESIGN |
| **图表节「store.getDatas 每次返回新数组」** | ✓ | store.ts:205-219（每调新数组）、store-memory.ts:67-68（map 拷贝）；DataScreen.tsx:22 useMemo([ticker, dataVersion]) 依赖此语义 |
| **图表节「数据同源：图表消费 computeAll 结果行，与最新指标 chips 同一份」** | ✓（本分片旁证） | DataScreen.tsx:31-34（indRows = computeAll(bars) 单份，chips 与图表共用）；computeAll 输入契约 = DailyBar 子集 OHLCV（indicators.ts:212-242）——存储行 7 字段足以支撑 |
| **data_storage spec 事务规则**：每写 commit / 批量单事务 / 0=全重复不写 / 读不 commit | ✓ | store.ts:130,134,154,158（早退）+ db.transaction（store.ts:103,139,157-169,191）；读方法无写（getStock/getDatas/getMeta 纯 SELECT） |
| **data_storage spec 单例**：进程共享一个仓储实例 | ✓ | runner.ts:17 模块级 store 单例（web/RN）；probe.mts:26（Node） |
| **data_storage spec freshness 门**：per-stock 概览门（`overview_last_update.date() < get_last_business_day`） | ⚠️ 函数存在未接线 | gates.ts:24-27 `overviewNeedsRefresh` + gates.ts:15-21 `getLastBusinessDay`（逐位对齐 Python time_helper；含单测 store-gates.test.ts:86-92）；生产采集链不消费（见 P2）——spec 要求的是「门语义正确」，接线缺失属 P2 记录项，非 spec 违规 |
| **data_structure spec 命名行构造（08-09-named-row-constructors）**：列名承重、缺列 KeyError、overrides | ✓（机制等价） | TS 全程命名构造无位置构造（quoteClient.ts:38-46、overview.ts:108-128、reports.ts:61-118）；KeyError 响亮性由强类型 + 单测替代（P6） |
| **data_structure spec dedupe / commit 语义**：date/report_date 去重、批量单 commit、0=全重复不写 | ✓ | store.ts:129-150（addDatas）、153-171（addPerformanceReports）；边界差异见 P4 |
| **data_structure spec 日期格式**：report_date '%Y%m%d' 字符串、ChinaStockData.date datetime-like | ✓ | reports.ts:88（period.replace(/-/g,'')）；store.ts:16（report_date: '%Y%m%d'）；DailyBar.date YYYY-MM-DD 字符串升序（store.ts:6） |

**结论**：
1. **本分片无缺失的能力接线点**（MISSING 仅 StockInfo，且为 akshare 测试面产物，BY_DESIGN 随删）。能力接线节（亿信/mcp/qfq/北交所）与本分片唯一交集 qfq 日期契约完全符合（quoteClient.ts:39,106-131）；Python 侧 ZODB 存储层整体由 SQLite 关系表等价替代（BY_DESIGN，出处 08-09-ts-rewrite prd.md C3 + design.md:107）。
2. **全部 PARTIAL 均为 NON_BLOCKER**：正确性无缺口（TS 恒现算/恒采集语义是正确超集）；差异集中在「接线缺失」（P1 跨会话持久化、P2 overview 门）、「越界输入行为」（P4/P5）、「机制/命名」（P6/P7/P9）。
3. **需人工确认的点（1 个，P1）**：web/RN app 无跨会话持久化（InMemoryStore）是否为 phaseout 可接受状态——这是本分片唯一影响 phaseout 范围的产品决策；若要求持久化，expo-sqlite（08-09-m1 C2 预留）或 IndexedDB 接线需列为 phaseout 前置。P2（overview 持久化 + 同日跳过门）为优化损失，不影响删除 Python 的可行性。
4. **08-13 交叉引用**：store 双实现三处分叉（P5）已在 08-13-full-codebase-review 记录（ts-orchestration.md:66-88），本报告按任务要求记录差距，不重复审计。
