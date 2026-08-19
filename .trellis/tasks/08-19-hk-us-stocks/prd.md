# 港股美股支持 (hk-us-stocks)

## Goal

在纯 TypeScript 的 StockOperatorAgent 中支持港股与美股分析：ticker 输入 → 数据采集（Yahoo Finance 免 key 主源：复权日K/报价/概览/季度财报；Finnhub 可选增强：US profile）→ 指标与报告合成 → 7 角色委员会分析 → UI 展示，与 A 股体验对齐。

## 已确认决策

1. 数据源 = Yahoo Finance（主，免 key）+ Finnhub（可选，`FINNHUB_API_KEY` 门控，用户明确要求双源）。Yahoo 本环境实测可达（chart 免 crumb；quoteSummary 经 fc.yahoo.com cookie → getcrumb）。
2. 基本面深度 = 与 A 股全对齐（概览 + 季度业绩报告表）。
3. 市场顺序 = 港股 + 美股一起。
4. 执行结构 = Trellis parent/child 任务树 + trellis-implement 子代理分派 + 每子任务分支/worktree 并行 + 单 commit 合并。

## 任务图与依赖

```
S1 市场模型与时间门 (hk-us-s1-market)  ← 无依赖
S2 Yahoo/Finnhub 客户端与合成 (hk-us-s2-clients)  ← S1
S3 Yahoo 采集链与代理 (hk-us-s3-collect)  ← S2（S1 已并入）
S4 委员会提示词市场化 (hk-us-s4-prompts)  ← S1
S5 UI 与设置集成 (hk-us-s5-ui)  ← S1-S4 全部合并
```

依赖写在各子任务 prd.md（不靠树位置暗示）。S2 ∥ S4 可并行（worktree）。

## 跨子验收（最终以合并后全量验证为准）

- 全量 `npm test` + `npm run typecheck` 绿；CN 路径零回归（提示词逐字节、gates/采集/UI 行为不变）。
- `SOA_COLLECT_ONLY=1 node --experimental-transform-types tools/probe.mts 00700` → 日K≥500 根、业绩报告≥8 行、概览含 `currency: HKD`；`AAPL` → USD、bars≥1000；`09988` 解析落到 `09988.HK`；`600036` 与改造前一致。
- 浏览器 E2E：`00700`/`AAPL`/`09988` 分析全链跑通（采集数据 Tab 量(股)、财务趋势图、市场徽标）；真实 LLM 探针 report.json 含 6+ 角色报告与最终决策。
- spec 更新（ts/index.md、error-handling.md）。

## Out of scope

- 交易执行（仅分析报告）。
- 北交所（维持不支持，拦截文案不变）。
- Finnhub 港股覆盖（不可验证，港股不依赖）。
- 换源/多源兜底（Yahoo 不可用即报错中止，接受免费非官方源风险）。
