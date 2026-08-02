# fix(data): 概览 freshness 门——ensure_stock 按交易日刷新 overview

## Goal

docs/process-flow-review-2026-08-02.md finding #1。`ensure_stock` 对已有股票
永不重建 overview：`overview_last_update` 是只写死字段（全仓无读者），分析
次日概览价格/PE/PB/动量过期而日K 新鲜——LLM 拿到 mixed-epoch 上下文（formatter
首行 Latest price 是上次分析日的快照价）。修复：把 `overview_last_update`
变为真实 freshness 标记，早于当前交易日 → 重建概览（best-effort，失败保留
旧概览不阻断主流程）。

## Requirements

- R1（门）：`ensure_stock` 在 storage 已有该股票的分支加 freshness 门——
  `stock.overview_last_update.date() < get_last_business_day(asia_today())`
  判定"未在本交易日更新过"；命中 → 重建，未命中 → 直接 True（幂等语义不变）。
- R2（重建）：命中门 → `TdxSource().build_overview(ticker)`（与首次构建同一
  入口，22 列序契约不变）→ `StockOverview(*list(row.values()))` →
  `stock.update_overview(new_overview=...)`（既有 mutator：写 overview +
  同步 overview_last_update + commit）。
- R3（best-effort）：`build_overview` 返回 None（无价格来源）→
  `logger.warning` + 保留旧概览，仍返回 True（概览刷新失败不阻断分析，
  与业绩 freshness 门的"跳过不失败"语义一致）。
- R4（协议不变）：`ensure_stock` 返回协议保持 bool；BJ / 无该股 / 首次构建
  行为不变（BJ 检查与构建分支不触碰）。
- R5（可测性）：`ensure_stock` 增加 `_build_overview=None` 测试注入点
  （house style，与 `acquire_performance_report_tdx` 的 `_fetch_reports`
  同形）；默认 `TdxSource().build_overview`。
- R6（不扩面）：不做"刷新失败降级用日K 价格补"的增强（review 文档中的备选
  方案），保持最小修复。

## Acceptance Criteria

- [x] 当日已更新（fresh）→ 不触发构建（注入计数器零调用），同一 stock 对象，
      返回 True（test_ensure_stock_skips_fresh_overview）
- [x] 过期（overview_last_update 回拨到 3 天前）→ 构建恰一次，overview 被
      替换，overview_last_update 前进到当天，返回 True
      （test_ensure_stock_refreshes_stale_overview）
- [x] 过期 + 构建返回 None → 旧 overview 原样保留，返回 True（不阻断）
      （test_ensure_stock_keeps_old_overview_on_refresh_failure）
- [x] BJ / 无该股行为不变（既有用例 test_ensure_stock_bj_code_returns_false /
      test_ensure_stock_fails_when_overview_build_fails 仍绿）
- [x] 新用例落在 test/core/data_acquisition/test_data_acquisition_tdx.py
      （离线注入，不依赖 TDX 可达性；专用 dummy ticker 999998 不触碰真实数据）
- [x] 全量回归 0 新增失败（实测 0F/119P/20S，+3 新用例）
- [x] docs/process-flow-review-2026-08-02.md #1 checkbox 勾选；core spec 的
      ensure_stock 条目随实现更新（freshness 门 + 注入点 + 语义）

## Notes

- Lightweight task，PRD-only。设计要点（门基准、注入点、复用 update_overview）
  已在本 PRD 固化，无需 design.md。
- 门基准选择 date 比较而非 17:00 时间比较：同日多次分析结果稳定（不盘中
  反复刷新），跨交易日必刷新——与 storage 层 17:00 门的精神一致但更简单。
- 周末/节假日（未建模，已知 quirk）：last_bd 为最近工作日，周五更新周末不
  刷新；节假日顺延每日刷新一次（与日K freshness 门同款行为）。
