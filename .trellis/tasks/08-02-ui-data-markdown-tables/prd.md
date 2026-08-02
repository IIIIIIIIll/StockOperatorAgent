# 采集数据 Tab markdown 表格化：展示端纯函数转换

## Goal

上一任务（08-02-ui-collected-data-display）新增的「采集数据」Tab 用
`st.text` 原样渲染 `stock_information`——定宽文本布局（overview 行 +
60 根日K + 20 条业绩报告 + 技术指标 + 实时情报）可读性差。用户确认：
把采集数据格式化为**带表格的 markdown**（"proper markdown with tables"）。

**关键约束（方案确认）**：`stock_information` 同时喂给 LLM 当上下文
（`build_stock_information` 唯一组装点，`make_investment_decision` 与
display 共用）——**不改源头**（方案 A 风险：本环境无法跑真实 LLM 验证
行为变化、golden 测试全量重写），**只在展示端转换**（方案 B）：新增纯
函数模块把已拼好的文本解析成 markdown 表格，LLM 上下文零改动。

## Requirements

### R1（新纯函数模块 `core/ui/data_markdown.py`）

- 模块级常量 `KEY_LABELS`：已知字段英文 key → 中文标签（Latest price →
  最新价、Dynamic PE → 动态市盈率、Pb → 市净率、Momentum → 动量、Date
  → 日期、Open/Close/High/Low → 开/收/高/低、Change Percent → 涨跌幅、
  Volume → 成交量、Turnover Rate → 换手率、Report Date → 报告日期、
  EPS、Net Profit → 净利润、Net Profit YoY/QoQ percent → 同比/环比、
  Net worth per share → 每股净资产、Return on Equity percent → 净资产
  收益率、Cash flow per share → 每股现金流、Sales gross margin percent
  → 销售毛利率、MA5/10/20/60、EMA5/10/20/60、DIF/DEA/MACD、
  RSI6/12/24、K/D/J、BOLL_UP/MB/DN、ATR、VOL_RATIO → 量比、
  VOL_MA5、TURNOVER_RATE）；**未知 key 原样透传**（不炸不丢）。
- 纯函数（无 Streamlit/无 I/O，house style 可离线测试）：
  - `to_markdown_tables(stock_info: str) -> str` — 主入口：分节 + 逐节
    转表格 + 降级占位文本透传。
  - 内部 helper（`_pairs(line)` 解析行、`_table_from_rows(rows, labels)`
    组表等）由实现自定，但必须是模块级纯函数、可单独喂合成输入。
- 模块位置：`core/ui/` 下与 display.py 同级；display.py 保持薄渲染层
  （只 import 调用，不写转换逻辑）。

### R2（转换契约——各节映射）

`stock_information` 由三个生产者拼接（`format_stock_output` 前后有
`-----------` 分隔线；技术指标段头 `【技术指标（日期 收盘）】`；实时
情报段头 `【实时市场情报】`；数据行几乎全为 `Key: value` / `Key=value`
逗号分隔对）：

| 节 | 输入形态 | 输出 |
|----|---------|------|
| 概览 | `Stock: 平安银行 (000001)`、`Latest price: 11.11` 等 5 行键值行 | 两列表格（指标 \| 数值，中文标签） |
| 日K（Last 60 days prices） | 段头行 + 60 行，每行 8 个 `Key: value` 对 | 8 列 markdown 表格（首行 key 即表头） |
| 业绩（Last 20 financial abstracts） | 段头行 + 20 行，每行 9 个 `Key: value` 对 | 9 列 markdown 表格 |
| 技术指标 | 段头行 + 9 行，每行 `label: K=V, K=V, ...` | 两列表格（指标 \| 数值） |
| 实时情报 | 段头行 + ≤10 行，每行 `k: v, k: v` | 两列表格（字段 \| 数值） |
| 降级占位文本 | `（无 ... 行情数据，跳过技术指标）`、`（未配置 TDX_API_KEY，...）`、`（通达信 MCP ...）` 等无 `key: value` 形态的行 | **原样 markdown 透传**（不吞降级信息） |

- 通用解析规则：按 `, ` 切 token，token 按首个 `:` 或 `=` 拆 key/value
  （`Stock: 平安银行` 与 `MA5=1.00` 两种形态都吃）；同一节的键值行聚成
  一张表；`-----------` 分隔线丢弃。
- 段头行转 markdown 加粗标题（如 `**Last 60 days prices（近 60 日行情）**`）；
  每节内空行允许存在（跳过不炸）。

### R3（display.py 接线）

- 「采集数据」Tab 填充改为：
  `st.markdown(data_markdown.to_markdown_tables(stock_info))`（替换
  `st.text(stock_info)`）；`st.header(DATA_TAB_TITLE)` 保留。
- 异常守护不变：转换是纯函数，无新异常源；万一转换抛错由既有
  `graph.stream` try/except 语义处理（数据 Tab 在 try 外，实际是
  `build_stock_information` 成功后立刻调用——转换失败不应让分析中断，
  实现里转换函数内部 try/except 返回原文兜底？**不**——纯函数不吞错，
  保持简单；转换输入是自家生产者的稳定格式，测试钉死格式后转换失败
  = 格式变更，该炸就炸）。

### R4（既有行为不变）

- `stock_information` 文本、`build_stock_information`、LLM 上下文
  **零改动**（方案 B 的核心承诺）。
- 五个报告 Tab 渲染契约、`DATA_TAB_TITLE`、进度、错误守护均不变。
- 技术指标/实时情报的降级占位文本照常展示（透传即原文）。

## Acceptance Criteria

- [ ] `to_markdown_tables` 对合成各节输入产出正确 markdown：概览两列表
      / 日K 8 列表（60 行）/ 业绩 9 列表（20 行）/ 指标两列表 /
      情报两列表
- [ ] 降级占位文本行（无键值形态）原样透传不丢失
- [ ] `-----------` 分隔线与段头行处理正确（丢弃/加粗）
- [ ] `KEY_LABELS` 命中中文标签；未知 key 原样透传
- [ ] display.py 数据 Tab 用 `st.markdown(to_markdown_tables(...))`
      渲染，`st.header(DATA_TAB_TITLE)` 保留
- [ ] `stock_information` / `build_stock_information` / LLM 上下文零改动
      （git diff 确认无数据源文件变更）
- [ ] 既有 display 测试（key 检查 / enrichment 接线 / 增量渲染 / 数据
      Tab 常量）仍绿；新增 `test/core/ui/test_data_markdown.py`
- [ ] 全量回归 0 新增失败（基线 0F/159P/20S）

## Notes

- Lightweight task：PRD-only（改动 = 新增 `core/ui/data_markdown.py` +
  改 display.py 一行 + 新增测试文件）。
- 实测格式（2026-08-02）：概览行 `Latest price: 11.11`（冒号+空格）；
  日K 行 `Date: 2026-07-30, Open: 12.34, Close: 12.56, ...`；指标行
  `MA5/10/20/60: MA5=1.00, MA10=2.00, ...`（等号无空格）；情报行
  `字段: 值, 字段: 值`。token 拆分必须兼容 `: ` 与 `=` 两种。
- 不做：源头改 markdown（方案 A）、表格可排序/交互、分段拆 Tab、
  表格样式定制（Streamlit 默认表格样式即可）。
