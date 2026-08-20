# S5 UI 与设置集成 (hk-us-s5-ui)

## 目标

UI/设置层接入市场：`app/App.tsx` 输入改造 + 市场徽标；`app/hooks/useAnalysis.ts` start() 全量接线（normalizeTicker + market 贯穿）；`app/screens/DataScreen.tsx` 单位市场感知；`src/chartData.ts` 货币标签；`app/lib/settings.ts`/`settingsStore.ts` + 设置面板 `FINNHUB_API_KEY`；Finnhub profile 合并。

## 契约（决策已定，照抄）

- `App.tsx:89-98`：label `输入股票代码（沪深A股 / 港股 / 美股）`；`maxLength={10}`；删除 `keyboardType="number-pad"`；placeholder `600036 / 00700 / AAPL`。结果区（报告/采集数据标题）显示 `marketInfo(market).label` 徽标（market 来自 useAnalysis 状态）。
- `useAnalysis.ts` `start()`：
  - `const normalized = normalizeTicker(input)`；null → `setError('请输入有效的股票代码：沪深A股六位数字、港股一至五位数字、或美股字母代码')` 返回；CN 且 4/8 开头 → 保留现有北交所文案 `北交所(BJ)股票暂不支持分析:TDX 数据源不覆盖 BJ 证券,请使用沪深 A 股代码`（用 detectMarket 结果 + 前缀判断）。
  - 归一化 ticker + market 贯穿：`collectForWeb(ticker, { market, … })`、`buildStockInformation(ticker, { market, … })`（与 runner.run 内一致）、`runner.run(ticker, { market, … })`。
  - 状态（UseAnalysis 返回面）增 `market: Market` 供 UI/DataScreen 消费；`gateNotice` 等文案含市场名。
  - Finnhub：`market==='us' && settings.finnhubApiKey` 时构造 `FinnhubClient(key)`；采集后合并：web 走 `collectYahooViaProxy(…, finnhubApiKey?)` 内浏览器直连 `companyProfile2` → `payload.overview.industry`（失败 warn + 忽略）；设备链路同；无 key → 不调。
- `DataScreen.tsx:113-136`：表头 `量(手)`（cn）vs `量(股)`（hk/us）；体列 cn 保持 `(b.volume/10000).toFixed(1)}万`，hk/us `(b.volume/1e6).toFixed(2)}M`；`turnoverPct(b, capital, market)`；采集数据 header 显示 `marketInfo.label` + ticker。
- `chartData.ts:92-95`：`financialTrendSeries(reports, profit, market='cn')` → 标签 `净利润 (亿${currency})`、`每股收益 (${currency})`（cn 输出与现一致 `亿元`/`元`）；调用点（DataScreen）传 market。
- `settings.ts`：`SettingsState` 增 `finnhubApiKey: string`；保存白名单增键（掩码显示、不落日志——对齐 BILLIONS_API_KEY 模式）；`settingsStore.ts` 持久化同键；设置面板「模型与密钥」区增输入框 `Finnhub API Key（可选，美股增强）`（定位设置面板组件：`app/` 下消费 `settings.ts` 的面板文件）。

## 依赖

S1-S4 全部合并（market 模型、Yahoo 采集、pipeline market 分支、委员会接线）。

## 文件所有权（本切片独占）

`app/App.tsx`、`app/hooks/useAnalysis.ts`、`app/screens/DataScreen.tsx`、`src/chartData.ts`、`app/lib/settings.ts`、`app/lib/settingsStore.ts`、设置面板组件文件、`src/webCollect.ts`（若需扩展 collectYahooViaProxy 签名——**不扩展**：签名在 S3 已含 finnhubApiKey 可选参的归位，若 S3 未留该参则本切片在 webYahooCollect 补可选参）。禁止触碰 S1-S4 已交付文件的既有行为（仅本切片清单内文件）。

## 验收

- `npm test` + `npm run typecheck` 全绿。
- 浏览器 E2E（Phase 3 全量验证清单）：`00700`/`AAPL`/`09988` 分析全链（采集数据 Tab 量(股)、财务趋势图、市场徽标、`600036` 回归）；无 Finnhub key 时 `AAPL` industry 空不报错。
