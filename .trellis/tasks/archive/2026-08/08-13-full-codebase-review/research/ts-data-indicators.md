# ts-data-indicators 审查报告

审查范围：TS 数据/指标/TDX 客户端层（用户要求最仔细）。纯只读审查，未运行任何测试/工具。
对照基准：`.trellis/spec/ts/index.md`、`.trellis/spec/data_source/index.md`（+ tdx.md 移植补充）、
Python 侧 `tdx/adjust.py`、`tdx/f10_parser.py`、`tdx/overview.py`、`tdx/reports.py`、
`core/llms/tools/get_trend_indicators.py`、`core/llms/tools/extra_indicators.py`、
vendor `scripts/data_pipeline/indicators/*`、`data_structure/.../StockOverview.py`、
`StockPerformanceReport.py`、`core/llms/tools/web_search.py`、`utils/runtime_config.py`。

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|ts/src/indicators.ts|242|有发现（W1 关联；公式本体与 vendor/extra 一致）|
|ts/src/adjust.ts|73|有发现（I3；语义与 adjust.py 一致）|
|ts/src/overview.ts|129|有发现（W2 关联、W5）|
|ts/src/reports.ts|119|无发现（与 reports.py 语义一致，双词表为 spec 文档化超集）|
|ts/src/f10.ts|111|有发现（I1；与 f10_parser.py 同构）|
|ts/src/tdx/f10Client.ts|74|有发现（I2；协议布局与 pytdx 对齐）|
|ts/src/tdx/quoteClient.ts|102|有发现（W1、W2、W3、I6）|
|ts/src/tdx/xdxr.ts|87|无发现（响应/请求布局与 pytdx 对齐，有 live 探针背书）|
|ts/src/webSearch.ts|212|有发现（W4、I4、I5）|
|ts/src/webCollect.ts|69|有发现（W4、W2 关联）|
|ts/src/expo-file-system.d.ts|17|无发现（镜像 SDK 57 使用面；注释说明真实类型优先，删除即可）|

## 发现

### [WARNING] TS 生产链路未接入 qfq 前复权，指标/图表与 Python 侧数据口径分叉
- **位置**: ts/app/lib/proxies.cjs:80-84（`collectAll` 直传 raw bars）、ts/src/tdx/quoteClient.ts:91-101（`collectAll` 无复权步骤）、ts/src/pipeline.ts:118-121（`computeAll` 直接消费 store 中未复权 bars）
- **问题**: Python 数据链 `core/data_acquisition.py:160` 在落库前执行 `qfq_adjust(mapped, xdxr)`，ZODB 存的是**前复权**日K，`get_trend_indicators` 的 `compute_all` 在复权数据上计算。TS 侧 `qfqAdjust`（adjust.ts）已实现且有 live/qfq 测试，但**没有任何生产调用点**：web 采集经 `/tdx-collect`（proxies.cjs doCollect）→ `collectAll` → `fetchDailyBars` 返回裸未复权 bars → `applyCollectedToStore` 原样 `replaceDatas` 入 store；demo.json 亦为未复权 fixture（已实测 `demo.bars` 逐位 == `600036_daily.json` 的 `raw`，而非 `adjusted`）。结果：除权日（如 600036 2026-07-10 每10股派10.03元）跳空进入指标序列，`changePercentSeries`/RSI/MACD/KDJ/BOLL/MACD-VH 出现假信号，MA 窗口水平失真，LLM 拿到的指标数值与 Python 口径不一致。spec 明确写"输入 bars 需 qfq 后"（indicators.ts:2-4），调用方从未履行该约定。
- **证据**: `proxies.cjs:80` `const collected = await collectAll(...)`; `proxies.cjs:84` `bars: collected.bars`; `quoteClient.ts:101` `return { ticker, name, bars, snapshot, capital: null };`（无复权）；`pipeline.ts:118` `computeAll(bars.map(...))`；grep 全 ts/ 仅 `qfq.test.ts`/`live.integration.test.ts` 引用 `qfqAdjust`
- **建议**: 在 `collectAll` 或 `applyCollectedToStore` 前置接入 `qfqAdjust`（xdxr 事件需由 `getXdxrInfo` 拉取并转换为 `XdxrEventLike.tradeDate`，转换代码 live.integration.test.ts:57-63 已有先例）；或至少在调用方显式声明 unadjusted 约定并标注。
- **spec 对照**: 违反 data_source/tdx.md adjust.py 语义（Python 存储链 qfq 后落库）与 TS 移植补充的"指标同源"约定。

### [WARNING] fetchDailyBars 产出 YYYYMMDD，违反 store DailyBar 'YYYY-MM-DD' 升序契约，pipeline 路径 volume/amount 恒 NaN
- **位置**: ts/src/tdx/quoteClient.ts:37（`date: b.time.toISOString().slice(0, 10).replace(/-/g, '')`）↔ ts/src/store.ts:6（`date: string; // YYYY-MM-DD（升序契约）`）↔ ts/src/overview.ts:40-43、85-97 ↔ ts/src/gates.ts:5-12（`asiaToday()` 返回 `YYYY-MM-DD`）
- **问题**: store 契约（及 overview.test.ts:12-13 显式注释"fixture 日期为 YYYYMMDD（Python 导出），overview 契约 YYYY-MM-DD"并归一化）是 `YYYY-MM-DD`，但 TDX 采集路径（web：`/tdx-collect` → `collectAll` → `replaceDatas`；RN 探针同链）入库的是 `YYYYMMDD`。`buildStockInformation`（pipeline.ts:180）`today = deps.today ?? asiaToday()` 为 `YYYY-MM-DD`，与 `YYYYMMDD` bar 字符串比较永不相等 → `lastBarIsToday` 恒 false → 概览 `volume`/`amount`/`turnover_rate` 恒 NaN（overview.ts:85-97）。当前 `formatStockOutput` 不渲染这三字段、DataScreen（DataScreen.tsx:38）取末根 bar 自身日期做 today 自洽 → 无可见输出，属潜伏 bug；任何未来消费者按契约 `YYYY-MM-DD` 比较 bar 日期即静默失败。
- **证据**: `quoteClient.ts:37` `date: b.time.toISOString().slice(0, 10).replace(/-/g, '')`; `store.ts:6` `date: string; // YYYY-MM-DD（升序契约）`; `overview.ts:42` `return bars[bars.length - 1].date === today;`; `gates.ts:5-6` `/** 北京时间"今天" YYYY-MM-DD */`
- **建议**: `fetchDailyBars` 直接产出 `YYYY-MM-DD`（`toISOString().slice(0,10)` 不带 `replace`），与 store 契约/测试一致；或 store 层统一归一化。
- **spec 对照**: 偏离 data_source/tdx.md"日期双格式 fmtDate 幂等归一"（fmtDate 只解决展示，存储格式未统一）。

### [WARNING] 日K 日期经 toISOString（UTC）转换，UTC-9 以西时区日期错位 +1 天
- **位置**: ts/src/tdx/quoteClient.ts:37；node-tdx-market `dist/protocol/encoding.js:128`（`new Date(year, month - 1, day, 15, 0)` 本地时间构造）
- **问题**: vendor 用**本地时间** 15:00 构造 Date，`toISOString()` 转 UTC。本地偏移 ≥ -8h 时（UTC+8 中国为 15:00→07:00 同日）日期正确；偏移 -9（Alaska）/-10（Hawaii）等时区 15:00 本地 → 次日 00:00/01:00 UTC，所有 bar 日期 +1 天。日期错位直接破坏 `lastBarIsToday`、`ytdBaseClose` 年份窗口、日K 表/图表日期展示（fmtDate 只改格式不修正值）。中文用户主时区 UTC+8 不受影响，但项目运行环境不限定。
- **证据**: `quoteClient.ts:37` 同 W2；`encoding.js:128` `return new Date(year, month - 1, day, 15, 0);`
- **建议**: 用本地时区组件拼 `YYYY-MM-DD`（如 `Intl.DateTimeFormat('en-CA', { timeZone: ... })` 或手工 `getFullYear()/getMonth()+1/getDate()`），不经过 `toISOString`。
- **spec 对照**: 无明确 spec 条目，属移植正确性缺陷。

### [WARNING] webSearch/webCollect 全部 fetch 无超时/中止信号，RN/Node 直连路径可无限挂起
- **位置**: ts/src/webSearch.ts:47（Tavily）、:65（代理）、:140（vqd）、:154（news.js）、:171（html 端点）；ts/src/webCollect.ts:59-61（`collectViaProxy`）
- **问题**: 浏览器路径经同源代理（proxies.cjs 有 20s/45s 服务端超时兜底）问题不大；但 `defaultSearcher`（webSearch.ts:100-107）的 RN 真机/Node 直连分支（Tavily 或 `ddgSearcher`）与 `collectViaProxy` 的 fetch 均无 `AbortSignal`/超时——网络黑洞（无响应不关闭）时工具调用永久挂起，LLM 工具循环（toolLoop）卡死整条分析链。Python 侧 ddgs SDK 自带超时语义，移植时丢失。
- **证据**: `webSearch.ts:47` `const resp = await fetch('https://api.tavily.com/search', {`（无 signal）; `:140` `await _fetch(`https://duckduckgo.com/?q=...`)`（无 signal）; `webCollect.ts:59-61` `res = await fetch(`${base}/tdx-collect?ticker=...`)`（无 signal）
- **建议**: 统一用 `AbortSignal.timeout(20_000)`（或注入 timeout 参数）包装所有 fetch；与代理路径的服务端超时语义对齐。
- **spec 对照**: 违反 ts/index.md 同源代理"失败 → 明确报错、图不中断"的降级精神；任务验收点"错误处理、超时、密钥处理"未满足。

### [WARNING] composeOverview 输出键名与头部注释声明的 StockOverview 英文字段契约不符
- **位置**: ts/src/overview.ts:105-127 ↔ data_structure/chinese_mainland/StockOverview.py:8-30
- **问题**: overview.ts:2 声称"字段名用 StockOverview 英文字段（store.overview 契约）"，实际 4 个键与 Python `StockOverview` 字段名不符：`amount`≠`turnover`（成交额）、`open_`≠`open`（今开）、`prev_close`≠`previous_close`（昨收）、`change_percent_60d`≠`change_percent_60days`。当前消费方（DataScreen/pipeline formatStockOutput）与 composeOverview 自洽 → 无运行时错误；但一旦 overview 行按契约跨语言持久化（store.overview_json 对齐 ZODB overview）即静默错位，且"22 列与 StockOverview 字段序一致"的 spec 断言在 TS 侧不成立。
- **证据**: `overview.ts:110` `amount,`、`:116` `open_: open,`、`:117` `prev_close: prevClose,`、`:126` `change_percent_60d: changePercent60d,`；`StockOverview.py` 字段 `turnover`/`open`/`previous_close`/`change_percent_60days`
- **建议**: 输出键改为 StockOverview 字段名（`turnover`/`open`/`previous_close`/`change_percent_60days`），或修正注释与 store 契约定义；二选一，勿留双重真相。
- **spec 对照**: 偏离 data_source/tdx.md overview.py 22 列/字段契约（OVERVIEW_COLUMN_MAP 字段名承重）。

### [INFO] f10.ts toNum 与缺失 cell 的边界行为与 Python 不同
- **位置**: ts/src/f10.ts:24-35（toNum）、:83-96（parseSectionBlock 行值循环）
- **问题**: ① `'亿'`/`'万'` 后缀前缀为空（cell 恰为 `'亿'`）时 `Number('') = 0` → 返回 0，Python `float('')` 抛 ValueError → NaN；② metric 行 cell 数少于 periods 时（ragged 行），TS `cells[1+i]` 为 undefined → `toNum(undefined)` 产生 NaN 记录，Python `zip(periods, cells[1:1+len(periods)])` 截断不产生记录。极端场景下 NaN 记录可能覆盖 keep="last" 去重中同 (metric, period) 的有效值（表 1+表 2 合并时）。现实中单元格多为 `'—'`（非空，不被 splitPipeCells 剥离），触发概率低。
- **证据**: `f10.ts:31-33` `if (t.endsWith('亿')) { mult = 1e8; return Number(t.slice(0, -1)) * mult; }`；`f10.ts:91` `const raw = cells[1 + i];`；`f10_parser.py:50-52` 与 `:86-89` 对照
- **建议**: `Number('') → NaN` 显式守卫（`slice(0,-1) === '' → NaN`）；`cells[1+i] === undefined` 时跳过该 (metric, period) 对，对齐 zip 语义。

### [INFO] f10Client.parseContentResponse 缺 body 长度守卫，短响应抛 RangeError
- **位置**: ts/src/tdx/f10Client.ts:41-44
- **问题**: `body.readUInt16LE(10)` 在 body < 12 字节时抛 `ERR_OUT_OF_RANGE`。同类解析器均有守卫（`parseCategoryResponse:26` `body.length < 2`、xdxr.ts:12 `body.length < 11`）。上游 proxies.cjs doCollect 在 try/catch 内（转 502，可接受但错误信息晦涩），probe.mts 直接崩。
- **证据**: `f10Client.ts:42` `const length = body.readUInt16LE(10);`
- **建议**: 入口加 `if (body.length < 12) return '';`（对齐 parseCategoryResponse 风格）。

### [INFO] adjust.ts 缺 Python 'songgu' 旧键回退与 ratio_vol 跳过日志
- **位置**: ts/src/adjust.ts:44、:53-55 ↔ data_source/chinese_mainland/tdx/adjust.py:66、:87-94
- **问题**: Python `_num_or_zero(ev.get("songzhuangu", ev.get("songgu")))` 兼容旧字段名 `songgu`，TS `numOrZero(ev.songzhuangu)` 无回退——若消费方传入 Python 侧旧格式事件（含 `songgu` 键）则送转被静默当 0，复权因子错误。TS 自身 xdxr.ts 解析恒产 `songzhuangu`，当前无触发路径。另 Python 对 `ratio_vol <= 0` 有 `logger.warning`，TS 静默跳过，调试可观测性差。
- **证据**: `adjust.ts:44` `const songguPs = numOrZero(ev.songzhuangu) / 10;`；`adjust.py:66` `songgu_ps = _num_or_zero(ev.get("songzhuangu", ev.get("songgu"))) / 10`
- **建议**: `XdxrEventLike` 增加 `songgu?: number | null` 回退；ratio_vol 跳过时输出 warning。

### [INFO] webSearch envDisabled 大小写语义与 Python 分叉，缺 WEB_SEARCH_ENABLED 覆盖层
- **位置**: ts/src/webSearch.ts:18-23（envDisabled）、:25-27（webSearchEnabled）
- **问题**: Python `env_disabled`（runtime_config.py:42-60）假值集 `""/"0"/"false"/"no"` **大小写敏感**（'FALSE' → disabled=True）；TS `v.toLowerCase()` 大小写不敏感（'FALSE' → disabled=False）——枚举值大写时两端行为相反。另 Python `web_search_enabled` 支持 `WEB_SEARCH_ENABLED` 覆盖层（runtime_bool），TS 未移植（当前 App 只写 WEB_SEARCH_DISABLED，无实际影响）。
- **证据**: `webSearch.ts:21-22` `return !['0', 'false', 'no'].includes(v.toLowerCase());`；`runtime_config.py:52` `return os.environ.get(name, "") not in _FALSEY_STRINGS`（注释：大小写敏感）
- **建议**: 移除 `toLowerCase()`（对齐 Python）；如需覆盖层补 `WEB_SEARCH_ENABLED`。

### [INFO] parseDdgHtml 标题/摘要按序配对，缺 snippet 的结果会使后续摘要错位
- **位置**: ts/src/webSearch.ts:116-133
- **问题**: titles 与 snippets 用两个独立正则分别收集后按索引配对；若某条结果有标题锚但无 `result__snippet` 锚（DDG html 页混合结果形态），其后所有结果的摘要整体前移错位。当前未实测触发，属解析健壮性隐患。
- **证据**: `webSearch.ts:128-132` `titles.map((t, i) => ({ ...t, snippet: snippets[i] ?? '' }))`
- **建议**: 以单锚（result 容器）为单位解析 title+snippet，或按 DOM 顺序单次遍历配对。

### [INFO] collectAll 的 capital 恒 null——接口字段死代码，RN 路径缺股本来源
- **位置**: ts/src/tdx/quoteClient.ts:91-101、ts/src/webCollect.ts:44-51
- **问题**: `CollectedData.capital` 在 `collectAll` 中恒 `null`（quoteClient.ts:101），web 路径股本走 F10「股本结构」文本（proxies.cjs:79 → webCollect.ts:50 `parseCapitalStructure`），RN 探针路径（probe.mts 用 collectAll）则永远拿不到股本 → 换手率 N/A。接口字段承诺与实际行为不符。
- **证据**: `quoteClient.ts:101` `return { ticker, name, bars, snapshot, capital: null };`
- **建议**: 从 `CollectedData` 移除 `capital` 字段（web 路径已独立走 F10 文本），或 RN 路径补齐股本来源，避免误导调用方。

## 指标公式对照结论（重点 1，逐项核实）

**一致（公式/参数/NaN 语义逐算子核对通过）**：
- MA/EMA：`rolling(n).mean()` / `ewm(span=n, adjust=False)`（alpha=2/(n+1)），前 n-1 根 NaN、ewm 从首个非 NaN 起算、中段 NaN 传前值——与 vendor `trend.py` 一致；
- MACD：DIF=EMA12−EMA26、DEA=EMA9(DIF)、MACD=(DIF−DEA)×2——一致；
- RSI：`diff`→gain/loss clip、`ewm(alpha=1/n)`、avg_loss=0 且非 NaN → 100、warmup NaN 保持——一致（含 `l===0` 与 `Number.isNaN(l)` 判定次序，等价 pandas `.mask`）；
- KDJ：rolling 9 高低、平窗 0/0 → NaN、`ewm(alpha=1/3)` 两次、J=3K−2D——一致；
- BOLL：`rolling(20).mean/std(ddof=0)`，MB NaN 时 UP/DN NaN——一致（rollingStd 无显式 NaN 检查但 NaN 自然传播，等价）；
- ATR：首根无前收 TR=high−low（Wilder 种子）、`ewm(alpha=1/14)`——一致；
- 量比：分母=shift(vol) 前 n 日均量、零分母 → NaN 不毒化——一致；
- VOL_MA/TURNOVER_RATE：`vol/shares`（shares 万股，pipeline.ts:120 `liutongguben/10_000` 与 spec"量手/万股=%"吻合）——一致；
- MACD-VH：ATR 窗口=26（≠展示列 ATR14，注释已说明）、`atr>0` 守卫、SIGNAL=EMA9(MACD_V)、VH=MACD_V−SIGNAL——与 extra_indicators.py 一致；
- LIU_BIAS：`ln(close)−ln(EMA20)`——一致。
- 参数集与 vendor `DAILY_CONFIG` 完全一致：(5,10,20,60)/(6,12,24)/12,26,9/9,3,3/20,2/14/(5,10)/5。
- **前导 NaN 约定**：所有 warmup NaN 只出现在序列头部（rolling 前 n-1、ewm 首非 NaN 前、KDJ 平窗/RSI warmup），无中间断档；`computeAll` 输出 NaN→null（JSON 安全）——满足任务要求。
- 公式级验证：`indicators.test.ts` 以 Python 导出 fixture（600036_indicators.json，含 MACD_VH/LIU_BIAS 全部 34 列）逐格对比（null 位精确、数值 1e-6 相对容差）。

**分叉点（非公式，是输入口径）**：Python 生产链在 qfq 复权数据上计算（data_acquisition.py:160 → ZODB），TS 生产链在未复权 bars 上计算（见 W1）——公式等价但输入不同源，数值不可直接对齐。若修复 W1，全链指标与 Python 数值一致。

## spec 符合性结论

- 指标层：公式/参数/NaN 语义与 vendor+extra_indicators 同源一致（fixture 级验证）；**偏离**在输入数据未复权（W1）。
- 复权层：adjust.ts 与 adjust.py 语义逐项一致（事件降序、事件日前未复权收盘、因子先累乘后应用、每10股/10、denominator>0 守卫、缩股跳量、成交额不动、复权后重算振幅/涨跌幅/涨跌额）；微小偏离（INFO）：songgu 旧键、跳过日志。
- overview/reports：22 列/15 列数量、NaN 语义（量比/动量/5分钟 NaN、除零与分母≤0→NaN、60 日 bar>60、YTD 三分支、盘中 volume、QoQ 88~93 天相邻校验、负分母合法、sales_gross_margin NaN、industry ''、report_date %Y%m%d）与 Python 一致；偏离：4 个输出键名≠StockOverview 字段名（W5）、METRIC_COLUMNS 为 Python 超集（双词表，spec 文档化，符合）。
- F10：解析流程与 f10_parser.py 同构（多日期头子表并入、(metric,period) keep=last、('\n【' 块截断、亿/万归一、'-' 系映射 NaN）；TS 增双竖线探测/模糊分节定位/股本结构节，均为 spec 文档化刻意行为。
- TDX 客户端/xdxr：单位（价格/amount /1000、volume 手）经 live 测试快照-日K 同尺度断言与 fixture 数量级双重验证；category/content/Gbbq 请求与响应布局对齐 pytdx，有 live 探针背书。
- webSearch/webCollect：降级占位、env 开关、DDG cn-zh、摘要格式对齐 Python；偏离：无超时（W4）、env 大小写/覆盖层（I4）、snippet 配对（I5）。
- 统计：WARNING 5、INFO 6、无发现文件 3（reports.ts / xdxr.ts / expo-file-system.d.ts）。
