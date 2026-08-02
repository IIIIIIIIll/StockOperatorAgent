# 解析 F10 盈利能力等指标分节——并入 stock_information 供 LLM 使用

## Goal

TDX F10 财务分析页面除【主要财务指标】（已解析，见 08-02-fix-f10-quarterly-data）
外，还有一整套**从未被解析**的指标分节：【盈利能力指标】【偿债能力指标】
【发展能力指标】（银行股另有【资本充足指标】【贷款五级分类】等）。这些分节
与【主要财务指标】同构（两张子表：年报表 + 季度表，表头 `财务指标(%)`），
包含基本面分析直接需要的指标——**营业毛利率/营业净利率/营业利润率/成本费用
利润率/总资产报酬率/加权净资产收益率**（非银行股 600519 实测 6 项通用；
银行股 000001 另有净息差/净利差等特有项）。当前这些指标完全不进入系统：
`sales_gross_margin` 字段恒 NaN（reports.py 注释"F10 无"），基本面 agent
看不到毛利率/净利率。

本任务：新增工具函数解析【盈利能力指标】节（近期扩展性考虑其他分节），把
摘要文本并入 `stock_information`（LLM 上下文），供基本面 agent 分析使用。

## Requirements

### R1（解析器扩展：按分节名解析）

- `f10_parser` 泛化：新增按分节名解析的能力（如
  `parse_indicator_section(text, section_name)`），复用现有"日期头子表
  并入 + (metric, period) 去重 + 亿万归一"逻辑——【盈利能力指标】节与
  【主要财务指标】节结构完全同构（只是表头 `财务指标(%)`、行首指标名
  不同），**不应复制解析逻辑**。
- 现状 `parse_finance_indicators_all_tables`（【主要财务指标】专用）保持
  兼容——新函数与其共享内部实现，不破坏既有测试。

### R2（新工具函数 `get_financial_indicators`）

- `core/llms/tools/get_financial_indicators.py`：`get_financial_indicators(ticker) -> str`
  - 从 F10 raw 缓存（`fetch_company_finance_raw`，零网络）解析【盈利能力
    指标】节 → 中文摘要文本（与 get_trend_indicators 同风格：
    `【盈利能力指标（最新期）】` 段头 + 每指标一行 `名称: 值%`）。
  - **失败降级不 raise**（error-handling 约定，同 get_trend_indicators/
    get_market_intel）：raw 缓存缺失/解析失败/无该节 → 占位文本
    （如 `（无 {ticker} 的盈利能力指标，跳过）`），图可继续。
  - 输出**最新报告期**的指标（LLM 上下文关注当前基本面；历史期已在
    业绩报告表格中，不重复）。
  - 指标名保持 F10 原文（营业毛利率等已是中文）；值为百分数。
- 银行特有指标（净息差等）**跟随解析**——该节有就显示、没有就不显示
  （不硬编码通用集；命中率低不告警——本任务不引入新的命中率机制）。

### R3（组装点扩展）

- `build_stock_information` 加第四段：`get_stock_info` + `get_trend_indicators`
  + `get_financial_indicators` + `get_market_intel`（顺序：基本信息 → 技术
  指标 → 财务指标 → 实时情报）。`progress` 回调同步加一步。
- display 与 `make_investment_decision` 共用组装点，一处改动两端生效；
  UI 采集数据 Tab 显示新段：`data_markdown` 加 `【盈利能力指标（` 分节
  marker（独立成节渲染，否则会混入技术指标节——见 design.md §3.3）。

### R4（LLM 上下文与既有行为）

- `stock_information` 内容变化（新增段）——LLM 上下文更丰富，属本任务
  预期效果；不改 agent prompt/State/图结构。
- 既有测试影响面：`test_committee_enrichment.py::test_contains_technical_
  indicators_and_market_intel` 类断言需补新段断言；`get_trend_indicators`
  /`get_market_intel` 测试不动。
- 模块级副作用约定保持：`get_financial_indicators` 内函数 import
  （同 get_trend_indicators/get_market_intel）。

## Acceptance Criteria

- [ ] `parse_indicator_section` 对真实 raw 文本解析【盈利能力指标】节：
      600519 → 6 项通用指标 9 期（含季度）；000001 → 含银行特有项
      （净息差等）+ 通用项
- [ ] `get_financial_indicators` 返回中文摘要：段头 + 最新期每指标一行
      `名称: 值%`；raw 缺失/解析失败 → 占位文本不 raise
- [ ] `build_stock_information` 输出含【盈利能力指标】段（真实缓存）；
      顺序：个股信息 → 技术指标 → 财务指标 → 实时情报
- [ ] UI 采集数据 Tab 新段独立成节渲染为表格（data_markdown 加
      `【盈利能力指标（` marker；合成 stock_info 验证不混入技术指标节）
- [ ] `sales_gross_margin` 字段**不改**（performance_reports 15 列契约
      不动——毛利率经 LLM 上下文提供给 agent，而非改 ZODB 数据模型）
- [ ] 既有测试保持绿（enrichment 组装断言更新）；新增
      `test_f10_indicator_sections.py`（解析器）+ 工具测试
      `test_get_financial_indicators.py`
- [ ] 全量回归 0 新增失败（基线 0F/188P/20S）

## Notes

- 复杂任务：需要 design.md + implement.md。
- 实测格式（2026-08-02，600519/000001）：
  - 【盈利能力指标】节表头行 `财务指标(%)`，指标行 `营业毛利率` 等，
    值纯数值（百分数，无 % 后缀、无单位）；同【主要财务指标】一样有
    年报表 + 季度表两张子表。
  - 600519 通用 6 项；000001 银行特有（净息差/净利差/成本收入比等）+
    通用项。所有分节位置在【主要财务指标】之后、被 `\n【` 截断——
    需按**分节名**定位（不能只找第一个）。
- 不做：其他分节（偿债/发展/资本充足等）——本期只做【盈利能力指标】，
    解析器按节名可扩展，后续分节是加一行调用的事；改 `sales_gross_margin`
    ZODB 字段；改 agent prompt 引用新段（LLM 自行使用）。
