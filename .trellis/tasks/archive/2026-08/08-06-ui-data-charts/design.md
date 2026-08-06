# 设计:数据采集 Tab 图表可视化

## 1. 解析层:重构 data_markdown.py(行为不变的复用提取)

现状:`to_markdown_tables` 内联分节(5 种 marker)+ `_pairs` 行解析。图表需要同样的分节与行解析 → 抽出共享纯函数,`to_markdown_tables` 改为消费同一迭代器(既有 16 用例兜底,输出逐字节不变)。

```python
# 新增(纯函数,无 I/O):
def iter_sections(stock_info: str):
    """分节迭代:yield (title, [raw_line, ...])。marker 语义与现状完全一致
    (overview 隐式节 / daily / financial / indicators / profitability / intel)。"""

def parse_daily_rows(stock_info: str) -> list[dict]:
    """日K节每行 → dict[8 键];数值归一(去 %/lots 后缀,float;N/A → None);
    日期升序(与源头顺序解耦,storage 顺序不定);无日K节 → []。"""

def parse_financial_rows(stock_info: str) -> list[dict]:
    """业绩节每行 → dict[9 键];report_date 升序;数值归一同理;无节 → []。"""
```

实现要点:
- 行内 token 复用 `_pairs`(已兼容 `Open:` 无空格、`label 数值` 形态);数值归一写一个小 helper `_to_number(value)`(复用 `_is_numberish` 的后缀剥离逻辑剥离后 float,失败 → None)。
- 日期:日K `Date` 值是 `2026-07-30`;业绩 `Report Date` 是 `20260331` → 均存**原始字符串** + 排序用字符串比较即可(两种格式各自前缀一致,字符串序 = 时间序;日K `YYYY-MM-DD` 与业绩 `YYYYMMDD` 分别比较,不跨节混排)。
- `_is_numberish` 已处理 `%`/`lots`/`N/A`——`_to_number` 直接复用其剥离逻辑。

## 2. 图表层:新 `core/ui/charts.py`(纯函数,无 streamlit import)

altair spec 构造不渲染、无浏览器——离线可测(house style)。五个构建函数,统一签名 `(rows: list[dict]) -> altair.Chart`,输入来自 parse_* 输出:

| 函数 | mark | encoding | 颜色 |
|---|---|---|---|
| `candlestick_chart(rows)` | rule(影线) + bar(实体) | x=Date(ordinal), y=High/Low(rule), y=Open/Close(bar) | 涨(close≥open)红 `#E03131` / 跌绿 `#0E9F6E`(双主题可读候选,浏览器实测) |
| `volume_chart(rows)` | bar | x=Date, y=Volume | 同涨跌色 |
| `close_line_chart(rows)` | line | x=Date, y=Close | 品牌红 `#D32F2F`(亮)/`#EF5350`(暗)——**注意**纯函数不知主题,取 theme.PALETTE 亮色,暗色可读性浏览器实测,不佳则中亮度 `#E03131` |
| `change_percent_chart(rows)` | bar | x=Date, y=Change Percent | 正红负绿 |
| `financial_charts(rows)` | line ×3(净利润/销售毛利率/EPS) | x=Report Date, y=各字段 | 各一色,返回 `list[altair.Chart]` |

统一:
- `background="transparent"` + axis 标题中文字段名(y 标题如「收盘价」「成交量(手)」「涨跌幅%」——**不编造单位**,成交量/财务字段单位以 markdown 表格为准)。
- 工具提示(tooltip)带日期与值。
- 空行列表(全 N/A 或空) → 返回 None 或空 list,display 层跳过(不画空图)。

## 3. 接线:display.py 采集数据 Tab(薄接线)

```python
with data_tab:
    st.header(DATA_TAB_TITLE)
    st.markdown(data_markdown.to_markdown_tables(stock_info))
    # 新增(08-06-ui-data-charts):表格后追加图表;解析空 → 跳过
    for title, chart in charts.iter_data_charts(stock_info):
        st.subheader(title)
        st.altair_chart(chart, use_container_width=True)
```

- `iter_data_charts(stock_info)` 在 charts.py(纯函数):内部调 parse_* + 各构建函数,产出 [(标题, chart), ...]——K线 / 成交量 / 收盘价趋势 / 涨跌幅 / 财务(净利润、毛利率、EPS 合并为一个 subheader 下三个 chart,或各一 subheader;设计:财务一个 subheader + `st.columns(3)` 布局——columns 布局属 display 层,iter_data_charts 只产出顺序列表,columns 拆行在 display 做?保持简单:每个 chart 独立 subheader 顺序渲染,不搞 columns——少一层耦合)。
- **主题适配**:`st.altair_chart` 默认 `theme="streamlit"` 自动套激活主题(背景/轴/文字),mark 颜色 spec 定死(见上)。这是暗色正确性的根基——浏览器两主题实测验收。

## 4. 测试

- `test_data_markdown.py` 增 `TestParseDailyRows` / `TestParseFinancialRows`:合成文本(镜像 `_daily_line`/`_report_line` 真实格式)→ dict 断言;数值后缀剥离;N/A→None;**乱序输入 → 升序输出**;无节 → [];`to_markdown_tables` 既有 16 用例不动(重构兜底)。
- 新 `test/core/ui/test_charts.py`:`TestChartBuilders` 断言 altair spec(`chart.to_dict()`):mark 类型集合(rule+bar / bar / line)、encoding 的 x/y 字段名、涨跌颜色(domain 值 [0,1] 或 condition 色板)、tooltip 存在;`TestIterDataCharts`:合成 stock_info → [(标题, chart)] 顺序与数量;空输入 → []。无 streamlit import。
- `test_display.py` 增接线测试(ast,同 theme wiring 约定):write_ui 数据 Tab 段调 `st.altair_chart`。
- 浏览器实测(用户):两主题图表可读性、红涨绿跌、缩放/悬浮。

## 5. 边界与不做

- 不计算 MA(指标节只有最新单值;序列计算=展示派生,超出薄层边界,spec 记为后续增强)。
- 不改 `stock_information` 文本 / formatter / LLM 上下文;requirements 不动(altair 5.5.0 满足)。
- 不引入 plotly(未安装,altair 足够)。

## 6. 回滚

- 全部新增文件 + display.py 数行;回滚 = 删 `charts.py`、test_charts.py、还原 display.py 与 data_markdown 的 parse_* 增量(重构部分如需回滚,`git revert` 该 commit,既有测试立即兜底)。无数据/迁移风险。
