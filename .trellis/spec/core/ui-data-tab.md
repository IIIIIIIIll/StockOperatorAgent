---
description: 采集数据 Tab — data_markdown 分节/表格、charts 图表、parse-once 契约
paths:
  - core/ui/data_markdown.py
  - core/ui/charts.py
---
# 采集数据 Tab（`core/ui/data_markdown.py`、`core/ui/charts.py`）

- **2026-08-02（采集数据 Tab）**：`st.tabs` 七元组——「采集数据」
  （`DATA_TAB_TITLE` 常量）放**最前**，后接六报告 Tab（顺序不变；
  08-08-technical-indicator-analyst 增「技术指标分析」，趋势分析之后）。
  `build_stock_information` 成功返回后、`graph.stream` 前填充：
  `st.header(DATA_TAB_TITLE)` + `st.markdown(...)`。异常路径
  （`st.error` + return）不填充不占位；技术指标/实时情报的降级占位
  文本原样透传。display 保持薄渲染层：不新增数据解析/格式化逻辑。
- **2026-08-02（采集数据 markdown 表格化）**：`core/ui/data_markdown.py`
  纯函数模块把定宽文本转成带表格的 markdown——`to_markdown_tables(str)`
  分节（概览/日K/业绩/指标/情报）逐节转表：行内 token 按 `, ` 切分，
  兼容 `Key: value` / `Key=value` / `label 数值` 三种形态（业绩段
  YoY/QoQ 无冒号标签，rpartition 空格 + 数值判定）；指标行
  `label: K=V` 融合 token 递归展开；**多行且键集合一致 → 列向表**
  （日K 8 列 / 业绩 9 列），单行或键不一致 → 扁平两列表（指标|数值）；
  `KEY_LABELS` 英文 key → 中文标签，未知 key 原样透传；降级占位文本
  （无键值形态）原样透传不吞。**约束**：`stock_information` 同时是
  LLM 上下文（build_stock_information 唯一组装点）——只改展示端，
  源头文本零改动（方案 B，2026-08-02 确认）。测试
  `test/core/ui/test_data_markdown.py`（离线合成输入，house style）。
- `get_state_history` 现仅测试消费（如 `test_graph_parallel._run_graph`
  取最终 state 断言）；UI 不再调用。保留 committee API
  （`make_investment_committee` / `make_investment_decision`）不变。
- **2026-08-06（采集数据图表,08-06-ui-data-charts）**：
  - **`data_markdown.py` 分节/解析契约**：`iter_sections(stock_info)` 是
    分节唯一实现（yield (section_id, title, lines)；marker 语义：
    daily/financial 英文 marker、指标节中文【】去括号保留日期、
    overview 隐式节；08-09 起【】marker 由 `_marker_section` 通用识别：
    `_SECTION_TITLES` 新注册标题 → 新节）——`to_markdown_tables`（展示端，
    输出逐字节不变）与 `parse_daily_rows` / `parse_financial_rows`
    （图表数据源）共用，不双份分节逻辑。parse_* 行键序由 `_DAILY_KEYS` /
    `_FINANCIAL_KEYS` 钉死；数值经 `_to_number` 归一（去 %/lots 后缀、
    N/A→None，失败→None 不炸）；**日期升序**（源头顺序取决于 storage，
    图表统一旧→新）。
  - **`core/ui/charts.py`** 纯函数模块（无 Streamlit import，离线断言
    altair spec）：`candlestick_chart`（rule 影线+bar 实体）/ `volume_chart`
    / `close_line_chart` / `change_percent_chart` / `financial_charts`
    （净利润/销售毛利率/每股收益三折线，单位不同不混轴）+ `iter_data_charts`
    （08-09 起入口为 `ParsedStockInfo`，产出 [(标题, chart)]，空数据
    空迭代——不再接触文本）。**涨跌语义色**（A 股约定红涨
    绿跌）：`UP_COLOR #E03131` / `DOWN_COLOR #0B9464`，经 validate_palette
    亮暗双模式 PASS（CVD ΔE 8.0）；财务线 #2563EB / #D97706。mark 色
    spec 定死（跨主题不变），背景/轴/文字交给 st.altair_chart 默认
    streamlit theme。日期轴用 **ordinal** 编码（交易日不等距，避免假空隙）。
    图表不计算 MA（指标节只有最新单值，展示派生超薄层边界——后续增强）。
  - **display.py 数据 Tab**：markdown 表格后
    `parsed = data_markdown.parse_stock_info(stock_info)`（08-09 parse-once）
    → `for title, chart in charts.iter_data_charts(parsed): st.subheader +
    st.altair_chart(use_container_width=True)` + `st.markdown(render_sections(parsed.sections))`；
    空数据不画空图。
  - **图表高度下限（2026-08-06 修复，浏览器实测踩坑）**：顶部涨跌图例 +
    旋转 45° 日期标签 + 双轴标题的镀铬区约 170px——svg 高 <200px 时
    绘图区 ≤30px，140px 时 ≤0 → vega 渲染 0 高 mark（柱子全塌、y 轴
    无刻度，`path d='M2,0h14v0h-14Z'`；初判误诊为宽度问题，实际是
    高度）。约束：副图 `_VOLUME_HEIGHT` ≥260、K线 320；改高度先
    浏览器实测。浏览器验收（Playwright 程序化验证）：两主题 6 图均
    渲染（K线/成交量/涨跌幅红绿可见、单系列线可见），暗底 #0E1117。
- **2026-08-09（采集段结构化,08-09-structured-enrichment-sections）**：
  **parse-once 边界**——`build_stock_information` **零改动**（text-only，
  LLM 上下文/e2e 种子/test_query_baselines 天然逐字节不变；PRD R1 的双
  形态返回在 display 边界落地）：display 采集 Tab 用
  `data_markdown.parse_stock_info(stock_info)` **解析一次**——iter_sections
  一次产出全部节，daily/financial 行由内部 `_rows_from_sections(sections,
  sid, date_key, keys)` 从已分节 lines 推导（不对 text 二次迭代）→ 图表
  `charts.iter_data_charts(parsed)`、表格 `render_sections(parsed.sections)`
  ——UI 不再接触原始文本；graph 输入仍传 text 原样。`iter_sections` /
  `parse_daily_rows` / `parse_financial_rows` / `to_markdown_tables` 公共
  签名与输出不变（内部重构共用 `_rows_from_sections` / `render_sections`，
  既有测试全绿即等价证明）。**新段一行注册**：生产者输出文本（含
  `【标题】` marker 行）+ `_SECTION_TITLES` 注册标题一行——`_marker_section`
  通用识别、`render_sections` 通用表格自动渲染（表格零代码；图表需显式
  mapping，charts 本就各图 bespoke）。等价性由 display 同 ticker 文本
  （render_sections(parsed.sections) == to_markdown_tables(text)）与 e2e
  种子流经 parse_stock_info 的表格/Tab 断言保住。
