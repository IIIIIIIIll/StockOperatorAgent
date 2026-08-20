# Yahoo Finance API 实测记录（2026-08-19，本环境验证）

## 端点与免 key 状态

| 端点 | 免 key/crumb | 用途 | 实测 |
|---|---|---|---|
| `GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=max&interval=1d&events=div%2Csplit` | ✅ 免 crumb | 全量日K（复权）+ meta + 分红/拆股事件 | `0700.HK`、`AAPL` 均 200，含 currency/HKT/EDT/gmtoffset/exchangeTimezoneName；`hasPrePostMarketData:true`（美股） |
| `GET https://fc.yahoo.com` | ✅ | 设置 A3 cookie | 200，Set-Cookie 含 `A3=…` |
| `GET https://query2.finance.yahoo.com/v1/test/getcrumb`（带 Cookie: A3=…） | crumb 值 | 取 crumb | 返回 12 位随机串 |
| `GET https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}?modules=…&crumb={crumb}`（带 Cookie） | crumb | 概览/财报 | `AAPL`/`0700.HK` 的 price、summaryDetail（PE/股息率）、defaultKeyStatistics（市值/股本）、financialData、incomeStatementHistoryQuarterly、balanceSheetHistoryQuarterly、cashflowStatementHistoryQuarterly 均 200 |
| `GET …/v7/finance/quote?symbols=` | ❌ 401 Unauthorized | — | 不可用，勿用 |

## 关键响应形状

- chart `result[0].meta`：`regularMarketPrice`、`previousClose`（结构里为 `chartPreviousClose` + `previousClose` 两种，实现需容错）、`currency`、`exchangeTimezoneName`、`regularMarketTime`（unix 秒）。
- chart `result[0].indicators.quote[0]`：`open/high/low/close/volume` 数组，对齐 `timestamp[]`（unix 秒）→ 日期 `%Y-%m-%d`（市场时区）。
- chart `result[0].events.dividends`：`{unixTs: {amount, date}}`；`events.splits` 同构。图表默认已对拆股调整（adjusted close），股息不调整价格（A股 qfq 语义差异，接受）。
- quoteSummary modules 值形态：`{raw: number, fmt: string}`，实现取 `.raw`；缺失字段为 `{}`。
- 季度财报 `incomeStatementHistoryQuarterly.incomeStatementStatements[]`：`endDate {raw: unix, fmt: YYYY-MM-DD}`、`totalRevenue`、`costOfRevenue`、`netIncome`、`dilutedEPS`、`grossProfit`；`balanceSheetHistoryQuarterly.balanceSheetStatements[]`：`totalStockholderEquity`；`cashflowStatementHistoryQuarterly.cashflowStatements[]`：`operatingCashFlow`。annual 版为 `incomeStatementHistory`（勿用——季度版是 `…Quarterly`）。
- 无效符号 chart 返回 `{"chart":{"error":{"code":"Not Found","description":"No data found..."}}}`（HTTP 200 + error JSON）——HK 候选试探以 `result` 存在与否判定。
- Yahoo 财报期为**公司财季**（AAPL 截至 9 月底），不齐 0331/0630/0930/1231——报告的 freshness 不得用日历季度末判定（本任务：全量拉取 + PK 幂等）。

## 港股符号归一

- 4 位零补：`0700.HK`（腾讯）；`9988.HK`（阿里，**实网 09988.HK/0988.HK/988.HK 均 404，官方 4 位码 9988.HK**）；`03690.HK`（美团，4 位 3690）。
- 候选序（`src/market.ts hkSymbolCandidates`）：输入 ≤4 位 → 左补零 4 位唯一；5 位且首 0 → **去全部前导零 4 位优先**、5 位原样兜底（`00700`→[`0700.HK`,`00700.HK`]；`09988`→[`9988.HK`,`09988.HK`]）；5 位非 0 首 → 原样。
- 美股：`AAPL`；带点 `BRK.B`、带横 `BF-B` 均合法（Yahoo 原样）。

## Finnhub

- `GET https://finnhub.io/api/v1/stock/profile2?symbol=AAPL&token=…`：无 key 返回 `{"error":"Please use an API key."}`（401 语义）；API 可达。finnhubIndustry 字段名：`finnhubIndustry`。
- `https://docs.finnhub.io` 本环境不可达（覆盖范围未验证——港股设计为不依赖 Finnhub）。
- npm 包 `finnhub` 存在（社区 JS 客户端）——**不采用**，仓库惯例为薄 REST 包装（BillionsClient 模式），避免新依赖。
