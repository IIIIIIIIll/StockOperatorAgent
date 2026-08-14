# freshness 门接线（child C）

## Goal

修复审计 py-data-acq P4/P5（C8 决策）：`gates.ts` 的 `overviewNeedsRefresh` / `reportsFresh` / `latestPastQuarterEnd` 目前生产零引用（仅单测），TS 每次分析恒全量重拉日K+F10。接线恢复「同日跳过」/「同季不重拉」优化，行为贴近 Python data_acquisition。

## Background

- 审计证据：`archive/2026-08/08-14-py-ts-gap-audit/research/py-data-acq.md` #4/#6/#8；`00-gap-report.md` §3 C8。
- Python 对照：`data_acquisition.py:250-284` `_overview_stale`/`_reports_stale`/`_latest_past_quarter_end`；`data_acquisition.py:146-150,394` 同日跳过语义。
- TS 现状：`gates.ts:15-47` 函数已存在（含单测 store-gates.test.ts:94-102）；采集链 `App.tsx:184` collectForWeb 无条件全量 + `webCollect.ts` applyCollectedToStore + `proxies.cjs` doCollect。
- 决策（用户 2026-08-14）：接线恢复同日跳过。

## Requirements

1. 采集链接入 freshness 判定：日K 已有当日数据（lastDataUpdate == asiaToday）→ 跳过日K 重拉；F10 业绩同季已入库（reportsFresh）→ 跳过 F10 财务分析节重拉。
2. 判定依据 store 现有数据（InMemoryStore 的 stock.lastDataUpdate / performance_reports report_date），不新增持久化字段。
3. 跳过语义对齐 Python：跳过返回现有数据（不置空）；部分 fresh 时跳过对应源、不整体短路（如日K fresh 但 snapshot 仍拉）。
4. 保持正确性：非同日/非当季 → 全量路径不变；跳过后的数据流向与现有链路一致（replaceDatas/addPerformanceReports 幂等不变）。

## Acceptance Criteria

- [ ] 同日二次分析：日K 不重拉（可观测：无 /tdx-collect 日K 请求或日志跳过提示）
- [ ] 同季二次分析：F10 财务分析节不重拉
- [ ] 跨日/跨季首次分析：全量路径行为与现状一致（回归）
- [ ] gates.ts 单测扩展覆盖接线后语义；现有 vitest 全绿 + `tsc --noEmit`

## Out of scope

- FetchScope 类接线（采集去重已由单次 collect 结构达成，非必要）
- is_trading_time 移植（BY_DESIGN）
- 概览持久化（TS 每次现算，架构简化，审计 P3）
