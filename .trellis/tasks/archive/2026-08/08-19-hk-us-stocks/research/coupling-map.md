# A股耦合点清单（港美股扩展碰撞面）

来源：2026-08-19 三路 scout 报告汇总（ScoutTsSide / ScoutCoreAgentsUI / ScoutDataSourceLayer）。Python 业务代码已 phaseout（08-14），以下均为 TS 现行代码。

## 硬阻塞（ticker 格式 / 数据源）

- `app/hooks/useAnalysis.ts:206-214` — `/^\d{6}$/` + 北交所 4/8 前缀拦截；**唯一客户端校验点**（S5 改）。
- `app/lib/proxies.cjs:196-201` — `/tdx-collect` 服务端 6 位 gate（CN 路由保持；新 /yahoo-collect 自带校验，S3）。
- `src/tdx/quoteClient.ts` + `deviceCollect.ts` + `f10Client.ts` — TDX A股链（inferExchange SZ=0/SH=1、price/1000 厘→元、volume 手、GBK F10）；港美股不经过此链（S3 新增 Yahoo 链）。
- `src/mcp.ts:176-183,213-244` — TDX MCP `range:'AG'` A股情报；港美股跳过该块（S4）。

## 交易日历 / 时间

- `src/gates.ts:6-12` `asiaToday()` 硬编码 Asia/Shanghai — 全仓唯一"今天"来源（S1 加 marketToday）。
- `src/gates.ts:15-27` `getLastBusinessDay` 仅周末、无节假日日历（**沿用**——与 CN 一致，注释保留）。
- `src/gates.ts:29-41` `latestPastQuarterEnd` 硬编码 0331/0630/0930/1231 — 仅 CN F10 门用；港美股不启用 F10 门（S1 让 resolveSkipGates 的 hk/us 恒 skipF10=false）。

## 单位 / 货币 / 语义

- `src/overview.ts:23` `LOT_SIZE=100` 手→股；turnover=量×100/流通股本（港美股：volume/floatShares×100，S2 合成函数 + S4 turnoverPct market 分支）。
- `src/pipeline.ts:37-40,43-88` turnoverPct + formatStockOutput（'Volume: …lots'、元）；S4 market 分支。
- `src/reports.ts:19-39` METRIC_COLUMNS 中文 F10 指标表 + 万元×10⁴（港美股新映射复用 REPORT_COLUMNS 键、不做 ×10⁴）。
- `src/reports.ts:41-45` adjacentQuarterGap 88-93 天（港美股不用门槛，QoQ 相邻期直算）。
- `src/tdx/xdxr.ts:14-18` + `src/adjust.ts` — A股 qfq（分红/送转/配股）；港美股复权由 Yahoo chart 服务端完成（不移植）。
- `src/chartData.ts:92-95` 亿元/元标签（S5 market 参数）。
- `app/screens/DataScreen.tsx:118-123,135-136` 量(手) 万手显示（S5 量(股) 分支）。
- `src/reports.ts` + `src/tdx/xdxr.ts` CNY 元单位（港美股原币 HKD/USD）。

## 提示词

- `src/prompt.ts:41-42` investment_manager_message「考虑中国市场的特殊周期性」— 唯一硬编码市场假设（S4 market_cycle 占位）。
- `src/agents.ts:63,87` current_date = getLastBusinessDay(localToday())（S4 改 marketToday(market)）。

## 演示 / meta

- `src/metaKeys.ts:20` DEMO_TICKER='600036'；`app/data/demo.json` — 保持 CN，零改动。
- store 键：`src/store.ts` ticker TEXT PK 不透明（`0700.HK`/`AAPL` 直接可用，零迁移）。

## 中性（无需改）

- `src/committee.ts` ROLES/StateAnnotation — 结构市场无关（仅加 market 键，S4）。
- `src/indicators.ts` computeAll — OHLCV 输入市场无关。
- `src/events.ts` PipelineEvent 协议、`src/retry.ts`、`src/webSearch.ts`、`src/billionsTools.ts` — 市场无关。
- `app/lib/collectorSelection.ts` 平台选择 — 需扩展市场维度（S3）。
