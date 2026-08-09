# 设计：结构化采集段（enrichment 文本旁挂结构化 sections）

## 架构与边界

```
core/ui/data_markdown.py（改造，唯一解析者）
    ParsedStockInfo（frozen dataclass，新增）
        sections:    tuple[(section_id, title, lines), ...]   —— iter_sections 输出
        daily_rows:  tuple[dict, ...]                          —— 日K 结构化行
        financial_rows: tuple[dict, ...]                       —— 业绩结构化行
    parse_stock_info(stock_info: str) -> ParsedStockInfo（新增，**解析一次**）
    render_sections(sections) -> str（新增——to_markdown_tables 的渲染半）
    iter_sections / parse_daily_rows / parse_financial_rows / to_markdown_tables
        —— 公共签名**不变**（内部重构共用 _rows_from_sections；既有测试全绿）

core/ui/charts.py（改造）
    iter_data_charts(parsed: ParsedStockInfo)   —— 新签名：消费结构化行，
    不再接触文本（内部 candlestick/volume/close/change_percent/financial
    函数不变，只改入口参数与 daily/financial 数据来源）

core/ui/display.py（改造，采集 Tab）
    stock_info = build_stock_information(...)    —— **text 不变**（LLM 上下文）
    parsed = data_markdown.parse_stock_info(stock_info)   —— 解析一次
    charts.iter_data_charts(parsed)；data_markdown.render_sections(parsed.sections)
    graph 输入仍传 stock_info（text 原样）
```

## 与 PRD 的落地差异（明示）

PRD R1 写 `build_stock_information` 返回双形态；**落地形态调整为**：
`build_stock_information` **零改动**（text-only，enrichment 与
make_investment_decision 与其全部测试不动），结构化在 **display 边界**
用 `parse_stock_info` 一次解析产生。理由：

1. 解析是纯字符串工作（数据获取只发生一次在 build_stock_information 内），
   放 display 边界与放 committee 边界成本相同，但 committee/
   make_investment_decision/enrichment 测试零波及
2. text 契约（LLM 上下文 / e2e 种子 fixture / test_query_baselines）物理上
   保持在 enrichment 侧，改动面最小
3. PRD 核心意图全交付：UI 消费结构化、每分析只解析一次、新段一行注册、
   图表/表格不再接触文本

## 解析一次（核心机制）

- `parse_stock_info` 内部：`sections = tuple(iter_sections(text))` 一次，
  daily/financial 由新内部函数 `_rows_from_sections(sections, sid, date_key,
  keys)` 从已分节的 lines 推导——**不再对 text 二次迭代**
- `parse_daily_rows(text)` / `parse_financial_rows(text)` 重构为
  `_rows_from_sections(tuple(iter_sections(text)), ...)`——公共签名与输出
  不变（test_data_markdown 全绿即等价证明）
- `to_markdown_tables(text)` 重构为 `render_sections(tuple(iter_sections(text)))`
  ——渲染半独立，display 用 `render_sections(parsed.sections)` 零重复解析

## 新段成本（AC 演示断言）

新数据段 = 生产者输出文本（含 marker 行）+ `_SECTION_TITLES` 注册标题
**一行**；内容为 `'Key: value'` 形态的行 → `render_sections` 通用表格
自动渲染（_pairs/_render_table 已是通用实现，08-08 亿信段先例）。图表：
新段要画图需显式 mapping（charts 本就是各图 bespoke，不承诺自动出图——
PRD AC 的"无需改 charts/data_markdown"按此诚实口径：表格零代码、图表
需显式映射）。

## 兼容与风险

- **text 逐字节不变**：build_stock_information 零改动 → 全链路（LLM
  上下文、enrichment 测试、e2e 种子）天然不变；新代码只消费已存在的 text
- **展示等价**：iter_data_charts 内部行结构与改造前相同（同一解析器）→
  test_charts 的图表断言语义不变；test_data_markdown 全部文本入口保留
- **display 源文本断言更新**（test_display.py:207-212 断言 write_ui 源码
  含 `charts.iter_data_charts(stock_info)` 与顺序）→ 断言性更新为
  `parse_stock_info` / `iter_data_charts(parsed)` / `render_sections`
- **e2e 零改动预期**：mock_app 的种子文本流经 parse_stock_info，表格/图表
  渲染等价（test_interaction 的 5 张表断言与 test_smoke Tab 断言保留）
- 解析器不碰生产工具（get_stock_info/get_trend_indicators/... 零改动）

## 不做

- 不改 build_stock_information / 任何 enrichment 工具 / make_investment_decision
- 不引入 DataFrame 传递（ParsedStockInfo 的行 dict 与 charts 现有输入同构）
- 不合并数据源层的结构化（那是 Option B：工具返回 payload——更大契约
  改动，收益相同，风险更高，本次不做）
