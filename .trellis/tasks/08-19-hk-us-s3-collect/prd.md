# S3 Yahoo 采集链与代理 (hk-us-s3-collect)

## 目标

Yahoo 采集全链：`src/yahoo/applyYahooCollectedToStore.ts`、`src/yahoo/webYahooCollect.ts`、`src/yahoo/deviceYahooCollect.ts`（新）；`app/lib/proxies.cjs` 增 `/yahoo-collect` 路由；`app/server.mjs` + `metro.config.js` 双入口注册；`app/lib/collectorSelection.ts` 市场感知分派；`app/lib/runner.ts` `collectForWeb` market 参数；`app/lib/deviceBridge.ts` re-export 扩展；`tools/probe.mts` 市场分派 + `SOA_COLLECT_ONLY`。

## 契约（决策已定，照抄）

- `applyYahooCollectedToStore(store, payload)`（纯函数）：`putStock({ticker, name, overview, overviewLastUpdate, lastDataUpdate})`（overview 直存 overview 槽；overviewLastUpdate/lastDataUpdate = 市场本地今天 `marketToday(market)`）；`bars.length && replaceDatas`（skipDaily 空数组 guard 同 `src/webCollect.ts:51-53`）；`reports.length && addPerformanceReports`（PK 幂等）；返回 `{f10Text: null, snapshot, name, capital}`；不写 meta 文本键。
- payload：`{ ticker, name, bars: DailyBar[]（date %Y-%m-%d 升序、volume 原始股数、close 已复权）, snapshot: CollectedSnapshot（price/open/high/low/prevClose）, overview, reports, skipDaily? }`。
- `webYahooCollect.ts` `collectYahooViaProxy(ticker, base, opts)` → POST `${base}/yahoo-collect`（body `{ticker}` + skipDaily 查询参数）→ payload → applyYahooCollectedToStore → WebCollectResult。签名同 `collectViaProxy`（`src/webCollect.ts:78`）。
- `proxies.cjs` `handleYahooCollect(req, res, _collect = doYahooCollect)`：gate ticker `/^([A-Z0-9]{1,5}(\.HK)?|[A-Z][A-Z0-9.-]{0,9})$/i` 且 detectMarket ∈ {hk,us}，非法 400 `{error}`；HK 候选 `hkSymbolCandidates` 逐个 chart 试探（`chart.result` 存在即定符号；全败 502 `{error:'无法解析港股代码'}`）；chart `range=max&interval=1d&events=div%2Csplit` → DailyBar[]（`indicators.quote[0]`，时间戳→市场时区日期；volume 原样）→ quoteSummary 七模块 `price,summaryDetail,defaultKeyStatistics,financialData,incomeStatementHistoryQuarterly,balanceSheetHistoryQuarterly,cashflowStatementHistoryQuarterly`（crumb 失败 → warn + overview 仅 chart meta 可映射字段 + reports 空，不整体失败；chart 失败 → 抛 → 502 中止）→ `composeYahooOverview` + `composeYahooReports` → payload JSON。独立互斥 `collectingYahoo` + 45s 超时（对齐 `COLLECT_TIMEOUT_MS` 模式，锁 settle 才释放）。`module.exports` 增 `handleYahooCollect`；`server.mjs` 与 `metro.config.js` 注册 `/yahoo-collect` POST。
- `deviceYahooCollect.ts` `collectYahooForDevice(ticker, opts)`：RN fetch 直连，`YahooClient` 以 `cookieProvider` 注入（取 `response.headers.get('set-cookie')` 首 `A3=`；模块内小工具），复用同一合成/入库函数；Hermes 零新 shim。
- `collectorSelection.ts`：市场感知——`selectCollector(platform, market, …)`（保留旧签名 CN 语义委托，或新增函数并迁移调用方——**迁移调用方**，无兼容别名）：web 实现 `{cn: collectForWeb, hk: collectYahooViaProxy, us: collectYahooViaProxy}`；rn 动态 import 后 `{cn: 现有 collectForDevice, hk/us: collectYahooForDevice}`；`deviceBridge.ts` 静态 re-export `collectYahooForDevice`。注入面保持可 fake。
- `runner.ts` `collectForWeb(ticker, opts & {market?: Market})`：按 market 分派到对应 collector；`resolveSkipGates(…, market)`。CN 缺省逐字节不变。
- `probe.mts`：ticker 经 `detectMarket` 分派——cn 现有链路原样；hk/us 走 YahooClient 直连（chart 试探 + quoteSummary + 合成 + 入库）；新增 `SOA_COLLECT_ONLY=1`：仅采集入库，打印 `行情已入库(N 根日K)`/`业绩报告(M 行)`/`概览 22 键摘要`，写 `probe-output/report.json` `{ticker, bars, reports, overview}` 后退出（不要求 LLM 三键）。

## 依赖

S1 + S2（`src/market.ts`、`src/yahoo/*`、`src/finnhub/finnhubClient.ts` 已合并）。

## 文件所有权（本切片独占）

`src/yahoo/webYahooCollect.ts`、`src/yahoo/deviceYahooCollect.ts`、`src/yahoo/applyYahooCollectedToStore.ts`（新）、`app/lib/proxies.cjs`、`app/server.mjs`、`metro.config.js`、`app/lib/collectorSelection.ts`、`app/lib/runner.ts`、`app/lib/deviceBridge.ts`、`tools/probe.mts`。**禁止触碰 `app/hooks/useAnalysis.ts`（S5 专属）**。

## 验收

- `SOA_COLLECT_ONLY=1 node --experimental-transform-types tools/probe.mts 00700` → 日K≥500、报告≥8 行、概览含 `currency: HKD`；`AAPL` → USD、bars≥1000；`09988` → 落 `09988.HK`；`600036` 输出与改造前一致（CN 回归）。
- web 代理冒烟：`cd app && npx expo export --platform web && node server.mjs` 后 `curl -X POST localhost:8090/yahoo-collect -d '{"ticker":"0700.HK"}'` → 200 payload JSON；`{"ticker":"600036"}` → 400。
- `npm test`（collectorSelection/runner 相关既有用例）绿 + `npm run typecheck`。
- 若 Android 真机不可达：以 deviceYahooCollect 注入 fake fetch 单测代替并记录。
