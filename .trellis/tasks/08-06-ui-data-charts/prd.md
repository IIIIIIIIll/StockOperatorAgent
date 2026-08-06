# 数据采集 Tab 图表可视化(K线/成交量/财务指标)

## Goal

「采集数据」Tab 在 markdown 表格之外增加图表:近 60 日行情的 K线(红涨绿跌,A 股约定)、成交量、收盘价趋势、涨跌幅,以及近 20 期财务摘要的净利润/毛利率/EPS 折线。纯展示层:解析 stock_information 文本 → 结构化数据 → altair 图表,LLM 上下文零改动。

## Background

- 数据源是 `build_stock_information` 拼好的定宽文本(同时是 LLM 上下文,不能改)。
- 既有 `data_markdown.py` 已实现分节 + 行内 token 解析(`_pairs`/`_parse_token`),可直接复用;格式实测(2026-08-06 查证 formatter 源码 + 测试样本):
  - 日K行 8 键:Date/Open/Close/High/Low/Change Percent/Volume/Turnover Rate,`', '` 分隔;注意 `Open:` 后**无空格**、其余键有空格;数值带 `%`/`lots` 后缀,N/A 形态存在。
  - 业绩行 9 键:Report Date(YYYYMMDD 字符串)/EPS/Net Profit/Net Profit YoY percent/…,部分键是 `label 数值` 无冒号形态。
  - 日期顺序取决于 storage(`historical_data[-60:]`),**图表解析器统一升序**,与源头顺序解耦。
- 技术栈:altair 5.5.0 已装(requirements 锁 6.0.0,均满足 streamlit 1.61.1 `<7,>=5.0` 区间,本任务不动);`st.altair_chart` 默认 `theme="streamlit"` 自动适配亮暗主题(背景/文字/坐标轴),**mark 颜色由 spec 定死,需选双主题可读的红绿**。
- 用户拍板范围(2026-08-06):K线 + 更多图表(K线/成交量/收盘价趋势/涨跌幅/财务指标)。

## Requirements

1. **解析层**(data_markdown.py 内,纯函数):
   - 抽出可复用的分节迭代器与行解析(`to_markdown_tables` 行为不变,既有 16 用例兜底)。
   - `parse_daily_rows(stock_info) -> list[dict]`:日K节每行 → dict(8 键),数值去 `%`/`lots` 后缀转 float,`N/A` → None,日期**升序**。
   - `parse_financial_rows(stock_info) -> list[dict]`:业绩节每行 → dict(9 键),数值化同理,report_date 升序。
2. **图表层**(新 `core/ui/charts.py`,纯函数,无 streamlit import;altair spec 构造不渲染,离线可测):
   - K线:mark_rule(最高-最低影线)+ mark_bar(开-收实体),收盘≥开盘 → 红(涨)、收盘<开盘 → 绿(跌)。
   - 成交量柱:按涨跌同色。
   - 收盘价趋势线(mark_line)。
   - 涨跌幅柱(红涨绿跌)。
   - 财务折线:净利润/销售毛利率/EPS 各自独立 chart(单位不同不混轴)。
3. **接线**(display.py 薄接线):采集数据 Tab 在 markdown 表格之后渲染图表;解析无有效行 → 跳过图表不打扰。
4. **亮暗主题**:背景/文字交给 streamlit chart theme;mark 红绿选双主题可读色(浏览器实测确认)。
5. **克制**:不计算 MA 序列(指标节只有最新值,计算=展示派生,超薄层边界——记为后续增强);不改 stock_information 文本;不新增依赖。

## Constraints

- `display.py` 保持薄渲染层;解析与图表构建都是纯函数(离线可测,house style,不 mock Streamlit)。
- `data_markdown.py` 重构不改变 `to_markdown_tables` 输出(LLM 上下文与既有表格零变化)。
- 全量回归环境互斥:跑 pytest 前停 streamlit。
- 图表单位不自行断言(净利润/EPS 原始单位未知),y 轴标题用中文字段名,数值以表格为准。

## Acceptance Criteria

- [ ] `parse_daily_rows` / `parse_financial_rows`:合成文本(镜像真实格式)→ 结构化 dict;数值去后缀、N/A→None、日期升序(含乱序输入用例);无数据节 → 空列表。
- [ ] `to_markdown_tables` 重构后行为不变(既有 16 用例全绿)。
- [ ] charts.py 各构建函数:离线断言 altair spec(marks 类型、encoding 字段、红绿色板 domain/range);无 streamlit import。
- [ ] display.py 数据 Tab 渲染图表(接线测试:图表构建被调用/插入点正确);解析空 → 不渲染。
- [ ] 浏览器实测:亮/暗两主题下 K线/成交量/折线/柱图全部可读,红涨绿跌正确,悬浮/缩放正常。
- [ ] 全量回归:0 新增失败(先停 streamlit)。
- [ ] spec 更新(core/index.md UI 段增补图表契约)。
- [ ] 收尾完整:feat/docs(spec)/chore(task) 提交 + journal + archive(本次按 flow 走完 3.5)。

## Notes

- 实施前全局搜既有图表/altair 代码(guides Pre-Modification Rule)。
- 红绿选色:涨 #E03131 / 跌 #0E9F6E 候选,浏览器两主题实测,不可读则调(参考 theme.PALETTE 品牌红系)。
