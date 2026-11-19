# 港股/美股 vs 沪深A股（CN）能力差距侦察报告

> 侦察方式：5 个并行子代理（CN 基线 / HK 全链路 / US 全链路 / 横切层 / 外部数据源），逐条 `file:line` 取证。
> 结论只保留可在代码中验证的部分；不可验证项列在各节 Unknowns。

---

## TL;DR — 按"错误程度×修复成本"排序的前 5 项

| # | 问题 | 严重度 | 证据 | 估算 |
|---|---|---|---|---|
| 1 | HK/US 日K **从未复权**：`adjclose` 与 `events` 请求了但从未读取 | 静默错数 | `src/yahoo/deviceYahooCollect.ts:143-176`、`:185`；全仓 `adjclose` 零命中 | ~30 min |
| 2 | HK/US 财务是**单季口径**，但提示词要求模型按"年度累计"再调整 | 静默错数 | `src/prompt.ts:7` vs `src/yahoo/composeYahooReports.ts:227-243` | ~1 h |
| 3 | `today` 对所有市场都用 `asiaToday()` | 静默错数 | `src/pipeline.ts:205,221`；`app/lib/analysisController.ts:612,622` | ~20 min |
| 4 | HK/US **无公告/财报原文源**（CN 有 TDX MCP + 亿信 + F10） | 数据缺口 | `src/pipeline.ts:268-272` | 3–6 h |
| 5 | HK/US 销售额毛利率永远 N/A，但数据其实已算出 | 展示缺口 | `src/chartData.ts:113-121` vs `src/yahoo/composeYahooReports.ts:147` | ~20 min |

---

## Tier 0 — 静默错数（最危险：模型拿到的数字是错的，不是缺失的）

### 0.1 HK/US K线未复权（最高优先级）

```
src/yahoo/deviceYahooCollect.ts:162-176  barsFromChart() 只读 indicators.quote[0].{open,high,low,close,volume}
src/yahoo/deviceYahooCollect.ts:185      请求了 &events=div%2Csplit  → 响应 r['events'] 无人解析
grep adjclose src/ test/                 → 0 命中
```
CN 侧有完整前复权：`src/adjust.ts:30-73` + `src/tdx/quoteClient.ts:113-140`（xdxr 事件驱动）。

两处注释与实现相反，必须一并修：
- `src/yahoo/yahooClient.ts:191` 注释「全量日K（复权）」
- `src/yahoo/applyYahooCollectedToStore.ts:34` 注释「close 已复权」

后果：除息缺口与拆股缺口直接进入 MA/EMA/MACD/RSI/BOLL/BIAS/ATR、60日涨幅、YTD、52周高低。
美股拆股（AAPL 4:1、NVDA 10:1）会让提示词里出现 `Change Percent: -75%` 这类假信号。

最小修复：在 `barsFromChart` 内读 `indicators.adjclose[0].adjclose`，与 `quote.close` 同索引替换；
缺失时回退原始 close 并打 warn（保持现有 `null` 语义，不伪造 0）。

### 0.2 「财务数据是累计口径」对 HK/US 是错的

```
src/prompt.ts:7   - 注意财务信息中是当年的累加后数据，需要对应调整
```
这句只对 CN F10 成立（`src/reports.ts:52-70` 就是为把累计变单季而写）。
HK/US 的块 1 财务行来自 Yahoo 季度报表，本来就是单季，QoQ 也已在 `composeYahooReports.ts:227-243` 算好。
模型被要求二次调整 → 数字被改坏。

修复：把该子句挪进 `marketPromptRules` 式的 CN 专属变体，或在 `market_rules` 里覆盖。

### 0.3 时区：所有市场的 `today` 都是北京时间

```
src/pipeline.ts:205,221          const today = deps.today ?? asiaToday()
app/lib/analysisController.ts:612,622  显式传 asiaToday()
src/gates.ts:12-20               marketToday(market) 已存在，却未被 pipeline 使用
```
影响 `lastBarIsToday`（当日量/换手率是否为盘中口径）与 `ytdBaseClose`（`src/overview.ts:48-70,110`）。
美股在北京时间上午跑分析时，纽约仍是前一交易日 → 差一天。

### 0.4 `pe_dynamic` 同名不同义

| 市场 | 取值 | 证据 |
|---|---|---|
| CN | F10「基本每股收益」推的前瞻 PE | `src/overview.ts:107-114` |
| HK/US | Yahoo `summaryDetail.trailingPE`（TTM） | `src/yahoo/composeYahooOverview.ts:204` |

同一个 `pe_dynamic` 键在 `DataScreen` 与提示词里并排出现，容易被模型横向比较。

### 0.5 CN 侧反向漏洞（顺带记录）

`marketSessionClosed` 只被 Yahoo 应用路径消费（`src/yahoo/applyYahooCollectedToStore.ts:100`），
CN/TDX 路径没有盘中守卫 → 盘中采集会把当天写进 `lastDataUpdate`，`dailyFresh` 随后跳过补采。
这就是 `src/gates.ts:32-40` 记的 P1-7 缺陷，HK/US 已修，CN 未修。

---

## Tier 1 — CN 有、HK/US 没有

| 能力 | CN | HK | US | 证据 |
|---|---|---|---|---|
| 公告 / 研报 / 全文 | 亿信 `announcement`/`report` + F10 + TDX MCP | ❌ 无 HKEXnews | ❌ 无 SEC EDGAR | `src/pipeline.ts:268-272`；`src/agents.ts:393-427` |
| 板块 / 资金流 / 概念 | TDX MCP「实时行情 资金流向 所属概念板块」 | ❌ 无南向资金/港股通 | ❌ 无 | `src/mcp.ts:249-271` 只对 `market==='cn'` 生效 |
| 公司资料结构化 | F10 财务分析 + 股本结构（仅 2 节） | Yahoo `assetProfile`（含行业/员工/业务摘要） | 同 HK，+Finnhub 行业 | `src/f10.ts`；`src/yahoo/composeYahooProfile.ts:96-127` |
| 分红/拆股事件 | xdxr 取了但只用于算复权，未落库未展示 | 请求了但未解析 | 同 HK | `src/tdx/xdxr.ts`；`deviceYahooCollect.ts:185` |
| 财务指标深度 | F10 盈利能力块 15 列 | 仅 净利/营收/ROE/EPS；`financialData` 模块取了只读 2 个键 | 同 HK | `src/pipeline.ts:189-194`；`composeYahooProfile.ts:119-124` |
| 财务期间数 | 全历史 | 季度模块仅 4 期，年报行比率恒 NaN | 同 HK | `composeYahooReports.ts:276-284` |

反过来，**HK/US 领先 CN 的部分**（避免"对齐"变成单向下调）：
券商目标价/评级/覆盖人数、EPS 一致预期、下一次财报日、内部人/机构持股比例、真实 5 分钟涨速、行业分类文本。
这些 CN 完全没有（`src/yahoo/composeYahooProfile.ts:84-126`）。

---

## Tier 2 — 两个市场都没有的（不是 HK/US 独有缺口）

1. **基准指数对比**：HSI / SPX / 沪深300 全仓零命中。“考虑近期整体市场风向”这句提示词没有任何数据支撑（`src/prompt.ts:43`）。
2. **交易日历**：`src/gates.ts:1-7` 自认“节假日日历未建模”。港股缺午休（12:00–13:00），美股把 16:00 当收盘（盘后到 20:00 未建模）。
3. **每手股数**：港股 board lot 100/500/1000/2000 全无记录 → 仓位与「价格×手数」计算对港股错误。
4. **汇率**：`market.ts:31,37` 只有货币标签，无 HKD/CNY、USD/CNY → 跨市场市值与仓位不可比。
5. **龙虎榜 / 融资融券 / 北向资金**：CN 也没有。

---

## Tier 3 — 管道与展示层

| 项 | 现状 | 证据 |
|---|---|---|
| 信息面分析师查询模板 | 四个中文模板 `{} 公告` / `{} 券商研报` / `{} 最新新闻` / `{} 最新市场讨论` 对所有市场无差别 | `src/agents.ts:281-287` |
| 联网搜索 locale | DuckDuckGo 硬编码 `kl=cn-zh` | `src/webSearch.ts:197,217` |
| HK/US 早期华尔街工具 | 无；HK/US 的 `跳空` 判断依赖上述未复权序列 | — |
| 毛利率图 | `chartData.ts:113-121` 只读 F10 → HK/US 恒 N/A | `app/screens/DataScreen.tsx:235` |
| 空状态文案 | HK/US 无数据时显示「该股 F10 财务分析无可用指标」 | `app/screens/DataScreen.tsx:228` |
| `recommendationTrend` | 每次请求都取，从不消费 | `deviceYahooCollect.ts:62` |
| Finnhub | 只读 `finnhubIndustry`，写进 `overview.industry` 但从不渲染 → 配 key 无可见效果；也没有开关位 | `src/finnhub/finnhubClient.ts:48-50`；`src/yahoo/webYahooCollect.ts:29-41` |
| US 点号代码 | `BRK.B` 未转 Yahoo 的 `BRK-B` → 404 | `src/market.ts:60,91` vs `deviceYahooCollect.ts:389-394` |
| 涨跌色 | 红涨绿跌对所有市场生效，美股应为绿涨 | `app/theme.ts:16-17`；`src/chartData.ts:23` |
| 测试 | CN 有 qfq 金样本、F10 fixture、live 集成测试；HK/US 无复权、无时区、无拆股用例 | `test/live.integration.test.ts` 仅 CN；`test/fixtures/f10_hk.txt` 实为 300750（CN 股） |

---

## 补齐缺口的外部源（按「成本→收益」排序）

| # | 源 | 覆盖 | 免费现实 | 关键 | closes which gap |
|---|---|---|---|---|---|
| 1 | Yahoo `indicators.adjclose`（已在响应里） | HK+US | 已在请求中，无需新依赖 | 无 | Tier 0.1 复权 |
| 2 | HKEXnews `titleSearchServlet.do`（keyless JSON） | HK | 全量索引 1999 起 | 无 | HK 公告/年报/中报/翌日披露 |
| 3 | SEC EDGAR `data.sec.gov` | US | 无限量；**必须带 User-Agent**，10 req/s | 无 | 10-K/10-Q XBRL、Form 4 内部人、13F |
| 4 | AkShare `stock_hk_daily(adjust="hfq-factor")`（新浪源） | HK | 免 key；东财 `push2*` 可能拒连 | 无 | 独立 HK K线+后复权因子，作为 Yahoo 兜底 |
| 5 | HKEX `ds_list_int.csv` + 每日卖空成交页 | HK | 免 key | 无 | HK 卖空额度、HKD/CNY/USD 柜台对照 |
| 6 | FINRA 双周卖空文件 | US | 免 key，2014 起存档 | 无 | US short interest（Yahoo 无对应字段） |
| 7 | EODHD / FMP / Twelve Data | HK+US | 20/250/800 次/日 | 需 | 唯一能把 HK 基本面收进单一 schema 的付费选项 |

### 已知会咬人的坑

- **HKEX 条款**：官网与 CCASS 明确禁止「programmatic, scripted or other mechanical means」抓取，且禁止再分发与建衍生库。
  抓取在技术上可行，但只能内部使用；对外展示必须买 HKEX Data Marketplace。
- **东财 HK 财务的 AMOUNT 已被固定汇率换算成人民币**，且没有币种列、没有公告日；
  `stock_financial_hk_analysis_indicator_em` 的 `CURRENCY` 字段对 USD/CNY 报表者也硬编码 `'HKD'`。
- **HK 无公告日字段** → 任何「最新期间」比率都会泄漏未来信息，回测必须隔离。
- **Yahoo 非官方接口**：无公布限流，`YFRateLimitError` 可连续数小时到数天。只能当缓存，不能当 system of record。

---

## 建议执行顺序

1. `barsFromChart` 读 `adjclose`（30 分钟，一次修好 5 个派生指标）
2. `pipeline` 用 `marketToday(market)` 替 `asiaToday()`（20 分钟）
3. `chartData` 毛利率回退到 `reports[].fields.sales_gross_margin`（20 分钟）
4. `prompt.ts:7` 移到 CN 专属规则（1 小时，含 golden test 更新）
5. HKEXnews + SEC EDGAR 采集器（各 3–4 小时，先做内部只读）

前 4 项合计约 2 小时，且全部可在现有测试基线下加回归用例；
第 5 项才引入新外部依赖与许可判定。

---

# 落地状态（2026-11-19 修复批次）

本批次按上表 1→4 执行，并补了「美股代码符号探测」与「/news-feed 门禁」。
全部改动均带回归用例，`npm test` 966 passed / 1 skipped，root + app `tsc --noEmit` 双绿。

## 已关闭

| # | 缺口 | 修复位置 | 取证 |
|---|---|---|---|
| 1 | **HK/US 日K 从未复权**（`adjclose` 请求了不读） | `src/adjust.ts` 新增 `qfqAdjustByAdjClose`；`src/yahoo/deviceYahooCollect.ts` `barsFromChart` 读 `indicators.adjclose[0]`、`fetchFullDailyBars` 入库前统一前复权 | 实测 0700.HK 5539 根、AAPL 11577 根；首根 close 已按累计分红缩放，末根 = 原始价 |
| 2 | **累计口径提示错发港美** | `src/prompt.ts` 新增 `ACCOUNTING_CONVENTION_NOTE` + `marketAccountingNote`；`src/agents.ts` `buildSystemText` 按市场替换；cn 原文逐字节不变 | `test/agents.test.ts` 新增「财务口径提示按市场替换」 |
| 3 | **`today` 恒北京时间** | `src/pipeline.ts:248` `marketToday(market)`；`app/lib/analysisController.ts` 两处显式 `today` 改 `marketToday(m)`；`app/screens/DataScreen.tsx` 同步 | cn 走 `marketToday('cn') === asiaToday()`，行为等价 |
| 4 | **毛利率/ROE 对港美恒 N/A 且无 UI 出口** | 港美 `grossProfit.raw===0` 视作空壳哨兵 → NaN（不再假 0）；`app/screens/DataScreen.tsx` 盈利能力 chips 对港美改读 `yahoo-profile:` 的 TTM `returnOnEquity/grossMargins/profitMargins`；概览行新增股息率/每股收益 | 0700.HK ROE 19.91%、毛利率 56.70%（实时） |
| 5 | **交收周期事实错误**（港股写 T+0、美股写 T+0） | `src/prompt.ts:marketPromptRules` → 港股 T+2、美股 T+1 | `test/prompt.test.ts` / `test/committee.test.ts` / `test/agents.test.ts` 同步钉住 |
| 6 | **US 点号代码 404** | `src/yahoo/deviceYahooCollect.ts` 新增 `usCandidates`（`BRK.B`⇄`BRK-B` 互探，去重后原输入优先） | `test/hk-us-parity.test.ts` |
| 7 | **报表保真度**：eps 恒 NaN、跨期假环比、同日季度/年度行冲突 | `src/yahoo/composeYahooReports.ts`：eps 回退 `dilutedEPS→basicEPS→netIncome/shares`；`periodKindOf` 期次自查（88~93 天=季度、175~190=半年、其余 NaN）；同日冲突由 `applyYahooCollectedToStore` 首行优先（季度胜，FY 行仅在无季度同日时生效）+ 文件头契约注明 | 实测 0700.HK eps 6.45/6.22/7.06 HKD、QoQ 1.07/4.24/1.25% |
| 8 | **`/news-feed` 绕过三道门**（Origin/Sec-Fetch-Site/token） | `app/lib/request-gate.cjs` `PROXY_PATHS` 补 `/news-feed` | `test/request-gate.test.ts` 新增 cross-site/token 双断言 |
| 9 | **DuckDuckGo 恒 cn-zh** | `src/webSearch.ts` `ddgRegionForMarket`（cn-zh/hk-tc/us-en）+ `makeWebSearchTool({region})`；`assembleTools(keys, caps, market)` 单点透传 | 默认地区仍返回 `ddgSearcher` 本体，`test/rn-env-keys`/`test/web-search` 身份断言不受影响 |
| 10 | **持久化层零港美夹具** | `test/store-file.test.ts` 新增 `0700.HK`（带点文件名）/ `AAPL`（大写）往返 + `yahoo-profile:` meta 隔离用例 | — |

## 仍然开着（数据源墙，不是代码问题）

| # | 缺口 | 为什么关不掉 | 需要的源 |
|---|---|---|---|
| A | **成交额 amount** | Yahoo chart meta / quoteSummary 均无成交额标准字段；现为 `volume × 最新价` 近似（`src/yahoo/composeYahooOverview.ts:139-141`） | 第二数据源（EODHD/FMP/Twelve Data） |
| B | **资金流 / 概念板块 / 南向资金** | 无免 key 源；Finnhub 无 flow 端点 | 付费源 或 HKEX 卖空 + 港股通明细 |
| C | **每期每股净资产 / 每股现金流 / 每期毛利率** | 2026-11-19 实测：Yahoo 季度与年度 **balanceSheet / cashflow 模块已退化为只剩 `endDate` 的空壳**（`totalStockholderEquity`/`operatingCashFlow` 均无），季度收入表也只有 `totalRevenue`+`netIncome`。不是对齐 bug，是源里没有 | SEC EDGAR XBRL（US）/ HKEXnews 摘要（HK） |
| D | **年度 FY 行在同日与季度行冲突时被丢弃** | store PK 是 `(ticker, report_date)`；HK Q4=12-31=FY，AAPL FY 末=Q4 末，同日期只能留一行。现策略：季度胜（保 QoQ 链完整），HK 丢 FY2025、AAPL 丢 FY2026 | 需 schema 增列（如 `period_kind`） |
| E | **每手股数（board lot）** | 港股 100/500/1000/2000 各异，Yahoo 无该字段；CN 的 `LOT_SIZE=100` 对港股不成立 | HKEX 证券名单 CSV |
| F | **HKD/CNY、USD/CNY 汇率** | 只有货币标签（`src/market.ts`），无换算 | 任意免费汇率源 |
| G | **公告 / 研报全文** | HK 无 HKEXnews 采集器、US 无 SEC EDGAR 采集器（且 HKEX 条款禁止程序化抓取再分发） | 见上表第 2/3 项，需先做许可判定 |

## 明确不做（避免单向"对齐"）

港美领先 CN 的能力不动：券商目标价/评级/覆盖人数、EPS 一致预期、下一次财报日、内部人/机构持股比例、
真实 5 分钟涨速、公司画像文本。CN 侧反缺盘中守卫（`marketSessionClosed` 只被港美路径消费）
与 52 周高低/股息率/EPS 概览键 —— 那是 CN 的缺口，不在本批次范围。

## E2E 验证记录（2026-11-19，本批次改动所在的构建）

| 通道 | 标的 | 结果 | 耗时 | 备注 |
|---|---|---|---|---|
| web（Chrome DevTools Protocol / headless） | 00700 → 0700.HK | **19/19 ✓** | 14s | 占位 LLM（无三键），采集/画像/新闻全真 |
| web（同上传） | AAPL → AAPL | **19/19 ✓** | 14s | 同上；`npm run e2e:web:us` |
| Android（模拟器 emulator-5554，重建 release APK） | 00700 → 0700.HK | **17/17 ✓** | 658.9s | 真 LLM；5537 根日K；0 FATAL |
| Android（同上） | AAPL → AAPL | **17/17 ✓** | 753.3s | 真 LLM；11577 根日K；0 FATAL |
| 单测 | — | 966 passed / 1 skipped | 3.7s | `npm test` |
| 类型 | — | 绿 | — | root + `app/` 双 `tsc --noEmit` |
| Node 探针 | 600036 / 00700 / AAPL | 通过 | — | `SOA_COLLECT_ONLY=1` |

E2E 脚本本轮补的覆盖（之前三个市场只有港股有 E2E，美股零覆盖）：

- `tools/web-e2e-hk.mjs`：由 `SOA_E2E_TICKER` 形状决定市场（数字→港股、字母→美股），
  新增 3 条断言：盈利能力 TTM chips / 毛利率+净利率 / 概览股息率+每股收益。
- `tools/android-e2e-hk.mjs`：同样参数化市场（`--ticker AAPL`）。
- 新增 npm scripts：`e2e:web:us`、`e2e:android:us`、`e2e:web:hk:llm`（带 `.env` 真 LLM）。

尚未 E2E 覆盖：`/news-feed` 的 token 加固（E2E 跑的是 loopback + 无 token 模式）、
港股/美股各自的软性边界（半日市、ADR、ETF）。
