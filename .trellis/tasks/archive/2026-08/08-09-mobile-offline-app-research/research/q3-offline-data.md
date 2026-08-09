# Q3 研究：完全离线手机的股票数据从哪来（预取方案）

**查询**：TDX/akshare 均为联网源，离线 App 的数据必须预取——需要哪些数据、单股/全市场体量、同步策略、移动端存储选型、离线降级语义、离线交易日判定。

**日期**：2026-08-09（数据测量于当日，本仓库 `database/china_stock_data.fs` 最后更新 2026-08-09 14:43）

**方法**：仓库源码/spec 通读 + 本机只读实测（ZODB 库 stat 与只读遍历、tdx_cache parquet 逐文件量测、pickle 序列化尺寸测量）+ 公开来源交叉验证。

---

## Findings

### 1. 需要哪些数据（数据清单与离线可得性）

现有分析链路（`core/data_acquisition.py` 纯 TDX 按需链路）依赖的数据，逐类清单如下。**结论先行：除"实时行情/实时情报/亿信/网络搜索"四类外，其余全部可预取后完全离线可用。**

| 数据类别 | 持久化形态（dataclass） | 数据源 | 实测单股体量 | 离线可用性 |
|---|---|---|---|---|
| 历史日K（前复权，12 字段：开/收/高/低/量/额/振幅/涨跌幅/涨跌额/换手率） | `ChinaStockData`（`data_structure/chinese_mainland/ChinaStockData.py`，存于 `ChinaStock.datas`） | TDX `fetch_daily` + `fetch_xdxr` + `qfq_adjust`（`data_source/chinese_mainland/tdx/`） | 见第 2 节 | **预取后完全离线**（技术指标全部由此本地计算） |
| 个股概览（22 字段：价格/涨跌幅/量比/换手率/PE/PB/市值/60日/YTD 等） | `StockOverview`（存于 `ChinaStock.overview`） | `overview.py build_overview`：snapshot + F10 + 股本 + 日K **派生**（PE/PB/市值/涨跌幅/60日/YTD 均由快照数据算） | ~0.6 KB（pickle 实测 588 B） | 预取快照可用；`latest_price` 等价格字段离线时为**最后同步日收盘静态值** |
| 业绩报告（F10，15 字段，每季度一行） | `StockPerformanceReport`（`ChinaStock.performance_reports`） | TDX F10 页 → `f10_parser.py` → `compose_reports` | ~0.5 KB/期（pickle 实测 497 B），全历史约 9-10 期 | **预取后完全离线**（历史不变；新季度需联网同步） |
| F10 财务分析页原文（【主要财务指标】【盈利能力指标】等分节） | tdx_cache `company_info_raw` parquet（`TdxSource.fetch_company_finance_raw`，**零网络**读缓存） | TDX F10 页 | ~7-16 KB/股（实测 16K/600519，172 KB/24 股） | **预取后完全离线**（`get_financial_indicators` 只读 raw 缓存） |
| 技术指标（MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比/换手率） | **不落库**——`get_trend_indicators.py` 每次从 ZODB 日K 经 vendor `compute_all` 本地重算 | 本地计算（`core/llms/tools/get_trend_indicators.py`） | 0（无存储） | **无网络依赖**，预取日K 即可；离线唯一注意：换手率需流通股本（`finance_capital`，也预取） |
| 证券列表（SH/SZ 全量） | tdx_cache `security_list` parquet（当日分区） | TDX `fetch_security_list` | 双市场 7.3 MB（实测 26,654 + 21,000 行） | 预取快照可用 |
| 除权除息事件（xdxr） | tdx_cache `xdxr` parquet | TDX | 45 行/24 年（600519），~12 KB | 预取后完全离线（仅当有新除权事件需更新） |
| **实时行情（snapshot）** | 仅存在于 `StockOverview` 派生值中，不单独落库 | pytdx snapshot | — | **本质联网**：离线只能回退"最后同步日快照" |
| **实时情报（TDX MCP：概念板块/资金流向/大盘概况）** | `data/tdx_cache/mcp_intel/ticker=<T>/data.json` 缓存（实测 477 B/股） | TDX MCP API | ~0.5 KB/股 | **本质联网**；现有非交易时段读缓存分支（`get_market_intel`）可扩展为离线恒读缓存 |
| **亿信金融问数/搜索/研报（可选情报）** | 不落库（`BillionsClient` 返回 dict 即消费） | 亿信 REST API | 0（无存储） | **本质联网**；现有 `BILLIONS_*_DISABLED` 开关族直接复用为离线占位 |
| **网络搜索（DuckDuckGo）** | 不落库 | langchain DDG | 0 | **本质联网**；现有 `WEB_SEARCH_DISABLED` 开关直接复用 |

**离线不可用的数据 = 只有实时类（snapshot / MCP / 亿信 / 网络搜索）**——它们占分析输入的比例小：`build_stock_information` 五段中，个股信息 + 技术指标 + 财务指标三段完全离线可得（占报告主体），实时情报/亿信为附加段，缺位时已有成熟占位文本。

### 2. 体量估算（本机实测 + 全市场外推）

**实测基准（本仓库数据）：**

- ZODB 库 `database/china_stock_data.fs` = **324 MB**，含 24 只股票、27,588 根日K（平均 1,150 根/股，600519 有 5,973 根）、644 份业绩报告；最早 bar 2001-08-27，最新 2026-08-09。`.fs.index` 仅 399 KB。
- 单根日K 序列化：pickle 342 B（zlib 284 B）；parquet（15 列含 ticker）**52-54 B/行**（600519 全历史 5,973 行 = 308 KB，300750 1,976 行 = 107 KB）。
- 单股全量 pickle：600519（5,973 根）843 KB 原始 / 447 KB zlib。
- 概览 588 B、单份业绩报告 497 B、xdxr ~12 KB、F10 raw ~10 KB、mcp_intel 477 B、证券列表 7.3 MB。
- **关键发现——ZODB FileStorage 写放大 ~34x**：库文件 324 MB vs 现存对象序列化总和 ~9.7 MB（27,588 × 342 B + 644 × 497 B + 24 × 588 B）。原因：`PersistentList` 是**整体单对象 pickle**（非 BTrees 分桶），每次增量 commit（每日 1-2 根 bar）重写整表（~800 KB/股/commit），旧版本永远留在文件里。文件只增不减（从未 pack）。

**单只股票（全历史，数量级）：** 约 0.3-1 MB（parquet 紧凑存储）～1.2 MB（pickle 原始）。**100 只自选股 ≈ 15-20 MB（parquet/SQLite）——手机完全无压力。**

**A 股全市场（~5,535 只，2026-06 中上协口径）：**

| 数据 | 估算 | 依据 |
|---|---|---|
| 历史日K（全历史，平均 ~3,000 根/股，范围 250-9,400） | **~0.9-1.1 GB**（parquet 54 B/行）或 ~0.6-0.7 GB（SQLite 数值型） | 5,535 × 3,000 × 54 B ≈ 0.9 GB；实测 52-86 B/行 |
| 个股概览（全市场，每交易日刷新） | ~3.3 MB | 5,535 × 588 B |
| 业绩报告（10 期） | ~27 MB | 5,535 × 10 × 497 B |
| F10 raw 原文 | ~55 MB | 5,535 × ~10 KB |
| 证券列表 | 7.3 MB（实测） | 双市场 parquet 现值 |
| **全量预取合计** | **~1.0-1.2 GB** | 日K 占 95%+ |
| **日增量**（仅日K + 当日刷新概览） | **~0.3-4 MB/交易日** | 日K: 5,535 根 × 54 B ≈ 0.3 MB；概览全刷 +3.3 MB；F10/xdxr 仅季度/事件时 |

全市场数交叉验证：本地 security_list 缓存股票类代码 SH 2,315 + SZ 2,895 = 5,210，与中上协 2026-06 口径（沪 2,314 + 深 2,898 + 北 323 = 5,535）高度吻合（北交所不在 TDX 支持范围，本仓库 `is_bj_ticker` 显式拦截）。

**同步耗时要点：瓶颈是 per-stock 网络往返次数而非字节数。** pytdx 单股全量 = 2-4 个请求（daily/xdxr/capital/F10），5,535 股串行 ~1.5-4 小时（按 1-3 s/股估）；并发 10-20 路 → **5-15 分钟**（未实测单股耗时，见 Caveats）。下载字节 1 GB 在 Wi-Fi（~10 MB/s）约 2 分钟量级。所以"一次同步几小时"只在串行实现下成立，合理实现是分钟级。

### 3. 同步策略

**推荐：联网时按需 + 批量混合，两级同步。**

- **自选股/最近分析过的股票（~100 只）**：沿用现有按需链路（`get_stock_data` 的三门 freshness 判定），分析时即增量同步——体量 15-20 MB，秒级。
- **批量全量（一次性，~1 GB）**：首次装机或"离线深度游"场景，Wi-Fi + 并发拉取，分钟级；全市场日K 到齐后，任何一只股票离线都可分析。
- **增量更新（~0.3-4 MB/交易日）**：联网状态下每日一次（收盘后 ~17:00，对齐现有 17:00 门），只拉 `date > last_data_update` 的 bar（`_history_gap` 增量逻辑现成）+ 当日概览 + 新季度 F10。
- **同步窗口**：`market_time.is_trading_time` 现成可判定"收盘后"窗口；手机端建议 Wi-Fi 才允许全量同步（1 GB 走蜂窝不合适）。

**新鲜度语义复用（结论：存储层门可复用，抓取触发需新闸门）：**

- 可复用：`ChinaStock.last_data_update` / `overview_last_update` / `_history_gap` / `_reports_stale`（report_date == 最近季度末）——它们全部基于**已入库日期**比较，离线时依然成立。
- **需新写**：离线模式主开关——现在所有门"未命中就触发网络抓取"，离线时必须整体跳过网络（否则每次离线分析都等 TDX 连接超时降级）。即：`DataAcquisition` 三方法（`ensure_stock` / `acquire_historical_data_tdx` / `acquire_performance_report_tdx`）与 `get_stock_data` 的预播种 fetch 前加离线短路（"门未命中 + 离线 → 直接返回 True，用快照"），这层短路目前**不存在**，是新增代码量最集中的点。
- **"离线 = 用上次同步的快照分析"的诚实表述**：App 明示"数据截至 <last_data_update>（北京时间收盘）"；UI 展示 last_data_update / overview_last_update / 最新 report_date；实时行情段、亿信段、搜索段显示占位"离线不可用"。这一语义在产品上必须提前与用户对齐——**离线分析的正确性上限 = 同步时刻的数据**。
- 附加诚实点：**前复权价格锚定同步日**——`qfq_adjust` 的复权因子以同步时的 xdxr 事件计算，同步之后发生分红送转的公司，快照的历史价与新拉的复权价会有小幅差异（老 bar 价格偏差，数量级 < 1%）；全量重同步即恢复精确。

### 4. 移动端存储：ZODB vs SQLite vs DuckDB

| 维度 | ZODB（现状） | SQLite | DuckDB |
|---|---|---|---|
| 手机可行性 | 纯 Python（persistent/ZODB/transaction 无 C 扩展必需；BTrees 有可选 C 加速，纯 Python 回退存在）；Termux 全兼容；iOS 需嵌入式 CPython（PythonKit/Pyto——**未实测**，见 Caveats）。FileStorage 单文件 + flock（本仓库已充分打磨单进程锁语义） | **双平台内建**（iOS sqlite3 C API / Android SQLiteDatabase），Python 侧 stdlib `sqlite3` 零新依赖 | 官方 Dart/Flutter 客户端 `dart_duckdb` 支持 iOS/Android（需 NDK/SDK 构建）；Python 侧 `duckdb` 是 C 扩展，iOS 嵌入式 Python 不可行，Termux 可行 |
| 单文件/沙盒 | FileStorage 单文件 + 3 个锁/索引伴生文件，iOS 沙盒/Android 应用目录无问题 | 单文件，最成熟 | 单文件（列式，压缩率高） |
| 写放大 | **实测 ~34x**（PersistentList 整体 pickle，每次增量重写整表；文件只增不减，需定期 `pack()`） | 无（页级增量） | 无（列式 append） |
| 全市场（~1 GB 目标） | 现存对象序列化 ~2.5 GB 起，文件增长按 commit 历史爆炸（日均 ~800 KB × 5,535 股不可持续）→ **不可行** | 可行（0.6-0.7 GB） | 可行（~0.7 GB） |
| 自选股（~100 只） | 可行（现存数据 ~120 MB 量级 + 定期 pack） | 可行（~15-20 MB） | 可行 |
| 现有 ZODB 数据能否直接搬 | **能**：`.fs` 就是普通文件，拷到手机应用目录 + 同版本 ZODB + 同包名模块路径（`data_structure.chinese_mainland.*`）即可读；但 24 股 324 MB 的库建议先 `pack()` 再搬 | 需一次性迁移脚本（dataclass 字段 → 表列，字段序即列序，规格里有 `zip(fields(Dataclass), COLUMNS)` 同源契约） | 同 SQLite，需迁移 |

**结论：** 自选股规模（当前主形态——纯 TDX 架构下 DB 只含分析过的股票）ZODB 直接搬可行，代码复用率最高（持久化层零改动）；全市场规模 ZODB 不可行（写放大 + 无压缩），若走全量预取则 SQLite（Python 侧最稳）或 DuckDB（Flutter 原生侧最强，Path B/C 架构下首选）。**建议：SQLite 为 Python 侧默认，DuckDB 为 Flutter 侧备选，ZODB 保留为小规模直接搬运通道。**

### 5. 离线降级语义（现有开关/降级路径可复用度）

**可直接复用（零改动）：**

- `WEB_SEARCH_DISABLED`（`web_search_enabled()`，`utils/runtime_config.py` 统一 env 假值判定）→ 离线时图装配不绑搜索工具。
- `TDX_MCP_DISABLED`（`get_market_intel._mcp_disabled()`）→ 离线时整个实时情报段返回占位文本。
- `BILLIONS_DISABLED` + `BILLIONS_{FINDB,SEARCH,TWITTER,FETCH,ANALYST}_DISABLED` + 调用上限（`utils/billions_config.py`，`billions_enabled(cap)`）→ 离线时亿信段空串/占位。
- 工具失败占位模式：`get_market_intel` / `get_trend_indicators` / `get_financial_indicators` / 亿信工具一律"失败 → 占位文本不 raise"（error-handling spec）——离线表现为恒占位，图可继续。
- `market_time.is_trading_time`：纯墙钟判定（无网络），离线安全；`latest_trading_day(stock)` 从日K 末根 bar 取最近交易日，零网络——**这正是离线"最新交易日"的正确原语**。
- `get_market_intel` 的 mcp_intel 缓存分支（非交易时段读缓存）：离线可扩展为"恒读缓存"，让最后一同步的实时情报仍可见（需小改：现缓存读取前提是 TDX_API_KEY 存在）。

**需新写：**

1. **离线模式主开关**（见第 3 节）：短路 DataAcquisition 全部网络抓取 + `get_stock_data` 预播种 fetch；离线时 `ensure_stock` 遇库中无该股 → 明确报"该股不在离线数据中"而非静默降级。
2. **快照日期透出**：把 `last_data_update` / `overview_last_update` / 最新 `report_date` 组装进 UI 与 agent prompt（"数据截至 X"）。
3. **同步管理器**：联网时触发全量/增量同步的编排（并发拉取、断点续传、Wi-Fi 门）。
4. 离线时 `web_search` 等工具建议**不绑定**而非绑定后恒失败（省一次 LLM 工具循环往返）。

### 6. 时区/交易日判定（离线够用吗）

- 现状：`get_last_business_day`（`utils/time_helper.py`）只跳周末、**无节假日日历**；`market_time.is_trading_time` 对节假日保守判"非交易时段"（休市行情不变 → 用缓存正确）。
- **离线场景：够用，且应改用数据驱动的交易日。** 离线"最新交易日"不应由墙钟推算（节假日无日历时 `get_last_business_day` 会把 2026-10-01 国庆当工作日），而应取**数据末根 bar 的日期**——`latest_trading_day(stock)` 已实现且零网络，语义精确（2026-08-09 库中末根 bar = 2026-08-09 实际就是周五交易日，验证一致）。业绩侧同理：最新 `report_date` 字符串比较。
- 墙钟的作用离线时只剩"现在是交易时段吗"（展示用）——保守判定（节假日判休市）对离线快照语义**无伤害**（本来就无新数据）。
- 联网侧的节假日不精确**无实质危害**：节假日 `_history_gap` 多算出的缺口只导致每股票每天多一次抓取尝试，`add_datas` 按 `date > last_data_update` 去重后零写入。可选项：内嵌交易所年度休市安排（沪/深交易所每年发布）提升精确度，但按上面的分析**非必需**。

---

## External References

- 中上协 2026 年 6 月统计月报：境内上市公司 5,535 家（沪 2,314 / 深 2,898 / 北 323）— [中国证券网](https://www.cnstock.com/commonDetail/751275)、[新浪财经](https://finance.sina.com.cn/wm/2026-07-27/doc-inikfxaw8418341.shtml)、[Sxcoal（英文）](https://en.sxcoal.com/news/detail/2081907562876448769)；2 月口径 5,492 家 — [东方财富基金](https://fund.eastmoney.com/a/202603253683845929.html)
- DuckDB Dart/Flutter 客户端（iOS/Android 支持，官方 duckdbexplorer 双端示例）：[DuckDB Dart Client 文档](http://duckdb.org/docs/stable/clients/dart.html)、[dart_duckdb pub.dev](https://pub.dev/packages/dart_duckdb)
- SQLite 内建双平台（常识性事实，Apple/Android 平台文档）：[Apple SQLite](https://developer.apple.com/documentation/sqlite)、[Android SQLiteDatabase](https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase)

## Caveats

1. **ZODB 写放大 ~34x 为本仓库实测**（324 MB 库 / ~9.7 MB 现存对象），成因（PersistentList 整体 pickle + 从未 pack）已从源码确认（`ChinaStock.datas = PersistentList()` + 每日增量 commit）；但"全市场 ZODB 会到几十 GB"的推断是外推，未实测。
2. 同步耗时（串行 1.5-4 h / 并发 5-15 min）为估算：基于"单股 2-4 个请求、1-3 s/股"的假设，**未实测 pytdx 单股全量耗时**（本仓库 tdx_cache 只写不读，无现成测量点；且本环境东方财富端点不可达、TDX 可达性也未验证——见 data_source spec 注记）。
3. 平均 ~3,000 根/股为估算（600519 5,973 / 000001 9,384 / 300750 1,976 实测样本 + 中位上市时长推断）；全市场日K 0.9-1.1 GB 随之 ±30%。
4. **ZODB 在 iOS 嵌入式 Python（PythonKit/Pyto/BeeWare）上的 flock/沙盒行为未实测**——Darwin 的 fcntl 可用，但 iOS 沙盒与嵌入式解释器的具体行为需 Q2 研究联动验证；Android 侧 Termux 全兼容性高（完整 Linux）。
5. 前复权价格锚定同步日（同步后分红送转 → 快照历史价小幅偏差）为逻辑推断，未量化验证。
6. 北交所 323 只不在 TDX 数据源支持范围（`is_bj_ticker` 拦截），全市场 1 GB 估算实际为沪深 5,210 只。
7. 本文件只读遍历了 ZODB 库（无任何写入/commit，正常关闭释放 flock），未改动 `database/` 与 `data/` 任何文件。
