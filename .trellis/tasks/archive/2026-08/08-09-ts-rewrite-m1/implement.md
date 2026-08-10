# M1 执行计划：数据层移植

工程：`~/soa-ts-prototype`（npm init 已完成，node-tdx-market 已装）。
原型 `.mjs` 已验证可跑；本任务转正式 `.ts` + 补齐仓储/门/指标 + 测试。

## 步骤 1 — 工程初始化

- package.json：type=module、scripts.test="vitest run"；装 vitest、
  better-sqlite3、typescript、@types/*。
- tsconfig.json（strict，ESM）；src/ 分层：tdx/ store/ adjust.ts
  indicators.ts f10.ts gates.ts；test/ 镜像。
- 迁移原型 `.mjs` → `.ts`：xdxr、f10_client、f10_parser、qfq、quote 探针。
- **验收**：`npm test` 空套件绿；`tsc --noEmit` 过。

## 步骤 2 — fixture 导出（Python oracle，只读）

- `tools/export_fixtures.py`：读 Python 仓库（sys.path 注入）——
  `fetch_daily('600036')` 全量 → mapping 12 列 → qfq_adjust →
  输出 `test/fixtures/600036_daily.json`（原始 bars + qfq 后 bars，
  字段：date/OHLCV/amount）；`compute_all` 指标输出
  `test/fixtures/600036_indicators.json`；F10 双格式文本固化
  （通达信 = M0 拉的 /tmp/f10_text.txt，港澳资讯 = 项目缓存 300750）。
- fixture 落盘后测试**离线可跑**（不依赖网络/服务器）。
- **验收**：fixture 文件生成，字段与 design 数据契约一致。

## 步骤 3 — 仓储（store.ts）

- better-sqlite3 schema：stocks(ticker PK, name, overview_json,
  overview_last_update, last_data_update) / daily_bars(ticker, date,
  OHLCV, amount, PK(ticker,date)) / performance_reports(ticker,
  report_date, fields, PK(ticker,report_date)) / meta(key, value)。
- API：getStock / putStock / addDatas（批量去重，返回实际追加数，
  单事务）/ addPerformanceReports / updateOverview。
- 对齐 Python：add_data 拒绝非更新 date；批量 0=全重复不写。
- **验收**：AC4 测试绿。

## 步骤 4 — freshness 门 + FetchScope（gates.ts）

- overview 门：`overview_last_update.date() < 最近交易日` → 需刷新
  （交易日 = get_last_business_day 语义，工作日）；业绩门：最新
  report_date == 最近已过季度末（0331/0630/0930/1231）→ 不拉。
- FetchScope：请求尺寸复用判定（cached_bars ≥ 请求尺寸）。
- 注入点：fetcher 可注入（house style 无 mock 框架，对齐 Python）。
- **验收**：AC5 测试绿。

## 步骤 5 — 指标（indicators.ts）

- 移植 vendored `compute_all`（MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比）
  + `extra_indicators.py`（MACD-VH 柱态/动量区 + 乖离率）。
- 输入 = qfq 后 bars；输出与 Python 对齐（字段名/最近一根摘要形态可 M2
  再定，本步只保证数值）。
- **验收**：AC3 对比绿（容差内）。

## 步骤 6 — F10 双格式（f10.ts）

- 解析器兼容 U+FF5C/U+2502 + 分节名模糊匹配；客户端（Category/
  Content）接入 src/tdx/。
- **验收**：AC6 测试绿（双 fixture）。

## 步骤 7 — 集成与收尾

- Node 探针（真服务器）：getQuote/xdxr/F10/日K 全链跑通。
- `npm test` 全绿 + `tsc --noEmit` 过；AC1-AC7 逐条核。
- 汇报：AC 打勾表 + 与 Python 等价性证据（fixture 对比输出）。
