# Python→TS 功能差距审计：数据源面（Slice 6）

- 审计日期：2026-08-14
- 审计人：Slice6DataSource（trellis-research subagent）
- 范围：`data_source/chinese_mainland/tdx/` 非 vendor 6 文件 + `data_source/chinese_mainland/billions/client.py` + `data_source/chinese_mainland/akshare/fetch_stcok_data.py`
- TS 对照面：`ts/src/tdx/`（quoteClient.ts、xdxr.ts、f10Client.ts）、`ts/src/billionsClient.ts`、`ts/src/adjust.ts`、`ts/src/f10.ts`；功能对应物 `ts/src/overview.ts`、`ts/src/reports.ts`、`ts/src/webCollect.ts`、`ts/src/store.ts`、`ts/app/lib/proxies.cjs`、`ts/app/App.tsx`
- 方法：逐文件 raw 全读 + grep 全仓库（含 ts/app、ts/test、ts/tools）找等价物；遵守 .trellis/spec/guides/index.md AI review 验证规则（信任边界/设计注释/变量误读三模式防假阳性）
- 本审计零业务代码改动

## ① 认领文件清单（逐文件已读）

### Python（全部 raw 全读）
| 文件 | 行数 | 状态 |
|---|---|---|
| data_source/chinese_mainland/tdx/tdx_source.py | 232 | ✅ raw 全读 |
| data_source/chinese_mainland/tdx/mapping.py | 97 | ✅ raw 全读 |
| data_source/chinese_mainland/tdx/overview.py | 278 | ✅ raw 全读 |
| data_source/chinese_mainland/tdx/reports.py | 199 | ✅ raw 全读 |
| data_source/chinese_mainland/tdx/f10_parser.py | 125 | ✅ raw 全读 |
| data_source/chinese_mainland/tdx/adjust.py | 105 | ✅ raw 全读 |
| data_source/chinese_mainland/billions/client.py | 210 | ✅ raw 全读 |
| data_source/chinese_mainland/akshare/fetch_stcok_data.py | 48 | ✅ raw 全读 |

辅助确认（非认领文件，用于核对消费契约）：`data_structure/chinese_mainland/StockOverview.py`（22 字段序）、`core/data_acquisition.py`（fetch_* 消费点、ensure_stock/acquire_historical_data_tdx 门）、`.trellis/spec/data_source/index.md`、`.trellis/spec/data_source/tdx.md`、`.trellis/spec/ts/index.md`、`.trellis/tasks/archive/2026-08/08-09-debt-cleanup/prd.md`（死代码记录）。

### TS（全部 raw 全读）
| 文件 | 状态 |
|---|---|
| ts/src/tdx/quoteClient.ts（145 行） | ✅ raw 全读 |
| ts/src/tdx/xdxr.ts（99 行） | ✅ raw 全读 |
| ts/src/tdx/f10Client.ts（68 行） | ✅ raw 全读 |
| ts/src/billionsClient.ts（231 行） | ✅ raw 全读 |
| ts/src/adjust.ts（112 行） | ✅ raw 全读 |
| ts/src/f10.ts（111 行） | ✅ raw 全读 |
| ts/src/overview.ts（123 行，overview.py 功能对应物） | ✅ raw 全读 |
| ts/src/reports.ts（121 行，reports.py 功能对应物） | ✅ raw 全读 |
| ts/src/webCollect.ts（68 行，采集接线） | ✅ raw 全读 |
| ts/src/store.ts（DailyBar/PerformanceReport 契约） | ✅ raw 全读 |
| ts/app/lib/proxies.cjs（/tdx-collect 代理，144-183 区段） | ✅ 区段读 |
| ts/app/App.tsx（北交所拦截 147-156） | ✅ 区段读 |

## ② 功能点差距表

> 状态：FULL（TS 等价且行为对齐）/ PARTIAL（有功能缺失或行为差异）/ MISSING（无等价物）/ BY_DESIGN（决策不做）。阻断：BLOCKER（删 Python 前必须补）/ NON_BLOCKER。

### 2.1 tdx_source.py（TdxSource 薄包装 + 名称索引 + 单例）

| # | Python 功能点 | Python 证据 | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| 1 | `ensure_vendor_on_path()` vendor sys.path 接缝 | tdx_source.py:25-28 | 无直接等价物（TS 直接依赖 npm `node-tdx-market`，quoteClient.ts:3） | FULL | 机制差异：Python 靠 sys.path 注入解析 vendor `scripts.*` 绝对导入；TS 靠包依赖直连，无此接缝需求。随 Python 删除。 | NON_BLOCKER |
| 2 | `DEFAULT_PARQUET_ROOT` 磁盘缓存根锚定 | tdx_source.py:40 | 无磁盘缓存（名称缓存走 store meta） | FULL | 差异：Python 有 parquet 缓存（vendor 只写不读 + `fetch_security_list` 当日快照读缓存，tdx_source.py:62-75 注释）；TS 恒网络拉取 + meta 缓存。功能输出等价，缓存是性能机制。 | NON_BLOCKER |
| 3 | `is_bj_ticker` 北交所 4/8 前缀拦截 | tdx_source.py:51-57 | App.tsx:153-156 六位校验 + BJ 拦截 | BY_DESIGN | 北交所明确不做（用户决策 08-13）。出处：.trellis/spec/ts/index.md「能力接线」节 + App.tsx:153-156 + PRD scope 注记。TS 拦截文案更完整（错误提示而非静默）。 | NON_BLOCKER |
| 4 | `TdxSource.__init__(parquet_root)` + `get_tdx_source()` 进程单例（双重检查锁） | tdx_source.py:77-79, 221-231 | 无单例；每次请求新建 TdxClient，proxies.cjs:160-161 构造、176-177 `finally` 断开 | FULL | 架构差异：Python 单例收敛连接/缓存树；TS 每请求单连接（W4 并发互斥），行为等价。 | NON_BLOCKER |
| 5 | `fetch_daily(ticker, max_bars=None)` 日K 全历史（自动翻页） | tdx_source.py:81-83 | `fetchDailyBars` quoteClient.ts:29-47（start 步进分页，count<800 停止，升序） | FULL | 差异：TS 恒全量（无 max_bars 参数）。Python 侧 max_bars 由 DataAcquisition 传（overview 250 / 历史 gap，core/data_acquisition.py:262,378）——TS 全量 bars 同样满足 overview 窗口（60 日前/年初）与历史全量回填，语义等价或更全。单位对齐：node-tdx-market 分→元(/1000)、厘→元(/1000)、volume 手（quoteClient.ts:37-46）。 | NON_BLOCKER |
| 6 | `fetch_minute(ticker, freq=5/15/30/60)` 分钟K线 | tdx_source.py:85-87 | 无（ts/src、ts/app、ts/tools 全 grep 无分钟K线代码） | MISSING | **Python 侧死代码**：全仓库无调用方（仅 vendor 内部 screener 用 `download_minute`）；08-09-debt-cleanup/prd.md:38 明确记录「`fetch_minute`/`fetch_index` 死代码」。TS 不需要该能力。 | NON_BLOCKER |
| 7 | `fetch_xdxr` 除权除息事件 | tdx_source.py:89-91 | `getXdxrInfo` xdxr.ts:75-89（Gbbq 命令，data 段=count+market+code 对齐 pytdx）+ `parseXdxrResponse` xdxr.ts:32-72（逐字节移植 pytdx GetXdXrInfo：category 1 读 fenhong/peigujia/songzhuangu/peigu，11/12 读 suogu，13/14 读 xingquanjia/fenshu）+ `toXdxrEventLike` xdxr.ts:92-99 | FULL | 字段/单位契约一致（每10股：fenhong/songzhuangu/peigu；peigujia 元/股）。TS 额外解析 category 名称表（xdxr.ts:16-30）。日期：Python DataFrame trade_date YYYYMMDD vs TS tradeDate YYYYMMDD。 | NON_BLOCKER |
| 8 | `fetch_finance_capital` 股本快照（liutongguben） | tdx_source.py:93-95 | `parseCapitalStructure` f10.ts:90-107（F10「股本结构」节文本，万股×10⁴→股） | FULL | 数据源不同（spec tdx.md「TS 移植补充」记录的**设计决策**：pytdx `get_finance_info` 命令在 node-tdx-market 所连服务器不响应→勿用，走 F10 股本结构节）。差异：Python 实时股本快照 vs TS F10 披露期股本（可能滞后于新股发行/增发）；TS 多鲁棒性（流通A股→实际流通A股回退、最新期缺值回退上一期、非正→null，f10.ts:95-106）。字段语义（总/流通股本，股）一致。 | NON_BLOCKER |
| 9 | `fetch_company_finance` F10 财务分析 tidy long | tdx_source.py:97-99 | proxies.cjs:164-165 `fetchF10Section(...,'财务分析')` 拉全文 → `parseFinanceIndicatorsAllTables` f10.ts:84-86 | FULL | 差异：Python 该路径是 vendor 解析 df（**丢季度表 2**，仅作回退）；TS 恒原文解析（含季度，等于 Python `build_reports` 首选路径）。TS 为超集。 | NON_BLOCKER |
| 10 | `fetch_company_finance_raw` 只读 raw 缓存文本（零网络） | tdx_source.py:101-131 | 无 parquet raw 缓存读；proxies.cjs 每次网络拉 F10 文本 | FULL | 差异：Python 读 `company_info_raw` parquet 缓存（可能陈旧，数据依赖 vendor 上次写入）；TS 恒网络恒新鲜。TS 生产路径 = Python 首选路径（raw 文本→解析器），无「vendor df 回退」（TS 无 vendor）。 | NON_BLOCKER |
| 11 | `fetch_security_list(market)` 全市场证券列表 + 当日快照读缓存 | tdx_source.py:133-162 | `getStockList`（quoteClient.ts:71-89 `fetchStockName` 内部，按 inferExchange 单交易所） | FULL | 差异：Python 当日快照 parquet 读缓存（省 ~2.1 万行/市场多页往返）+ 补 market 标签列；TS 每次 getStockList（单交易所）。名称索引缓存粒度不同（见 #14）。功能等价。 | NON_BLOCKER |
| 12 | `fetch_snapshot` 实时快照（不落盘） | tdx_source.py:164-166 | `fetchSnapshot` quoteClient.ts:51-67（getQuote 单票，失败/空→null） | FULL | 失败语义对齐：Python 返回空 df→overview 降级 NaN；TS null→价格回退日K末根（overview.ts:75-77）。单位：Python 元；TS 分→元(/1000)。 | NON_BLOCKER |
| 13 | `fetch_index(code, market)` 指数日K | tdx_source.py:168-170 | 无（ts 全 grep 无指数K线代码） | MISSING | **Python 侧死代码**：全仓库无调用方；08-09-debt-cleanup/prd.md:38 记录。TS 不需要该能力。 | NON_BLOCKER |
| 14 | `get_stock_name` + `_load_name_index` 名称索引（(market,code) 键、模块级缓存、失败回退 ticker） | tdx_source.py:175-218 | `fetchStockName` quoteClient.ts:71-89（getStockList + meta `name:${ticker}` 持久缓存，失败→null） | FULL | 失败回退等价：Python 返回 ticker 本身（name 永不 NaN）；TS 返回 null→调用方 `payload.name ?? payload.ticker`（webCollect.ts:29）。缓存：Python 进程内一次（两市场都成功才置 LOADED）；TS meta 持久化（跨会话），更优。同码冲突（'000001' SH指数/SZ股票）两侧都由市场推断区分（Python (market,code) 键；TS inferExchange 按交易所取列表），行为一致。 | NON_BLOCKER |

### 2.2 mapping.py（pytdx bars → akshare 12 列序）

| # | Python 功能点 | Python 证据 | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| 15 | `AKSHARE_HIST_COLUMNS` / `AKSHARE_HIST_COLUMN_MAP` 12 列契约（与 ChinaStockData 字段序 zip） | mapping.py:30-56 | 无 12 列 akshare schema；store `DailyBar` 6 字段（date/open/close/high/low/volume/amount，store.ts:5-13），派生指标列读时计算 | FULL | 架构差异：Python 存 12 列派生数据（振幅/涨跌幅/涨跌额/换手率落库）；TS 只存 raw bars，派生列由 `qfqAdjust`（adjust.ts:104-111）与 `computeAll`（indicators.ts，读时算）产出。能力等价，存储契约不同。 | NON_BLOCKER |
| 16 | `to_akshare_hist_schema(df, ticker, float_shares)` 字段映射 + 派生 | mapping.py:62-97 | `fetchDailyBars` 映射 quoteClient.ts:37-46 + qfqAdjust 重算 + indicators.ts | FULL | 逐字段对齐：日期（Python datetime.date 对象 vs TS 'YYYY-MM-DD' 字符串，均可字典序比较）；成交量 NaN→0/int64（mapping.py:82）vs node-tdx-market int；成交额元；振幅/涨跌幅/涨跌额 = prev_close 计算、首行 NaN（mapping.py:84-88）——TS 由 qfqAdjust/indicators 同公式产出；换手率 = vol×LOT_SIZE/float_shares×100、float_shares 缺省 NaN（mapping.py:91-95）vs TS `turnoverPct` volume×10⁴/liutongguben（pipeline.ts:38-41，缺股本 NaN）——公式等价（手×100股×100% = ×10⁴）。单位约定：手/元一致。 | NON_BLOCKER |

### 2.3 overview.py（按需单股概览）

| # | Python 功能点 | Python 证据 | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| 17 | `OVERVIEW_COLUMNS` / `OVERVIEW_COLUMN_MAP` 22 列契约 | overview.py:43-60 | `OverviewRow` overview.ts:64-66 | FULL | **字段命名不一致（需人工确认）**：Python StockOverview 字段名 turnover/open/previous_close/change_percent_60days（StockOverview.py:5-26）↔ TS 键 amount/open_/prev_close/change_percent_60d（overview.ts:97-115）。TS store overview_json 为自由 JSON + 消费方读 TS 键（DataScreen.tsx:59-64、pipeline.ts:51-58）自洽；但 overview.ts:1-2 头注释声称「字段名用 StockOverview 英文字段」与实际不符——若未来出现按 Python 字段名消费 overview 的共享方会断。22 个语义列全部存在、值语义对齐。 | NON_BLOCKER（附注需人工确认） |
| 18 | `compose_overview` 纯函数：22 列派生 | overview.py:167-228 | `composeOverview` overview.ts:69-123 | FULL | 逐项对齐：price 回退（snapshot→日K末根，overview.py:186-188 ↔ overview.ts:75-77）；昨收=倒数第二根（overview.py:99-103 ↔ overview.ts:78）；volume/amount 仅末根 bar 为当日时取值 `_last_bar_is_today`（overview.py:137-142 ↔ overview.ts:40-43）；振幅/涨跌幅/涨跌额 `_divide` 分母≤0→NaN（overview.py:83-89 ↔ overview.ts:23-27）；换手率 LOT_SIZE=100（overview.py:63-66 常量、209-210 计算 ↔ overview.ts:20,86）；PE/PB `_divide(price, eps/nwps)`；市值=price×股本；量比/涨速/5分钟涨跌恒 NaN（pytdx 无）；60日 `_close_n_bars_ago(daily,60)`=第 61 根前（overview.py:106-110 ↔ overview.ts:96-98 bars[len-61]）；YTD `_ytd_base_close` 三分支——跨年停牌→NaN/上年末最后一根/当年首根回退（overview.py:113-135 ↔ overview.ts:46-53）。`latest_period_value`：dropna(period) 后字典序 idxmax（overview.py:145-165 ↔ overview.ts:30-38，TS 不剔除 NaN period 行但 period 来自日期 cell 不可能 NaN，等价）。 | NON_BLOCKER |
| 19 | `build_overview`：逐源降级 + 无价格来源→None + FetchScope | overview.py:230-278 | 接线：pipeline.ts:189-197 composeOverview（deps.snapshot/capital/f10Text/bars）+ proxies.cjs:159-177 doCollect | PARTIAL | **错误语义差异（需人工确认）**：Python 逐源降级——snapshot/日K/股本/F10 各自失败→该源字段 NaN + warning（overview.py:230-241）；仅 snapshot 与日K 都失败才返回 None（overview.py:267-272）→ DataAcquisition ensure_stock 返回 False（core/data_acquisition.py:236-240）。TS 采集原子化——`collectAll` 内 fetchSnapshot/fetchStockName/fetchXdxrEvents 各自吞错降级（quoteClient.ts:51-67,71-89,94-101），但 `fetchDailyBars` 失败会抛出→doCollect 抛→proxies 5xx→`collectViaProxy` 抛错→浏览器**中止分析**（webCollect.ts:55 注释「失败抛错，调用方应中止分析」）。差异影响：Python 日K 失败仍能产出 snapshot 概览继续分析；TS 日K 失败整个分析中止（更保守的失败模型，属 TS 既有设计）。FetchScope（Python 复用共享拉取）在 TS 由单次 collect 全拉天然等价（proxies.cjs:164-167 一次连接取 F10+股本+collectAll）。 | NON_BLOCKER（TS 不需要「部分降级」能力；失败语义不同，phaseout 后行为以 TS 为准，建议在删除说明中记录） |

### 2.4 reports.py（按需单股业绩报告）

| # | Python 功能点 | Python 证据 | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| 20 | `REPORT_COLUMNS` 15 列契约（= StockPerformanceReport 字段序） | reports.py:46-53 | `REPORT_COLUMNS` reports.ts:8-16 | FULL | 15 列名/顺序完全一致（ticker,name,eps,…,report_date）。 | NON_BLOCKER |
| 21 | `METRIC_COLUMNS` 8 指标词表 | reports.py:55-65 | `METRIC_COLUMNS` reports.ts:19-38 | FULL | TS 为**超集**：Python 单词表（港澳资讯名：基本每股收益(元)/营业总收入(元)/…）；TS 双词表——港澳资讯 + 通达信（归母净利(未调整:万)/营业总收(未调整:万)/总营收同比增长率(%)，万元 ×10⁴→元 单位归一），spec tdx.md「TS 移植补充」记录。8 指标列顺序一致。 | NON_BLOCKER |
| 22 | `_qoq_series` 环比（相邻季度 88-93 天校验、首期 NaN、只防除零、负分母合法） | reports.py:67-83 | `qoqSeries` reports.ts:49-57 + `adjacentQuarterGap` reports.ts:42-45 | FULL | 语义对齐：88~93 天相邻校验；首期 NaN；prev=0→NaN；负分母合法（与 overview `_divide` 的「分母≤0→NaN」有意区分，两侧一致）。 | NON_BLOCKER |
| 23 | `compose_reports`：pivot 每期一行 + QoQ + 缺指标 NaN | reports.py:86-151 | `composeReports` reports.ts:61-121 | FULL | 差异：① 无可用指标：Python 返回 None（reports.py:136-141）vs TS 返回 []（reports.ts:78-80）——等价降级；② 指标命中率 <50% logger.warning（reports.py:107-112）→ **TS 无此告警**（缺 vendor 改名检测，NON_BLOCKER）；③ 同 (metric,period) 去重 keep-last 两侧一致（f10_parser.py:104-105 ↔ f10.ts:76-79）；period 内多词表映射同一字段时 TS first-wins（reports.ts:71-73，词表互斥时不可达）；④ sales_gross_margin 恒 NaN、industry 恒 ''、report_date 'YYYY-MM-DD'→'%Y%m%d'（reports.py:142-145 ↔ reports.ts:105-107,88）对齐。 | NON_BLOCKER |
| 24 | `build_reports`：raw 缓存首选 + vendor df 回退 + FetchScope | reports.py:153-199 | 接线：webCollect.ts:26-46 `applyCollectedToStore`（f10Text→parseFinanceIndicatorsAllTables→composeReports→addPerformanceReports） | FULL | 差异：① Python 双路径（fetch_company_finance_raw 首选 / vendor 解析 df 回退，reports.py:174-197）；TS 单路径（网络文本解析，无 vendor 回退）——TS 恒等于 Python 首选路径且无陈旧缓存风险；② FetchScope（_scope 透传复用）vs TS 单次 collect 全拉（proxies.cjs:164-167）等价去重；③ F10 失败语义对齐：Python None→调用方「无报告不算失败」（core/data_acquisition.py:291-293）vs TS f10Text 空→跳过 addPerformanceReports（webCollect.ts:36-44）。 | NON_BLOCKER |

### 2.5 f10_parser.py（F10 raw 文本解析，非 vendor）

| # | Python 功能点 | Python 证据 | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| 25 | `_to_num`：亿/万归一、空/'-'/'--'/'—'/'null'/不可解析→NaN | f10_parser.py:33-46 | `toNum` f10.ts:16-24 | FULL | 微差异（不可达边界）：值恰为「亿」（无数字前缀）时 TS `Number('')→0` vs Python `float('')→NaN`。 | NON_BLOCKER |
| 26 | `_split_pipe_cells`：U+FF5C 全角竖线切 cell | f10_parser.py:49-56 | `splitPipeCells` f10.ts:30-34 + `detectPipe` f10.ts:26-28 | FULL | TS 为超集：支持 U+FF5C（港澳资讯）+ U+2502（通达信）双分隔符探测。 | NON_BLOCKER |
| 27 | `_parse_section_block`：分节定位 + 日期头子表并入 + keep-last 去重 | f10_parser.py:59-107 | `parseSectionBlock` f10.ts:53-82 + `locateSection` f10.ts:40-51 | FULL | 核心语义对齐：日期头行（≥2 个日期 cell）→ 切换 periods 继续（不 break，季度表并入）；块在 `\n【` 截断；同 (metric,period) keep-last。TS 分节定位更鲁棒（精确匹配→模糊含匹配【1.主要财务指标】编号 + 独立标题行校验——只接受行内【 出现次数==1，防命中列表行），为超集。 | NON_BLOCKER |
| 28 | `parse_finance_indicators_all_tables` 主要财务指标 | f10_parser.py:110-116 | 同名 f10.ts:84-86 | FULL | 行为一致（fixture 级验证：test/f10.test.ts:9-25 与 Python 180 行逐字段 IDENTICAL 对照 + 通达信格式季度期存在）。 | NON_BLOCKER |
| 29 | `parse_indicator_section` 指定分节（盈利能力指标等） | f10_parser.py:119-125 | 同名 f10.ts:109-111 | FULL | 接线存在：Python 消费方 `get_financial_indicators` 工具（core/llms/tools/get_financial_indicators.py:34-37）；TS 消费方 pipeline.ts:150、DataScreen.tsx:25（'【盈利能力指标】'）——能力接线点存在。 | NON_BLOCKER |

### 2.6 adjust.py（qfq 前复权）

| # | Python 功能点 | Python 证据 | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| 30 | `_num_or_zero`：None/NaN→0.0 | adjust.py:35-44 | `numOrZero` adjust.ts:25-28 | FULL | 语义一致（NaN 不穿透因子）。 | NON_BLOCKER |
| 31 | `qfq_adjust`：事件新→旧遍历、因子先累乘后应用、prev_close 未复权快照、复权后重算振幅/涨跌幅/涨跌额、成交量舍回整手 | adjust.py:47-105 | `qfqAdjust` adjust.ts:30-112（逐字节移植，research/m0-d3-xdxr-qfq.md） | FULL | 算法逐项对齐：每10股单位÷10；denominator≤0/NaN→价格因子 1.0（adjust.py:74-78 ↔ adjust.ts:56-60）；`ratio_vol<=0`（缩股）跳过因子累乘但继续应用累积因子（adjust.py:87-98 ↔ adjust.ts:63-64）——**差异：Python 有 logger.warning（adjust.py:89-94），TS 无日志**（NON_BLOCKER）；复权后重算指标（adjust.py:101-104 ↔ adjust.ts:104-111）；成交量 round 回整手。微差异：pandas round 银行家舍入 vs Math.round 四舍五入（.5 边界极罕见，NON_BLOCKER）。日期比较：Python datetime vs TS YYYYMMDD 字符串（接线层 `applyQfq` quoteClient.ts:106-127 双向转换）。无事件→恒等变换（adjust.py:55-56 ↔ adjust.ts:31）。 | NON_BLOCKER |

### 2.7 billions/client.py（亿信 4 端点）

| # | Python 功能点 | Python 证据 | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| 32 | `BillionsApiError(message, code, status_code)` | client.py:40-54 | `BillionsApiError` billionsClient.ts:22-33 | FULL | 字段对齐（message/code/statusCode）；TS 多 `name='BillionsApiError'`。 | NON_BLOCKER |
| 33 | `BillionsClient.__init__(_http, _key)` + httpx 懒加载 + env key | client.py:66-77 | 构造 billionsClient.ts:92-98（opts.fetch/apiKey/baseUrl）+ `hasApiKey` getter billionsClient.ts:100-102 | FULL | 注入点对齐（_http ↔ opts.fetch，house style 无 mock）；key：Python env `BILLIONS_API_KEY`（client.py:68）vs TS opts.apiKey ?? process.env（billionsClient.ts:94）；TS 多 baseUrl 注入 + hasApiKey 门控（超集）。 | NON_BLOCKER |
| 34 | `_post`：POST JSON + X-API-KEY + 失败归一化（网络/HTTP 非2xx/success:false/非JSON）、不重试 | client.py:80-120 | `_post` billionsClient.ts:110-163 | FULL | 逐项对齐：网络异常→statusCode=None；HTTP 非2xx→取 body error/code（client.py:103-110 ↔ billionsClient.ts:146-153）；2xx 但 `success is False`（上游超时语义）→归一化（client.py:111-118 ↔ billionsClient.ts:155-161）；非 JSON body→null 归一化；非 dict JSON→业务失败；不重试；X-API-KEY 头（client.py:84-86 ↔ billionsClient.ts:119-121）。超时实现：Python httpx timeout vs TS AbortSignal.timeout（等价的客户端超时）。 | NON_BLOCKER |
| 35 | `fin_db(query, data_sources)` 120s | client.py:122-133 | `finDb` billionsClient.ts:170-172 | FULL | payload（query + data_sources ?? 'auto'）、120s 超时（client.py:36 ↔ billionsClient.ts:84）对齐。 | NON_BLOCKER |
| 36 | `search(query, source, search_mode, count, time_range, timeout=None)` 档位超时 25/70/120 + **显式 timeout 覆写** | client.py:135-167 | `search` billionsClient.ts:182-198 | PARTIAL | **功能差异（微）**：Python 支持 per-call 显式 `timeout` 参数覆写（client.py:152-155）；TS `SearchOptions` 无 timeout 字段（billionsClient.ts:45-53），超时仅由 searchMode 档位决定（billionsClient.ts:196-199 `_MODE_TIMEOUTS[mode] ?? fast`）。其余对齐：source/search_mode/count/time_range payload、档位超时值（client.py:34 ↔ billionsClient.ts:83）、未知档位回退 fast。TS 消费方（billionsTools.ts）无显式超时需求。 | NON_BLOCKER |
| 37 | `twitter_search(query, search_mode, count)` | client.py:169-181 | `twitterSearch` billionsClient.ts:201-214 | FULL | payload/三档超时对齐。 | NON_BLOCKER |
| 38 | `fetch(url, doc_id, page, max_chars)` 90s | client.py:184-210 | `fetchDoc` billionsClient.ts:222-231 | FULL | 微差异（不可达边界）：Python `url is not None`（空串也进 payload）vs TS truthy 跳过空串（billionsClient.ts:224-225）——空串 url 上游必 422；page/maxChars 显式判空对齐。已知限制（report/expert doc_id 403 SOURCE_NOT_LICENSED）两侧 docstring 一致。90s 超时（client.py:37 ↔ billionsClient.ts:85）。 | NON_BLOCKER |

### 2.8 akshare/fetch_stcok_data.py（akshare 备用路径）

| # | Python 功能点 | Python 证据 | TS 等价物 | 状态 | 差距详情 | 阻断 |
|---|---|---|---|---|---|---|
| 39 | `fetch_shex_stocks` SH 实时行情（ak.stock_sh_a_spot_em） | fetch_stcok_data.py:12-14 | 无（TDX 链路替代） | BY_DESIGN | akshare 备用路径明确不做（用户决策 08-13）。出处：.trellis/spec/ts/index.md「能力接线」节「北交所/akshare：明确不支持（用户决策 08-13），App.tsx 入口拦截报错」+ PRD scope 注记「已知决策不做的功能：北交所、akshare 备用路径——审计中标注 BY_DESIGN」。 | NON_BLOCKER |
| 40 | `fetch_szex_stocks` SZ 实时行情 | fetch_stcok_data.py:17-19 | 无 | BY_DESIGN | 同 #39。 | NON_BLOCKER |
| 41 | `fetch_bjex_stocks` BJ 实时行情 | fetch_stcok_data.py:22-24 | 无（App.tsx:153-156 拦截 BJ） | BY_DESIGN | 北交所决策（#3 同源）。 | NON_BLOCKER |
| 42 | `fetch_stock_info` 个股信息（ak.stock_individual_info_em） | fetch_stcok_data.py:27-29 | 无 | BY_DESIGN | 同 #39。 | NON_BLOCKER |
| 43 | `_natural_day_window` + `fetch_stock_history` qfq 历史（ak.stock_zh_a_hist） | fetch_stcok_data.py:31-44 | TDX qfq 生产链替代（collectAll quoteClient.ts:133-145 + qfqAdjust） | BY_DESIGN | akshare 历史路径不做；TS 已用 TDX 日K + xdxr 前复权等价覆盖（qfq 生产接线存在，见 spec 符合性结论）。 | NON_BLOCKER |
| 44 | `fetch_performance_report(date)` 全市场业绩报表（ak.stock_yjbb_em） | fetch_stcok_data.py:46-48 | 无（按需单股 F10 报告链替代，webCollect.ts:26-46） | BY_DESIGN | 同 #39；TS 用按需单股业绩报告等价覆盖（reports.ts composeReports）。 | NON_BLOCKER |

## ③ MISSING + PARTIAL 汇总清单（移植/删除时照此逐条）

### MISSING（TS 无等价物）——均 NON_BLOCKER，无阻断项

| # | 功能点 | Python 证据 | 缺失说明 | 阻断 |
|---|---|---|---|---|
| M1 | `fetch_minute` 分钟K线（5/15/30/60） | tdx_source.py:85-87 | TS 无分钟K线代码（ts/src、ts/app、ts/tools 全 grep 无）；Python 侧为死代码（无调用方，08-09-debt-cleanup/prd.md:38 记录） | NON_BLOCKER（随 Python 删） |
| M2 | `fetch_index` 指数日K | tdx_source.py:168-170 | TS 无指数K线；Python 侧为死代码（08-09-debt-cleanup/prd.md:38） | NON_BLOCKER（随 Python 删） |

### PARTIAL（等价物存在但行为差异）

| # | 功能点 | Python 证据 | TS 证据 | 差异 | 阻断 |
|---|---|---|---|---|---|
| P1 | `build_overview` 逐源降级 | overview.py:230-241,267-272（单项失败→NaN，snapshot+日K 均失败→None） | proxies.cjs:159-177 + webCollect.ts:55（collectAll 内 snapshot/name/xdxr 吞错降级，但日K 失败→整体 5xx 中止） | 错误语义：Python 日K 失败仍可产出 snapshot 概览并继续分析；TS 日K 失败整个分析中止。TS 属既有设计（采集失败即中止，UX 更保守）——**需人工确认** phaseout 后是否接受此失败模型 | NON_BLOCKER |
| P2 | `search` 显式 timeout 覆写 | client.py:152-155（timeout=None→档位） | billionsClient.ts:45-53,182-198（无 per-call timeout） | 参数缺失：Python 支持调用方覆写超时；TS 仅档位决定。TS 消费方无此需求 | NON_BLOCKER |

### FULL 但建议 phaseout 时记录的附注差异（需人工确认项）

1. **overview 字段命名漂移**：TS 键 amount/open_/prev_close/change_percent_60d ↔ Python StockOverview turnover/open/previous_close/change_percent_60days（overview.ts:97-115 vs StockOverview.py:5-26）。TS 内部消费自洽（store overview_json 自由 JSON + DataScreen.tsx:59-64 / pipeline.ts:51-58 读 TS 键）；overview.ts:1-2 注释声称「用 StockOverview 英文字段」与实际不符——**需人工确认**（若未来有共享方按 Python 字段名消费 TS overview 会断；当前无）。
2. **reports 指标命中率告警缺失**：reports.py:107-112 命中率 <50% warning（vendor 改名检测）→ TS 无（reports.ts）。NON_BLOCKER。
3. **adjust 缩股 warning 缺失**：adjust.py:89-94 `ratio_vol<=0` 有 logger.warning → TS adjust.ts:63-64 无日志（行为相同）。NON_BLOCKER。
4. **成交量舍入模式**：pandas round（银行家舍入）vs Math.round（四舍五入），.5 边界极罕见。NON_BLOCKER。
5. **缓存机制差异**：Python parquet 只写不读 + security_list 当日快照读缓存（tdx_source.py:62-75,133-162）/ F10 raw 缓存读（tdx_source.py:101-131）vs TS 恒网络 + store meta 缓存。输出等价，TS 恒新鲜。
6. **股本来源差异**：pytdx finance_capital 实时快照 vs F10 股本结构披露期（spec tdx.md「TS 移植补充」记录的设计决策，f10.ts:90-107）。NON_BLOCKER。
7. **fetch_daily max_bars 未移植**：TS 恒全量（quoteClient.ts:29-47），Python max_bars 由 DataAcquisition 传（250/gap）。语义等价或更全。

## ④ spec 符合性结论（能力接线点核对）

对照 `.trellis/spec/ts/index.md`「能力接线」节 + `.trellis/spec/data_source/tdx.md`：

| 能力接线点（ts spec 声明） | 数据源面证据 | 结论 |
|---|---|---|
| 亿信：billionsClient.ts（REST 4 端点、POST+X-API-KEY、BillionsApiError、不重试、超时档位 fin_db 120s / search+twitter 25/70/120 / fetch 90s） | billionsClient.ts:22-231 全端点在位，超时/归一化/错误逐项对齐 Python client.py（本报告 2.7 节）；tools 层接线（billionsTools.ts）与 runner/App 接线不在本 slice，由 Slice4/5 核 | ✅ 存在 |
| qfq 前复权：quoteClient.ts collectAll 内 fetchXdxrEvents→applyQfq（失败降级 raw bars 不阻断）；日期契约 YYYY-MM-DD ↔ qfqAdjust 输入 YYYYMMDD 接线层双向转换 | quoteClient.ts:94-127,133-145；proxies.cjs:164-167 doCollect 生产接线 | ✅ 存在 |
| 北交所/akshare：明确不支持（用户决策 08-13），App.tsx 入口拦截报错 | App.tsx:153-156；本报告 2.8 节全部 BY_DESIGN | ✅ 符合（BY_DESIGN） |
| （data_source spec tdx.md「TS 移植补充」）F10 双词表 / 流通股本走 F10 股本结构节 / web 无原始 TCP 走 /tdx-collect 代理 / 日期双格式 | reports.ts:19-38 双词表+万元归一；f10.ts:90-107 parseCapitalStructure；proxies.cjs:159-177；quoteClient.ts:37-46 / applyQfq 双向转换 | ✅ 符合 |
| 概览/业绩构建的生产接线（非 ts spec 显式列出，但为能力完整性的接线点）：overview 22 列写入与业绩报告入库 | pipeline.ts:189-197（composeOverview）+ webCollect.ts:26-46（applyCollectedToStore：putStock/replaceDatas/f10 meta/addPerformanceReports） | ✅ 存在 |
| F10 分节解析消费（盈利能力指标 → 分析上下文） | pipeline.ts:150 + DataScreen.tsx:25 parseIndicatorSection('【盈利能力指标】')（对应 Python get_financial_indicators 工具） | ✅ 存在 |

**总体结论**：
- 数据源面 Python 功能点共 44 项（2.1-2.8 节），其中 **FULL 33 项、PARTIAL 2 项、MISSING 2 项、BY_DESIGN 7 项**；**0 项 BLOCKER**。
- 2 个 MISSING（fetch_minute/fetch_index）均为 Python 侧死代码（08-09-debt-cleanup/prd.md:38 记录），TS 不需要，可随 Python 一起删除。
- 2 个 PARTIAL 均 NON_BLOCKER：P1（overview 逐源降级 vs 采集原子化）是 TS 既有失败模型差异，需人工确认接受；P2（search 显式超时覆写缺失）TS 消费方无需求。
- 数据源面所有「能力接线点」在 TS 侧存在；phaseout 数据源面时无前置补齐项。
