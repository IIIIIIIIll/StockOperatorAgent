# 港股/美股数据链（hk-us-stocks，2026-08-20）

## 1. Scope / Trigger

港股与美股支持（任务 `08-19-hk-us-stocks`，S1-S5）：市场模型、Yahoo/Finnhub 数据源、采集链（web 代理/设备直连/Node 探针）、market 线程（提示词/管道/UI）。触发本 spec 原因：新增跨层契约（市场模型、store ticker 键、采集 payload、市场分支单位/货币）。

## 2. Signatures

```ts
// src/market.ts（S1）
type Market = 'cn' | 'hk' | 'us';
interface MarketInfo { market: Market; label: string; timeZone: string; currency: string; lotSize: number | null; promptRules: string; }
marketInfo(market: Market): MarketInfo;
detectMarket(input: string): Market | null;                    // cn: /^\d{6}$/ 非 4/8 开头; hk: /^\d{1,5}$/; us: /^[A-Za-z][A-Za-z0-9.-]{0,9}$/
hkSymbolCandidates(input: string): string[];                   // ≤4 位左补零; 5 位首 0 → [去一前导零 4 位, 原样]; 5 位非 0 首 → 原样。'09988'→['9988.HK','09988.HK']（实网 9988.HK 是阿里官方码）
normalizeTicker(input: string, market: Market): { market: Market; ticker: string } | null;  // 按所选市场强制校验(无自动识别);ticker = store/fetch 键
marketOfStoreTicker(ticker: string): Market | null;  // store 键反推市场(恢复场景)

// src/gates.ts（S1）
marketToday(market: Market): string;            // Intl timeZone: Shanghai/Hong_Kong/New_York
asiaToday(): string;                            // = marketToday('cn')，逐字节不变
resolveSkipGates(store, ticker, opts?, market = 'cn');  // hk/us 恒 skipF10=false

// src/yahoo/yahooClient.ts（S2）— YahooApiError(code, status_code, message)
new YahooClient(fetchImpl?: typeof fetch, cookieProvider?: () => string | null);
chart(symbol, opts?): Promise<unknown>;         // range=max&interval=1d&events=div%2Csplit; 免 crumb
quoteSummary(symbol, modules: string[]): Promise<unknown>;  // crumb: fc.yahoo.com A3 cookie → getcrumb; 401 刷新一次再败抛错
YAHOO_HOSTS = ['query1.finance.yahoo.com','query2.finance.yahoo.com','fc.yahoo.com'];
parseA3FromSetCookie(header: string | null): string | null;  // 单源

// src/yahoo/composeYahooOverview.ts（S2）
composeYahooOverview(meta, summary, opts?: { firstClose?: number; lastClose?: number })
  → { overview: OverviewRow; capital: { zongguben: number; liutongguben: number } };
// 27 键 = CN 22 键全覆盖 + dividend_yield/eps/week_52_high/week_52_low/currency；raw 取 .raw；缺失 {}→NaN

// src/yahoo/composeYahooReports.ts（S2）
composeYahooReports(modules, sharesOutstanding, opts?: { ticker?: string; name?: string; industry?: string })
  → PerformanceReport[];  // fields 键复用 REPORT_COLUMNS；原币原始值（不做 ×10⁴）；QoQ 相邻期无 88-93 天门槛；YoY 上年同季

// src/finnhub/finnhubClient.ts（S2）— FinnhubApiError；无 key → null 零网络
new FinnhubClient(apiKey: string | null, fetchImpl?: typeof fetch);
companyProfile2(symbol): Promise<unknown | null>;   // 仅 US；港股不调（覆盖不可验证）

// src/yahoo/applyYahooCollectedToStore.ts（S3）
applyYahooCollectedToStore(store, payload: YahooCollectedPayload, market): WebCollectResult;
// putStock(overview 直存 overview 槽) + replaceDatas(空数组 guard) + addPerformanceReports(PK 幂等)；f10Text 恒 null

// 采集分派（S3）
collectYahooViaProxy(ticker, base, opts?, finnhub?: { apiKey: string } | null): Promise<WebCollectResult>;
collectYahooForDevice(ticker, opts?, finnhub?): Promise<WebCollectResult>;
selectCollector(platform: 'web'|'rn', market: Market, webImpls: Record<Market, MarketCollector>, loadDeviceImpls);
```

## 3. Contracts

- **store/fetch ticker 键**：CN 裸 6 位（`600036`）/ 港股 Yahoo 符号（`0700.HK`、`9988.HK`）/ 美股大写（`AAPL`、`BRK.B`）。三格式无碰撞，store schema 零迁移。
- **市场选择**：UI 下拉三市场(沪深A股/港股/美股,默认沪深A股),无自动识别;normalizeTicker 按所选市场强制校验,格式不符 → null。
- **HK 代码解析**：输入 → `hkSymbolCandidates` 逐个 chart 试探（404/`chart.error` 视为未命中继续，其余失败中止）；全败 → `无法解析港股代码`。US 无候选直接采。
- **DailyBar**：date `YYYY-MM-DD` 升序；volume 原始股数（非手）；close 已前复权（Yahoo 服务端）；**10 年窗口 period1/period2 分页**（`range=max` 实测被降级为月K）。
- **crumb**：fc.yahoo.com 现回 HTTP 404 但仍带 `A3=` Set-Cookie → Node 侧预取 + cookieProvider 注入（`obtainA3`），RN 手动取 set-cookie；quoteSummary 401 → 刷新一次 → 再败降级（overview 仅 chart meta 字段、reports 空，**不整体失败**；chart 失败才中止）。
- **prevClose**：HK/US chart meta 无 previousClose（chartPreviousClose 是窗口前收盘不可用）→ 由 bars 推算（regularMarketTime 与末根同日 → 倒数第二根收盘）。
- **HK 财报模块**：quoteSummary 需 `incomeStatementHistory` + quarterly 三模块共 8 模块（HK 的「季度」在 `incomeStatementHistory` 键下且仅 4 期；三源按 report_date 合并去重）。
- **mcp 情报**：仅 cn 调用 makeMcpIntel；hk/us 输出占位 `（港股/美股暂无实时市场情报源，跳过）`。
- **块 1 概览**（hk/us）：以 store 概览槽为准（composeYahooOverview 27 键），**不得**用 CN composeOverview 重算（否则 PE/PB 恒 NaN）；槽缺失回退重算。
- **web 采集门**：hk/us 必须走 `collectForWeb` market 分派（内部 resolveSkipGates 同日跳过门），不得直连 collectYahooViaProxy 绕过。
- **单位/货币**：量(手) vs 量(股)（hk/us 体列 `/1e6` M 格式）；turnoverPct：cn `量×10⁴/股本`，hk/us `volume/liutongguben×100`；货币标签 `marketInfo(market).currency`（chartData：cn `亿元`/`元` 逐字节不变，hk `亿HKD`/`HKD`，us `亿USD`/`USD`）。
- **提示词**：`{market_cycle}` + `{market_rules}` 占位；cn 拼接逐字节不变（market_rules=''）。
- **Finnhub**：可选 `FINNHUB_API_KEY`（设置面板，localStorage，浏览器直连不代理，不落日志）；仅 US 合并 `finnhubIndustry` → overview.industry；失败 warn 忽略。

## 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| 非法 ticker（与所选市场格式不符） | normalizeTicker → null → 按市场定制的错误文案（cn/hk/us 各一），不发起分析 |
| CN 4/8 前缀 | 北交所文案（逐字保留），不发起 |
| HK 候选全 404 | 502 `{error:'无法解析港股代码'}`，分析中止 |
| chart 失败（网络/5xx） | 抛 → 502，分析中止（核心行情） |
| quoteSummary/crumb 失败 | warn + 概览降级（chart meta 字段）+ reports 空，**分析继续** |
| Finnhub 无 key | 零网络，industry 留空 |
| Finnhub 失败/429 | warn + 忽略（industry 留空） |
| 同日已采集（市场本地今天） | skipDaily → bars 空，保留既有日K/lastDataUpdate |
| 报告重叠期 | addPerformanceReports PK 幂等去重 |

## 5. Good/Base/Bad Cases

- Good：`00700` → `0700.HK` → 5476 根日K + 8 行报告 + currency=HKD；`AAPL` → 11514 根 + USD；`09988` → `9988.HK`（Alibaba）。
- Base：无 Finnhub key 的 AAPL 分析正常（industry 空）；crumb 失效时 K 线与分析仍全链。
- Bad：用 CN composeOverview 重算 hk/us 概览（PE/PB 恒 NaN）；hk/us 绕过同日门（每日重复全量拉取）；对 hk/us 调 TDX MCP（注定失败的空查询）。

## 6. Tests Required

- `test/market.test.ts`：detect/normalize 全表 + 候选序（含 `09988`→`9988.HK` 首候选）。
- `test/yahoo.test.ts`：URL/UA、crumb 401 刷新重试、cookieProvider、overview/reports 映射表（NaN/除零/半年报 QoQ/YoY/空模块/升序）。
- `test/yahoo-collect.test.ts`：全链入库、crumb 降级、候选试探序、重叠期 PK 去重、skipDaily 保数据、代理 400/CN 拒、`collectForWeb` us 同日门 + finnhub 合并、跨日全量零 finnhub 请求。
- `test/pipeline.test.ts`：hk 块 1 概览槽（PE/PB 实值 + 槽缺失回退 N/A）；`test/finnhub.test.ts`：无 key null/429。
- CN 逐字节回归：prompt fixtures、chartData `亿元`/`元`、DataScreen `量(手)`、北交所文案。

## 7. Wrong vs Correct

#### Wrong
```ts
// 「去前导零」误当去**全部**:5 位首 0 码会产生不存在的过短符号,
// App 取首候选全链失败(404)
hkSymbolCandidates('00988') // ✗ ['988.HK', '00988.HK'](去全部前导零;实网无 988.HK)
```
#### Correct
```ts
hkSymbolCandidates('09988') // → ['9988.HK', '09988.HK']（去**一**个前导零的 4 位形式先行,input.slice(1);实网佐证 9988.HK=阿里官方码）
hkSymbolCandidates('00700') // → ['0700.HK', '00700.HK']（同规则）
// 措辞要点:去**一** ≠ 去**全部**——'09988' 两法恰好同果易混淆;
// 分歧例 '00988':slice(1) → ['0988.HK', '00988.HK'],去全部 → '988'(与 §2、src/market.ts:78、market.test.ts:58-59 同源)
```

## Gotchas

> **Yahoo 实测漂移（2026-08-20）**：`range=max` 降级月K；fc.yahoo.com 404 但仍给 A3 cookie；HK chart meta 无 previousClose；HK「季度」财报在 `incomeStatementHistory` 键；无效符号可能非 2xx 404。全部已适配，改代码前先读 `src/yahoo/*` 现状与 `research/yahoo-api-verified.md`。
