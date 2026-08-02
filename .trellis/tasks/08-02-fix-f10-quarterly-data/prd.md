# 修复 TDX F10 季度数据丢失——合并两张子表（vendor 零改动）

## Goal

「近 20 期财务摘要」只有年度报告（2021-2025 年报 + 2026Q1），没有
2025 年的季度报告（Q1/Q2/Q3）。调查结论（2026-08-02 实测）：**TDX
F10「主要财务指标」页面有两张并列子表**——表 1 只列"最新期 + 历年
年报"（6 期，当前解析的）；表 2 含季度（2026-03-31 + 2025-12-31 +
2025-09-30/06-30/03-31 + 2024-12-31，9 期），数值与表 1 同口径
（累计值，同报告期数值完全一致，是表 1 的超集）。vendor 解析器
`parse_finance_indicators`（`tdx_company_info.py:95`）遇到第二个
日期头行即 `break`，**整张季度表被丢弃**——根因在 vendor 的
"第二张表可能是单季口径"防御假设，实测不成立。

**约束**：VENDOR.md 明令 vendor 代码零改动、严禁与上游静默分叉
（更新流程 = 重新拷贝上游 + 冒烟）——**修复必须在非 vendor 层实现**。

## Requirements

### R1（非 vendor 新解析器：合并两张子表）

- 新增非 vendor 解析函数（位置见 design.md），从 F10 raw 文本
  （`company_info_raw` parquet 的 `text` 列）解析**全部**日期头子表：
  表 1 + 表 2 的 (metric, period, value_num) 都收，period 合并去重。
- 输出与 vendor `parse_finance_indicators` 同 schema
  （`ts_code/metric/period/value_raw/value_num`）——`compose_reports`
  零改动复用（输入 tidy long 只是 period 更多）。
- 同 (metric, period) 出现在两张表 → 去重（两张表数值一致，取任一）；
  同 metric 不同 period → 全部保留。
- 保留 vendor 解析器的健壮性约定：缺指标 → NaN；`亿/万` 单位归一；
  无【主要财务指标】节 → 空 DataFrame；文本/`-` → NaN。

### R2（数据流：build_reports 改用新解析器）

- `reports.build_reports` 现在经 `fetch_company_finance` 拿 vendor 解析
  的 df（丢季度）。改为：优先从 `company_info_raw` 缓存文本用新解析器
  得含季度 df；缓存缺失/损坏 → 回退 vendor 解析 df（季度缺失但可用，
  不阻断）。
- `overview.py` 的 `latest_period_value`（取最新 period → PE/PB 派生）
  不受影响——新增季度不影响"最大 period"语义；overview 继续走
  `fetch_company_finance` 不动。
- 新增 raw 文本读取路径（如 `TdxSource.fetch_company_finance_raw`）
  或复用既有缓存读取——设计定；必须与拉取解耦（离线可重灌存量）。

### R3（存量数据重灌）

- 存量股票：`company_info_raw` 缓存**已有完整四张表原始文本**——重灌
  不重新联网。提供重灌入口（脚本或测试，设计定）：读取 raw 缓存 →
  新解析器 → `compose_reports` → 覆盖 ZODB 该股 `performance_reports`
  （去重合并，不丢已有期）。
- **freshness 门坑**：`acquire_performance_report_tdx` 的门（最新
  `report_date == 最近已到截止日季度末`）会跳过重拉——重灌必须绕过
  门（直接更新 ZODB 或删旧报告触发重拉），不能依赖常规分析路径。

### R4（QoQ 环比受益）

- `_qoq_series` 的相邻期间隔校验（88–93 天）在季度齐全后自然生效：
  2025 Q1→Q2→Q3→Q4 的 `total_income_QoQ_rate` / `net_profit_QoQ_rate`
  不再全 NaN（表 2 补齐中间期后相邻间隔恰为季度）。
- 补季度后 QoQ 值与累计口径一致性：环比公式（本期-上期)/上期 对
  累计值仍是合法财务语义（同比跨年、环比跨季），无需改动。

### R5（测试与既有行为不变）

- 新解析器离线测试：合成/真实 raw 文本 → 9 期齐全、去重正确、
  表 2 独占的季度期（2025-03-31/06-30/09-30）出现。
- `test_tdx_reports.py` golden 断言更新：真实 F10 文本（或合成）
  补季度行；`compose_reports` 对含季度输入产出正确 QoQ。
- 既有测试（overview 最新期语义、build_reports 降级、freshness 门）
  保持绿；全量回归 0 新增失败。

## Acceptance Criteria

- [ ] 新解析器：表 1 + 表 2 合并，9 期齐全（6 年报 + 2025 Q1-Q3 +
      2026Q1），同 (metric, period) 去重，schema 与 vendor 输出一致
- [ ] `build_reports` 产出含季度；raw 缓存缺失 → 回退 vendor 解析
      df（不崩、有 warning）
- [ ] 重灌：存量股票（如 000001）ZODB `performance_reports` 出现
      20250331/20250630/20250930，且不丢已有期
- [ ] `_qoq_series` 对补齐后的季度序列产出正确 QoQ（相邻期校验通过，
      跨年/缺期位置仍 NaN）
- [ ] `overview.latest_period_value` 行为不变（最新期仍是 2026-03-31）
- [ ] vendor 子树零改动（git diff 确认无 `vendor/` 下文件变更）
- [ ] 全量回归 0 新增失败（基线 0F/169P/20S）

## Notes

- 复杂任务：需要 design.md + implement.md。
- 已知事实（2026-08-02 实测，000001/600519/601888/002027 四股一致）：
  - F10 页面 4 张表：表 1（行 2 表头，年报+最新期）、表 2（行 27
    表头，含季度）、表 3/4（【盈利能力指标】节，不属本任务范围——
    vendor 解析器只找【主要财务指标】）。
  - raw 缓存路径 `data/tdx_cache/company_info_raw/ts_code=<TS>/data.parquet`
    的 `text` 列含完整四张表文本。
  - vendor 解析器 break 行为：`tdx_company_info.py` 日期头行 ≥2 个日期
    cell 且 periods 已设置 → break。
- 不做：改 vendor 代码、表 3/4（盈利能力指标节）解析、akshare 业绩
  报表路径、UI 改动。
