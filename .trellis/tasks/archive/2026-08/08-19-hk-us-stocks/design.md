# Design — 港股美股支持

## 架构

```
App.tsx / useAnalysis.start(input)
  → normalizeTicker(input) → {market: cn|hk|us, ticker}
  → 采集分派（collectorSelection：cn→TDX 链 / hk|us→Yahoo 链）
       web: server.mjs /yahoo-collect 代理（Node 侧 YahooClient + crumb）
       真机: deviceYahooCollect 直连（RN fetch + 手动 A3 cookie）
       Node 探针: YahooClient 直连
  → applyYahooCollectedToStore（store 无 schema 改动；ticker 键 = Yahoo 符号）
  → buildStockInformation(market)（5 块，块 3/4 market 分支）
  → committee（deps.market → AgentNode 提示词 {market_rules}/{market_cycle}）
  → 报告/采集数据 Tab（market 单位标签）
```

## 核心契约

- `Market = 'cn'|'hk'|'us'`；store/fetch ticker 键：CN 裸 6 位 / `0700.HK` / `AAPL`（格式天然无碰撞，零迁移）。
- `MarketCollector = (ticker, opts?) => Promise<WebCollectResult>`（`src/collector.ts:18`）——Yahoo 采集实现同形；失败抛错 → 调用方中止（与 CN 一致）。
- `DailyBar`：date `YYYY-MM-DD` 升序；volume = 原始股数（HK/US，非手）；close 已前复权（Yahoo chart 默认 split-adjusted + events 股息）。
- `PerformanceReport.report_date` `%Y%m%d`；fields 键复用 `REPORT_COLUMNS`；原币原始值（不做万元×10⁴）；QoQ 相邻期无 88-93 天门槛（港股半年报）。
- 错误：`YahooApiError`/`FinnhubApiError`（每源家族一自定义异常，BillionsApiError 先例）；degrade don't raise——crumb 失败 → 概览降级 + reports 空 + 分析继续；chart 失败 → 中止。
- Yahoo host 白名单：query1/query2.finance.yahoo.com、fc.yahoo.com（代理无 SSRF 面）。

## 子切片边界（文件所有权零重叠）

| 切片 | 文件 | 依赖 |
|---|---|---|
| S1 | src/market.ts(新)、src/gates.ts、test/market.test.ts、test/gates.test.ts | — |
| S2 | src/yahoo/yahooClient.ts、composeYahooOverview.ts、composeYahooReports.ts、src/finnhub/finnhubClient.ts、test/yahoo.test.ts、test/finnhub.test.ts | S1 |
| S3 | src/yahoo/webYahooCollect.ts、deviceYahooCollect.ts、applyYahooCollectedToStore.ts、app/lib/proxies.cjs、app/server.mjs、metro.config.js、app/lib/collectorSelection.ts、app/lib/runner.ts、app/lib/deviceBridge.ts、tools/probe.mts | S1+S2 |
| S4 | src/prompt.ts、src/agents.ts、src/committee.ts、src/events.ts、src/pipeline.ts | S1 |
| S5 | app/App.tsx、app/hooks/useAnalysis.ts、app/screens/DataScreen.tsx、src/chartData.ts、app/lib/settings.ts、settingsStore.ts、设置面板组件 | S1-S4 |

S3 禁止触碰 useAnalysis.ts（S5 专属）；S4 禁止触碰 collectorSelection/runner（S3 专属）。

## 兼容与回滚

- CN 缺省路径逐字节不变：`asiaToday()` 委托 `marketToday('cn')`；prompt cn 拼接与现文一致；`turnoverPct`/`formatStockOutput`/`financialTrendSeries` 缺省 market='cn' 输出不变。
- 每切片独立 commit；坏切片 `git revert` 单 commit 回滚，不阻塞其它切片。
- store schema 零改动 → 无数据迁移。
