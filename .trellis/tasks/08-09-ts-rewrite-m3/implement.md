# M3 执行计划：端到端 + Expo App

工程：`ts/`（仓库内）。先 `npm i @langchain/openai`，再建 `ts/app`（Expo）。

## 步骤 1 — 读移植源

- `core/stock_info.py`：build_stock_information 数据链（上下文组装顺序/文本形状）
- `core/llms/__init__.py`：LLM 工厂 + 三键门控语义
- `core/progress.py`：事件形状（progress/report/error/done）
- `core/investment_committee.py`：run 入口（ticker → 报告对象形状）

## 步骤 2 — src/llm.ts（R1/AC1）

- `createLlmFromEnv()`：读 `LLM_API_KEY/LLM_MODEL/LLM_BASE_URL`；缺任一 →
  抛 `MissingLlmConfigError`（点名缺失键）；齐 → ChatOpenAI
  (`{ apiKey, model, configuration: { baseURL } }`)，temperature 对齐 Python。
- `test/llm.test.ts`：环境变量注入测试（不真连网——仅构造与门控）。

## 步骤 3 — src/pipeline.ts（R2/AC2）

- `buildStockInformation(ticker, ctx)`：对齐 Python 块序——
  概览块 → 日K尾部块（含复权/除权标注）→ 指标块（compute_all 输出表）→
  F10 块 → 除权事件块；注入查询 `target_stock_ticker`。
- `runInvestmentPipeline(ticker, { llm, config, events })`：采集（gates/store
  FetchScope）→ 指标 → 上下文 → committee → 报告对象
  `{ final_report, opinions, messages, events }`。
- `test/pipeline.test.ts`：fixture 驱动（假 TDX 源注入）——上下文块顺序、
  报告形状、事件序（progress→report…→done）；error 路径（缺数据）→ error 事件。

## 步骤 4 — 事件桥（R3）

- 复用 M2 progress.ts；`src/events.ts`：`createPipelineRunner()` →
  `{ events: AsyncIterable<ProgressEvent>, run(ticker) }`（生成器/回调订阅，
  Node 与 App 共用）。
- `test/events.test.ts`：订阅顺序、done 携带报告、error 终止。

## 步骤 5 — 端到端探针（AC3）

- `npm run probe` → `tools/probe.mjs`（或 ts 脚本）：`SOA_LIVE=1` 时走
  真 TDX + 真 LLM；输出 JSON 到 `probe-output/`（gitignored）。
- 本机验证一次真链（有 TDX_API_KEY/LLM_* 才跑；缺键时探针输出门控说明）。

## 步骤 6 — Expo App（R4/AC4）

- `npx create-expo-app@latest app --template blank-typescript`（`ts/app/`，
  app 名 `soa-rn`），装 `react-native-web` + `lightweight-charts`
  （图表用 web 渲染验证）。
- 结构：`app/App.tsx`（底部 Tab 导航：react-navigation 或手写 state Tab）、
  `app/screens/{Report,Data,Settings}Screen.tsx`、`app/lib/runner.ts`
  （订阅 `../src/events` 的 runner，状态驱动重渲染）。
- 报告 Tab：阶段进度 + 观点 expander（角色名映射 ROLES tab_title）；
  数据 Tab：日K 尾表 + lightweight-charts K线/成交量（web）+ 指标表；
  设置 Tab：三键输入（持久化 AsyncStorage/内存）+ 开关 + ticker + 开始。
- 门控：无三键 → 设置 Tab 红字提示 + 禁用开始。
- 验证：`npm run web`（expo web）本地预览三 Tab 渲染（浏览器截图/快照）。

## 步骤 7 — 验收

- `npx tsc --noEmit`（ts/ 根）+ `npm test` 全绿；`cd app && npx tsc --noEmit`。
- AC1-AC6 逐条核；汇报 + 真机 dev build 步骤文档（父任务 AC2 环境依赖项）。
