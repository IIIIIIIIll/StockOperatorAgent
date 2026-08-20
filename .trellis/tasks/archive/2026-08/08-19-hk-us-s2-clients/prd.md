# S2 Yahoo/Finnhub 客户端与合成 (hk-us-s2-clients)

## 目标

新建 `src/yahoo/yahooClient.ts`（YahooApiError + chart + quoteSummary + ensureCrumb）、`src/yahoo/composeYahooOverview.ts`、`src/yahoo/composeYahooReports.ts`、`src/finnhub/finnhubClient.ts`（FinnhubApiError + companyProfile2）。全部纯 TS、fetch-only（零 node: 导入、进 metro 图安全）。

## 契约（决策已定，照抄）

- 形态对齐 `src/billionsClient.ts`：class per source / method per endpoint / 构造注入 fetchImpl（测试 fake）/ 唯一自定义异常 / 不重试。
- `YahooClient` 构造 `(fetchImpl?: typeof fetch)`；构造参数增 `cookieProvider?: () => string|null`（S3 的 RN 路径用，本切片声明并支持：非空时 crumb 请求用其返回值作 Cookie 头，不依赖 fetch 自动 cookie）。每请求 `User-Agent: Mozilla/5.0`。
- `chart(symbol, {range:'max', interval:'1d', events:'div,split'})` → 原始 chart JSON（免 crumb）。`quoteSummary(symbol, modules)` → 原始 JSON；`ensureCrumb()`：GET fc.yahoo.com 捕获 `A3=` cookie（fetchImpl 场景从 `Set-Cookie` 头解析；cookieProvider 场景用其值）→ GET query2.finance.yahoo.com/v1/test/getcrumb 带 Cookie → 内存缓存（实例字段）；401 → 刷新一次重试 → 再败抛 `YahooApiError('crumb', 401, …)`。
- host 白名单常量：`query1.finance.yahoo.com` / `query2.finance.yahoo.com` / `fc.yahoo.com`（仅 S3 代理需要，本切片导出 `YAHOO_HOSTS`）。
- `composeYahooOverview(meta, quoteSummaryResult)` → `{ overview: OverviewRow, capital: { zongguben, liutongguben } }`。键对齐 CN 22 键（`src/overview.ts`）：latest price=`meta.regularMarketPrice`、open/high/low/`prev_close`、涨跌幅（`regularMarketChangePercent`，缺→自算）、60 日涨跌幅（调用方传 bars 首末 close 或 NaN）、`pe`=summaryDetail.trailingPE、`pb`=priceToBook、市值=defaultKeyStatistics.marketCap、股息率=dividendYield、`eps`=trailingEps、52 周高低、量/额、换手率=volume/floatShares×100、`currency`。量比/涨速/5 分钟涨跌→NaN。`raw` 值形态 `.raw`；缺失 `{}`→NaN。`capital` 来自 defaultKeyStatistics.sharesOutstanding/floatShares。
- `composeYahooReports(modules, sharesOutstanding, industry?)` → `PerformanceReport[]`：`report_date`=endDate `%Y%m%d`；fields 键复用 `REPORT_COLUMNS`（`src/reports.ts:8-13`）：`eps`=dilutedEPS、`total_income`=totalRevenue（原币原始值，不做 ×10⁴，注释说明）、`net_profit`=netIncome、`net_worth_per_share`=equity/shares、`net_worth_return_rate`=NI/equity×100、`cash_flow_per_share`=operatingCashFlow/shares、`sales_gross_margin`=grossProfit/revenue×100、`industry`（传入或 ''）、`ticker`/`name`（调用方传入）；YoY=上年同季；QoQ=相邻期直算无门槛（注释说明与 reports.ts adjacentQuarterGap 分歧）；除零/缺失→NaN；无 quarterly 模块→`[]` 不抛。
- `FinnhubClient` 构造 `(apiKey: string|null, fetchImpl?)`；无 key → `companyProfile2` 返回 `null` 零网络。`companyProfile2(symbol)` → `https://finnhub.io/api/v1/stock/profile2?symbol=…&token=…` 原始 JSON（含 `finnhubIndustry`）。429 不重试抛 `FinnhubApiError`。

## 依赖

S1（`src/market.ts` 的 Market 类型——仅类型导入，不依赖其函数）。

## 文件所有权（本切片独占）

`src/yahoo/`（三个新文件）、`src/finnhub/`（一个新文件）、`test/yahoo.test.ts`(新)、`test/finnhub.test.ts`(新)。禁止触碰其它文件（采集链/代理/useAnalysis 属 S3/S5）。

## 验收

- `npm test -- test/yahoo.test.ts test/finnhub.test.ts` 全绿（fake fetch）：chart 解析（OHLCV/日期/volume/含 events）、quoteSummary 模块透传、crumb 流程（首取成功 / 401 刷新一次成功 / 两次失败抛 YahooApiError）、cookieProvider 分支、composeYahooOverview 映射表（含 NaN 语义、capital）、composeYahooReports（YoY/QoQ/半年报间隔/除零 NaN/industry/缺失模块空数组）、Finnhub 无 key null / 429 抛错。
- `npm run typecheck` 通过。
