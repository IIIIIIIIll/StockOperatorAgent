# UI 补齐：日K 列 + 涨跌幅柱图 + 财务趋势图（child B）

## Goal

修复审计 BLOCKER-2/3/4：补齐三个用户可见展示缺口——日K 表涨跌幅/换手率列、按日涨跌幅柱图、财务跨期趋势折线。数据全部在手，纯展示层。

## Background

- 审计证据：`archive/2026-08/08-14-py-ts-gap-audit/research/py-ui.md` M1/C6、M2/C7、P6/MD1；`00-gap-report.md` §2 B2/B3/B4。
- Python 对照：`charts.py:144-163` change_percent_chart（正红负绿柱）、`charts.py:165-184` financial_charts（净利润/销售毛利率/每股收益跨期折线）、`data_markdown.py:313-314` 日K 8 列。
- 决策（用户 2026-08-14）：全部补齐。

## Requirements

1. **日K 表加列**（DataScreen.tsx:75-89）：补「涨跌幅」「换手率」两列，值现算（pipeline.ts:64-65 已有 changePct/turnoverPct 公式），格式对齐 Python（涨跌幅百分比、换手率百分比）。
2. **按日涨跌幅柱图**：IndicatorChart 新增 pane，正红负绿柱，base:0，数据源 computeAll 结果（与现有图表同源，DataScreen useMemo 缓存），对齐 spec 图表节（柱系列 base:0 + 正负着色 + theme up/down 半透明）。
3. **财务跨期趋势折线**：净利润/销售毛利率/每股收益各自成图（或合并 pane 分系列），数据源 performance_reports（store.getPerformanceReports），N/A 期跳过；补业绩卡片缺的「销售毛利率」字段展示（DataScreen.tsx:118-135）。
4. 图表遵循 ts/index.md 图表节约定：web-only + 动态 import、stretch 布局（禁 setHeight）、NaN 过滤、C/LEGEND 单点同源。

## Acceptance Criteria

- [ ] 日K 表 8 列（日期/开/收/高/低/涨跌幅/成交量/换手率），数值与 Python 表对齐
- [ ] 涨跌幅柱图渲染：正红负绿、base 0、与 K 线同时间轴
- [ ] 财务趋势图渲染：三指标跨期折线，空数据不崩
- [ ] 业绩卡片含销售毛利率
- [ ] 浏览器实测（web 端截图/交互验证）或 vitest 组件测试覆盖；`tsc --noEmit` 通过

## Out of scope

- 收盘价独立线图（P8，被 K 线覆盖，NON_BLOCKER）
- 实时情报/亿信结构化区块（P7，原文可见）
- Streamlit 专属表格 CSS（P10，框架差异）
