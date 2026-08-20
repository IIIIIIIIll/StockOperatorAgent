# S4 委员会提示词市场化 (hk-us-s4-prompts)

## 目标

market 线程贯穿提示词与管道：`src/prompt.ts` market_cycle 占位 + `marketPromptRules(market)`；`src/agents.ts` AgentNode market 参数；`src/committee.ts` deps.market + StateAnnotation.market；`src/events.ts` RunOptions.market + run() 接线；`src/pipeline.ts` market 分支（turnoverPct/formatStockOutput/trendIndicatorsText/yahooFinancialIndicatorsText/buildStockInformation）。

## 契约（决策已定，照抄）

- `prompt.ts`：`investment_manager_message` 第 42 行 `- 考虑中国市场的特殊周期性` → `- {market_cycle}`。新增导出 `marketPromptRules(market: Market): { market_cycle: string; market_rules: string }`：
  - cn：`market_cycle='考虑中国市场的特殊周期性'`（与现文逐字节一致）、`market_rules=''`。
  - hk：`market_cycle='考虑港股市场的特殊周期性（T+0 结算、无涨跌停限制、港币计价）'`；`market_rules='本次分析对象为港股。注意：港股实行 T+0 交收、无日涨跌幅限制、交易时段 9:30-12:00/13:00-16:00；财报以半年报+年报为主；报价货币为港币。'`
  - us：`market_cycle='考虑美股市场的特殊周期性（T+0 结算、无涨跌停限制、美元计价、盘前盘后交易与财报季效应）'`；`market_rules='本次分析对象为美股。注意：美股实行 T+0 交收、无日涨跌幅限制、存在盘前盘后交易；财报为季度制；报价货币为美元；注意拆股/合股与 ADR 对价格序列的影响。'`
- `agents.ts`：`system_prompt` 模板增 `{market_rules}` 占位（roleMessage 之后）；`AgentNode` 构造增末参 `market: Market = 'cn'`；构造与 `buildChain` 均 `.replace('{market_rules}', marketPromptRules(market).market_rules).replace('{current_date}', getLastBusinessDay(marketToday(market)))`（`localToday()` 不再用于 current_date 计算——检查并移除该函数若只剩此处使用；cn 缺省生成文本逐字节不变）。
- `committee.ts`：`CommitteeDeps` 增 `market?: Market`；role factory（`expert`/`trader`/`informationAnalyst` 包装器）透传 `deps?.market ?? 'cn'` 到 AgentNode 构造；`StateAnnotation` 增 `market: Annotation<string>()`。
- `events.ts`：`RunOptions` 增 `market?: Market`；`run()` 内 `const market = opts.market ?? 'cn'`：`buildStockInformation(ticker, {…, market})`、`makeInvestmentCommittee(config, updater, llm, opts.tools, { billionsClient: opts.billionsClient, market })`、`initial` 增 `market`。mcp：`market!=='cn'` 时不调用 makeMcpIntel（跳过注入，pipeline 占位兜底）。
- `pipeline.ts`：`PipelineDeps` 增 `market?: Market` 与 `reports?: PerformanceReport[]`（缺省从 store `getPerformanceReports(ticker)` 读）；`turnoverPct(b, capital, market='cn')`（cn `量×10⁴/股本` 不变；hk/us `volume/liutongguben×100`）；`formatStockOutput(…, market='cn')`：`量(手)` vs `量(股)`、`市场标签`/`币种` 行用 `marketInfo(market).label/currency`、换手率 market 分支；`trendIndicatorsText(bars, ticker, liutongguben?, market='cn')` 换手率同分支；新增 `yahooFinancialIndicatorsText(reports, ticker, market)`（最新报告行净利/营收/ROE/EPS，`{currency}` 单位，风格对齐 `financialIndicatorsText`）；`buildStockInformation`：块 1/2 market 分支、块 3 = cn `financialIndicatorsText(f10Text)` / hk-us `yahooFinancialIndicatorsText(reports)`、块 4 = cn 现逻辑 / hk-us 占位 `（港股/美股暂无实时市场情报源，跳过）`、块 5 亿信不变。

## 依赖

S1（`src/market.ts`）。不依赖 S2/S3（纯函数 + 类型）。

## 文件所有权（本切片独占）

`src/prompt.ts`、`src/agents.ts`、`src/committee.ts`、`src/events.ts`、`src/pipeline.ts`（+ 对应既有测试的增补用例，若需）。**禁止触碰 `app/lib/runner.ts`、`app/hooks/useAnalysis.ts`、`collectorSelection`（S3/S5 专属）**。注意 `runner.ts` 的 `makeBillionsIntel`/`makeMcpIntel`/`collectForWeb` 与本切片无关。

## 验收

- `npm test`（committee/agents/pipeline/events 相关用例，含 CN 提示词逐字节回归）绿 + `npm run typecheck`。
- CN 回归：`npm run probe -- 600036`（演示 LLM）报告输出与改造前一致。
- 新用例：`marketPromptRules` 三市场文案、AgentNode cn 缺省提示词与改造前逐字节相同、buildStockInformation hk 分支占位与 yahooFinancialIndicatorsText。
