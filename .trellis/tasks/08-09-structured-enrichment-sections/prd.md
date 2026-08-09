# 结构化采集段：enrichment 文本旁挂结构化 sections

## Goal

`build_stock_information` 把 5 段数据拼成一个 `"\n"` 拼接字符串，UI 再
**解析同一文本**画图/建表：`charts.iter_data_charts` 正则解析
（display.py:450-452）、`data_markdown.to_markdown_tables` 按 marker
切段（display.py:453）。数据流是 结构化 → 文本 → 再解析。目标：enrichment
返回 `(text, sections)` 双形态——LLM 上下文文本**逐字节不变**，UI 直接
渲染结构化数据；新数据段不再需要 marker 注册 + 解析器。

## Background / Confirmed Facts

- 5 段拼接顺序（investment_committee.py:53-77）：个股信息 → 技术指标 →
  财务指标 → 实时情报 → 亿信（条件段）；`data_markdown.iter_sections`
  以 `【...】` marker 切节（【亿信金融数据库】08-08 注册）
- `charts.iter_data_charts(stock_info)` 从定宽文本解析 K 线/成交量/
  涨跌幅/财务折线（charts.py:195 行，纯函数、空数据空迭代）
- 显示契约测试：`test/core/ui/test_charts.py`、`test_data_markdown.py`、
  `test_display.py` 喂合成文本验证解析——本任务后这些测试改为喂结构化
  数据（等价性由同 ticker 文本逐字节断言保住）

## Requirements

- **R1 双形态返回**：`build_stock_information` → `(text, sections)` 或
  `StockInformation` 对象（`text` 为既有字符串，`sections` = 段名 → 结构化
  数据：概览 DataFrame / 日K DataFrame / 财务指标 / 情报文本 / 亿信文本）。
  **`text` 对同一 ticker 逐字节一致**（LLM 上下文与提示词零变化）
- **R2 调用点改造**：`display.write_ui` 与 `make_investment_decision` 用
  结构化形态画图/建表；无 UI 路径（make_investment_decision）只取 text
- **R3 UI 渲染去解析**：charts 与 data_markdown 改从 sections 渲染——
  图表从真 DataFrame 出图，表格从结构化段生成（不再正则解析文本）
- **R4 段注册表**：新段只需注册 (段名, 生成函数, 展示函数)——marker
  解析契约废除（可与 role-registry 任务协同，不强制依赖）

## Acceptance Criteria

- [ ] 同一 ticker 下 `text` 与重构前逐字节一致（断言测试 + e2e 采集
      Tab 视觉验收 mock 模式）
- [ ] 图表渲染等价：`test/core/ui/test_charts.py` 钉死的图语义（标题/
      数据点）在结构化输入下不变
- [ ] 采集 Tab 展示等价：`test_data_markdown.py` 表格结构与现状一致
- [ ] 新增段的最小成本验证：注册一条测试段无需改 charts/data_markdown
      代码（PRD 演示断言）
- [ ] 全量回归绿（父任务 Cross-Child AC 1-4）
- [ ] spec 更新：core/index.md「build_stock_information」节、UI 契约节

## Notes

- 风险点：文本即契约（e2e mock 层 FakeGraph 内容、LLM prompt 引用）——
  改造时先抽 `text` 生成纯函数，再并行挂 sections，最后切 UI
- 不强制依赖 role-registry；若其已完成，段名/标题复用同一注册表
