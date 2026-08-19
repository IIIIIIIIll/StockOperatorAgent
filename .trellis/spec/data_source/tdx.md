---
description: TdxSource — vendor 快照、进程单例、overview/reports/f10_parser、adjust/mapping、TS 移植补充
---
# TdxSource（`data_source/chinese_mainland/tdx/`）

pytdx (通达信直连) 数据源，**全链路主数据源**（历史行情 + 个股概览 + 业绩
报告）；akshare 为备用路径（主流程不调用，原方法保留）。结构：

- `vendor/` — vendored [tdx_quant](https://github.com/henrylin99/tdx_quant)
  快照（55 文件，`VENDOR.md` 记录上游 commit）。`tdx_source.py` 模块级调用
  `ensure_vendor_on_path()` 把 vendor 根插入 `sys.path`（幂等），上游绝对导入
  `scripts.*` 原样可用。**不要直接改 vendor 代码**——更新走重拷流程。
- `tdx_source.py` — `TdxSource` 薄包装，方法级对应 `TdxDownloader`：
  `fetch_daily/minute/xdxr/finance_capital/company_finance/security_list/
  snapshot/index`，返回原始 DataFrame，不吞异常（非法代码抛 `ValueError`）。
  **`DEFAULT_PARQUET_ROOT` 锚定仓库根**（2026-08-02 修复：原
  `Path("data/tdx_cache")` 随 CWD 漂移——换目录缓存全失效，且 vendor 默认根
  `DEFAULT_DATA_ROOT = Path('data')` 同样相对 CWD，两者不一致会产生第二棵
  缓存树 `data/daily`；现为 `Path(__file__).resolve().parents[3] / "data/tdx_cache"`，
  本仓库所有 `TdxDownloader` 构造都显式传此值，vendor 默认根不再被使用）。
  **缓存真相（2026-08-02 实测声明）**：parquet 缓存**只写不读**——daily/xdxr
  等历史数据每次 fetch 都走网络（`write_by_symbol` 写覆盖、从不读回）；
  **唯一例外** `fetch_security_list` 当日快照：`security_list/market=<SZ|SH>/
  date=<YYYYMMDD>/data.parquet` 当日分区已存在 → 直接读回补 market 标签列
  （与 vendor 写后读回同一契约，列序/类型不变），不重拉全市场列表（~2.1 万
  行/市场多页往返的大头）；文件缺失/空/损坏 → 回退网络。
  **进程级单例（2026-08-09，08-09-tdx-singleton-and-transactions）**：
  `get_tdx_source()` 照 get_zodb_storage 模式（模块级缓存 + 双重检查锁）——
  生产链路全部消费点（DataAcquisition / overview / reports /
  get_financial_indicators）经单例获取，TdxDownloader 构造与 parquet_root
  只在单例内发生一次；`TdxSource()` 直接构造仍可用（测试/独立路径不受限）。
  概览/业绩构建入口已**双入口合一**：TdxSource 上的
  `build_overview`/`build_reports` facade 已删除（曾绕开 `_scope` 穿线），
  唯一入口是模块函数 `overview.build_overview(ticker, _scope=None) ->
  pd.DataFrame | None` 与 `reports.build_reports(ticker, _scope=None) ->
  pd.DataFrame | None`（grep 无 `TdxSource().build_*` 调用）。名称索引模块级缓存
  `_NAME_INDEX: dict[tuple[int, str], str]`（**(market, code)** 键——SH 列表
  含指数代码，纯 code 键会撞车；market 由 `infer_hq_market` 推断），失败回退
  ticker 本身（name 永不 NaN）。**2026-08-02 修复**：`_NAME_INDEX_LOADED`
  仅两市场都成功才置 True——任一市场失败保持未加载，下次 `get_stock_name`
  重试（不固化部分索引）。模块函数 `is_bj_ticker(ticker)`（4/8 前缀）供
  入口处拦截北交所代码（TDX 全链路不可用）。
- `overview.py` — `compose_overview(...)` 纯函数 + `build_overview`：输出**恰
  22 列**（含代码列），列名即 `OVERVIEW_COLUMNS`，消费者命名构造
  `StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)`（08-09——
  与 akshare spot_em 路径共用同一 map：akshare 23 列含序号，序号列不在 map
  内被天然忽略，无需 `[1:]` 切片）。PE/PB/市值/涨跌幅/60日/ytd 均由
  snapshot/F10/股本/日K 派生；量比/5分钟/动量 = NaN（pytdx 无）。逐源降级：
  单项失败 → 该源字段 NaN + `logger.warning`；snapshot 与日K 均无价格来源 →
  None。日K 窗口 `max_bars=250`（覆盖 60 日前 + 年初窗口）。
  **2026-08-02 修复**：YTD 基准 `_ytd_base_close(daily, today)`——窗口含
  上年末 bar → 用上年最后一根收盘（年初首日不把当日自身当基准，YTD 不漏
  首日）；末根 bar 年份 ≠ 当年（跨年停牌）→ YTD NaN；无上年 bar → 回退当年
  首根。`latest_period_value` 先 `dropna(subset=["period"])` 再 idxmax——
  NaN period 的 astype(str)='nan' 字典序最大，会掩盖真实最新期。`today`
  默认 `asia_today()`（北京时间）。
- `reports.py` — `compose_reports(...)` 纯函数 + `build_reports`：F10 tidy
  long（metric/period/value_num）→ pivot 每期一行，输出**恰 15 列**，
  列名即英文字段名（= `StockPerformanceReport` 15 字段序，含 ticker），
  消费者命名构造 `StockPerformanceReport.from_row(row)`（恒等路径，
  08-09）。QoQ 环比
  (本期-上期)/上期×100：period 升序（ISO 字符串序）后计算、首期 NaN、只防
  除零（负分母合法——净利可为负，与 overview `_divide` 的"分母≤0→NaN"有意
  区分）。**2026-08-02 修复**：QoQ 相邻性校验（`_qoq_series` 按 period 索引
  转日期，间隔 ∈ [88,93] 天恰为一季度才算环比，缺报告期跨 2+ 季度 → NaN）；
  `industry` 输出空串 `""`（float NaN 写进 `StockPerformanceReport.industry:
  str` 污染类型契约；`sales_gross_margin` 保持 float64 NaN）；已知 8 指标
  命中率 < 50% → `logger.warning`（vendor metric 改名检测）。
  `report_date` 输出 '%Y%m%d' 字符串。缺指标列用 `reindex` 补 NaN
  （`wide[list(...)]` 会 KeyError）。F10 失败/空 → None + `logger.warning`。
- **F10 两张子表 + 非 vendor 解析器（2026-08-02，08-02-fix-f10-quarterly-data）**：
  TDX F10「主要财务指标」页面有两张并列子表——表 1 只列"最新期 + 历年年报"
  （6 期），表 2 含季度（9 期，数值同口径累计值，是表 1 超集）。vendor 解析器
  （tdx_company_info.py）遇第二个日期头行 `break` 丢表 2——VENDOR.md 零改动
  约束下，非 vendor 层 `data_source/chinese_mainland/tdx/f10_parser.py` 的
  `parse_finance_indicators_all_tables(text)` 重实现：**全部日期头子表并入**
  （日期头行 ≥2 个日期 cell → 切换 periods 继续而非 break），(metric, period)
  去重（keep="last"），输出列 `metric/period/value_raw/value_num`（无 ts_code
  ——compose_reports 只消费三列），自实现 cell 切分/亿万归一/NaN 映射（不
  import vendor 内部函数）。`TdxSource.fetch_company_finance_raw(ticker)` 只读
  `company_info_raw` 缓存 text 列（缺/坏 → None 不 raise，**零网络**）。
  `build_reports` 双路径：首选 raw → f10_parser（含季度）→ compose_reports；
  raw 缺失/解析失败 → 回退 vendor 解析 df（现状 6 期，不阻断）。QoQ 在季度
  补齐后自然生效（相邻季 91 天 < 88-93 校验；跨年边界 12-31→03-31 同为相邻
  季也计算——行为新增）。overview 仍走 vendor 路径（只需最新期）。存量重灌：
  `scripts/backfill_f10_quarters.py`（有 raw 缓存的股票，零网络；**绕过
  freshness 门与 add_performance_reports 递增去重**——库中已有 20260331 会
  挡住季度期，脚本按 report_date 合并替换 PersistentList，幂等）。
- **按分节名解析 + 盈利能力指标（2026-08-02，08-02-f10-financial-indicator-sections）**：
  F10 财务分析页除【主要财务指标】外还有【盈利能力指标】【偿债能力指标】
  【发展能力指标】等分节（银行股另有资本充足/贷款五级分类等），全部从未
  解析。f10_parser 泛化：提取 `_parse_section_block(text, section_name)`
  核心（分节定位全串匹配 → 块截断 `\n【` → 日期头子表并入 → (metric, period)
  去重），`parse_finance_indicators_all_tables` 变薄包装（既有测试零改动），
  新增 `parse_indicator_section(text, section_name)`——各分节与【主要财务
  指标】同构（年报表+季度表、表头 `财务指标(%)`），复用逻辑零复制。
  `core/llms/tools/get_financial_indicators.py`：`get_financial_indicators(ticker)`
  → raw 缓存解析【盈利能力指标】节 → 最新报告期每指标一行
  `营业毛利率: 89.76%`（**只输出 value_num notna 的行**——F10 长指标名
  折行产生残缺名/无值行，N/A 行对 agent 是噪声）；raw 缺失/解析失败 →
  占位文本不 raise（同 get_trend_indicators 约定）。`build_stock_information`
  扩为四段：个股信息 → 技术指标 → **财务指标** → 实时情报（display 与
  make_investment_decision 共用组装点，一处改动两端生效）。银行股特有项
  （净息差/净利差/成本收入比）跟随解析不硬编码。UI 侧 data_markdown 加
  `【盈利能力指标（` marker 独立成节渲染。
- `mapping.py` — `to_akshare_hist_schema(df, ticker, float_shares=None)`：
  pytdx bars → akshare `stock_zh_a_hist` 12 列序（日期/股票代码/开盘/收盘/
  最高/最低/成交量/成交额/振幅/涨跌幅/涨跌额/换手率），列名契约
  `AKSHARE_HIST_COLUMN_MAP`（字段名 → 列名，与 `AKSHARE_HIST_COLUMNS`
  同源 zip）供 `ChinaStockData.from_row(row, column_map=...)` 命名构造使用
  （08-09 替代位置构造）。
  日期列输出 **`datetime.date` 对象**（`add_data` 按 `data.date >
  last_data_update` 比较）；成交量单位与 akshare 一致（手）；首行无前收盘，
  振幅/涨跌幅/涨跌额 NaN。**2026-08-02 修复**：`vol` 先 `fillna(0)` 再
  `.astype("int64")`（NaN vol 直接 astype 抛 IntCastingNaNError，在
  `acquire_historical_data_tdx` 的 try 之外炸整条链）；换手率分支改
  `float_shares is not None`（0.0 显式传入 ≠ 未传，走计算路径而非静默 NaN）。
- `adjust.py` — `qfq_adjust(bars12col, xdxr)` 前复权，对齐 akshare `qfq`。
  实测约定：xdxr 的 `fenhong/songzhuangu/peigu` 是**每10股单位**（除 10），
  `peigujia` 为元/股；事件用事件日前最后一根未复权收盘算因子；先累乘因子再
  应用；复权后重算振幅/涨跌幅/涨跌额（除权跳空消除）。无事件 = 恒等变换。
  **2026-08-02 修复**：事件字段取值 `v if pd.notna(v) else 0.0`（
  `float('nan') or 0` 得 nan——nan 为 truthy，因子被污染 → 事件前 bar 价格/
  成交量全 NaN）；`ratio_vol <= 0`（如 10:1 缩股）→ 跳过成交量调整 +
  `logger.warning`（价格因子照算）；调整后成交量 `round().astype("int64")`
  舍回整手（小数手无意义 + 避免 int64 列原地乘小数因子的 FutureWarning——
  旧 NaN 污染把列静默变 float64 掩盖了该问题）。

新数据源仍遵循同一形状：class per source、method per endpoint、raw DataFrame
out；DataAcquisition 是唯一消费者。

## TS 移植补充（2026-08-10，web 端到端修复沉淀）

TS 侧移植本契约时的实测结论（Python 侧语义不变）：

- **F10 双词表**：真实 TDX 服务器（通达信格式）指标名与港澳资讯 fixture 不同——
  `归母净利(未调整:万)`/`营业总收(未调整:万)`/`总营收同比增长率(%)` vs
  `净利润(元)`/`营业总收入(元)`/`营业总收入增长率(%)`。`src/reports.ts`
  `METRIC_COLUMNS` 双词表 + 单位归一（万元 ×10⁴ → 元）。
- **流通股本来源**：pytdx `get_finance_info`（命令 0x000b）在 node-tdx-market
  所连服务器**不响应**（实测超时/断连）——勿用；走 F10「股本结构」节文本解析
  （`src/f10.ts parseCapitalStructure`，单位万股 ×10⁴ → 股）。换手率% =
  成交量(手)×10⁴/流通股本(股)，vendor `compute_all` shares 传**万股**（量手/万股
  = %）。
- **web 无原始 TCP**：浏览器跑不了 node-tdx-market——`server.mjs` 加同源
  `/tdx-collect` 代理（Node 侧采集回 JSON），与 `/llm-proxy` 同架构；RN 真机走
  react-native-tcp-socket（M0-D1）。
- **日期双格式**：TDX 采集日K 为 `YYYYMMDD`（无横线），展示/图表
  （lightweight-charts 业务日）需 `YYYY-MM-DD`——`src/format.ts fmtDate`
  幂等归一。

## 待办：日K 读缓存优化（2026-08-02 评估后未实现，理由存档）

prd 曾评估 `fetch_daily`/`fetch_xdxr` 按 symbol+max_bars+当日新鲜度读 parquet
缓存，结论**未实现**，原因：

1. **max_bars 无法从落盘文件复原**：vendor `write_by_symbol` 写
   `<root>/daily/ts_code=<...>/data.parquet` 且每次覆盖；同一 symbol 文件可能
   被 max_bars=None（全量回填）或 max_bars=1（增量）的调用轮流覆盖，文件内
   无 max_bars 记录 → 读缓存无法验证是否满足本次请求（须侧车 meta 文件，
   改动面大增且 vendor 写过的历史文件无 meta 一律 miss）。
2. **"当日新鲜"对日K语义错误**：日K 分析要求最新 bar（含今日盘中）。文件
   mtime 为当日 ≠ 数据新鲜——早间写入的部分 bar 在午后二次运行会被当新鲜
   数据读回，静默返回陈旧收盘价（分析错判）。日内正确性需"文件含今日 bar +
   非盘中"复合判断，超出 prd 简单门槛。
3. **实际流程收益≈0**：日K 250 根 < PAGE_SIZE 单页往返，成本可忽略；
   `acquire_historical_data_tdx` 的 max_bars=gap（增量 1 根）与 overview 的
   250 永不共享缓存条目 → 当日二次调用同参的场景实际不存在。真正成本大头
   （全市场证券列表）已通过 fetch_security_list 当日快照读缓存解决。

若未来要实现：读 key = (ts_code, max_bars, 文件含今日 bar)；写入侧车 meta
（max_bars + 末根 trade_date）；盘中新鲜度策略需另行定义。
