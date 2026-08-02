# Design：F10 盈利能力指标分节解析并入 stock_information

## 1. 背景与约束

- F10 财务分析页面除【主要财务指标】外还有【盈利能力指标】【偿债能力
  指标】【发展能力指标】等分节（银行股另有资本充足/贷款五级分类等），
  全部从未解析。每节与【主要财务指标】同构：年报表 + 季度表两张子表，
  表头 `财务指标(%)`（注意与【主要财务指标】节表头 `财务指标` 不同）。
- 约束：vendor 零改动（VENDOR.md）；`performance_reports` 15 列契约
  不动（不把比率塞进字段）；raw 缓存零网络读取（fetch_company_finance_raw
  已存在，08-02-fix-f10-quarterly-data 产物）。
- 实测（2026-08-02）：600519 盈利能力节 6 项通用指标（营业毛利率/营业
  净利率/营业利润率/成本费用利润率/总资产报酬率/加权净资产收益率）；
  000001 另有银行特有项（净息差/净利差/成本收入比等）。值均为百分数
  纯数值（无 % 后缀、无单位）。

## 2. 数据流

```
F10 raw 文本 (company_info_raw 缓存, 零网络)
    → f10_parser.parse_indicator_section(text, '【盈利能力指标】')   # 新，复用表并入逻辑
    → core/llms/tools/get_financial_indicators.py::get_financial_indicators(ticker)  # 新工具
    → build_stock_information 第四段（get_stock_info → 技术指标 → 财务指标 → 情报）
    → LLM 上下文 + UI 采集数据 Tab（data_markdown 加 marker 独立成节）
```

## 3. 组件设计

### 3.1 `f10_parser` 泛化：`parse_indicator_section(text, section_name)`

- 现状 `parse_finance_indicators_all_tables(text)` 内部硬编码
  `【主要财务指标】`。重构：提取公共核心
  `_parse_section_block(text, section_name)`（定位分节 → 块截断到下一个
  `\n【` → 日期头子表并入 → (metric, period) 去重），
  `parse_finance_indicators_all_tables` 变成薄包装
  `_parse_section_block(text, '【主要财务指标】')`——既有测试零改动。
- 新 `parse_indicator_section(text, section_name) -> pd.DataFrame`：
  与 all_tables 同 schema（metric/period/value_raw/value_num），只是
  section_name 参数化。分节定位 `text.find(section_name)`——注意
  `【主要财务指标】` 是 `【1.财务指标】` 的子串？不——`find('【主要财务
  指标】')` 是全串匹配，`【1.财务指标】` 不含 `【主要财务指标】`，
  不会误定位。反之 `parse_indicator_section(text, '【盈利能力指标】')`
  也不会匹配到别处（该字符串唯一）。
- 表头差异注意：日期头行判定（≥2 个日期 cell）与表头文本无关——通用；
  盈利能力节表头 `财务指标(%)` 是数据行？不——表头行含 ≥2 日期 cell，
  命中日期头分支（设为 periods），不是数据行。指标行（`营业毛利率` +
  数值）无日期 cell → 正常数据行。逻辑天然兼容。

### 3.2 新工具 `core/llms/tools/get_financial_indicators.py`

```python
INDICATOR_SECTION = '【盈利能力指标】'

def get_financial_indicators(ticker: str) -> str:
    """F10 盈利能力指标摘要（最新报告期），供 agent 阅读。

    失败降级不 raise（error-handling 约定）：raw 缓存缺失/解析失败/
    无该节 → 占位文本。工具在函数内 import（无模块级副作用，同
    get_trend_indicators 约定）。
    """
    from data_source.chinese_mainland.tdx.tdx_source import TdxSource
    from data_source.chinese_mainland.tdx.f10_parser import parse_indicator_section

    src = TdxSource()
    raw = src.fetch_company_finance_raw(ticker)
    if not raw:
        return f"（无 {ticker} 的盈利能力指标，跳过）"
    df = parse_indicator_section(raw, INDICATOR_SECTION)
    if df.empty:
        return f"（无 {ticker} 的盈利能力指标，跳过）"
    # 最新报告期：period 字典序最大（ISO 字符串）
    latest = df["period"].max()
    sub = df[df["period"] == latest].set_index("metric")["value_num"]
    lines = [f"【盈利能力指标（{latest}）】"]
    for metric in sub.index:  # 保持 F10 顺序而非字典序
        lines.append(f"{metric}: {fmt_number(sub[metric], 2)}%")
    return "\n".join(lines)
```

- 输出格式与 get_trend_indicators 同构（`【段名（日期）】` + `标签: 值`），
  数据行均为 `Key: value` 形态——data_markdown 的 `_pairs` 天然解析
  （`营业毛利率: 89.76%` → (营业毛利率, 89.76%)，KEY_LABELS 未知键原样
  透传——中文键无需映射）。
- **值带 % 后缀**（与 F10 原文无 % 不同，展示层加）——纯文本约定，让
  LLM 明示百分数；与 get_trend_indicators 的 `MA5=1.00` 风格不同但不
  冲突（趋势指标值有单位语义，此处 % 是展示必要）。
- 保持 F10 指标顺序（sub.index 遍历）而非按值排序——原始顺序是财务
  语义相关分组。

### 3.3 `build_stock_information` 加第四段

```python
stock_information += "\n" + get_financial_indicators(target_ticker)
```

- 位置：get_trend_indicators 之后、get_market_intel 之前。progress 回调
  加第四步（"正在获取 ... 的财务指标..."）。
- 函数内 import（同既有三工具）。

### 3.4 `data_markdown` 加 marker

- `_SECTION_TITLES` 加 `"profitability": "盈利能力指标"`；分节判断加
  `line.startswith("【盈利能力指标（")` → 新节。
- 不混入技术指标节的原理：无 marker 时该行落入"当前节"（技术指标节），
  指标行追加其表格——加 marker 后独立成节、标题正确。
- 通用性：未来加偿债/发展能力段 = 各加一个 marker（或后续考虑
  "任意【...（日期）】开头的行都起新节"的通用规则，本任务不做）。

### 3.5 不改的部分

- `performance_reports` / `StockPerformanceReport` / `sales_gross_margin`
  恒 NaN 现状——毛利率经 LLM 上下文提供，不改 ZODB 数据模型。
- agent prompt / State / 图结构。
- overview（不需要这些指标）。

## 4. 测试设计

- `test/data_source/test_f10_indicator_sections.py`（或并入 test_f10_parser.py）：
  - `parse_indicator_section` 对真实 raw 文本（600519/000001）：
    600519 → 6 项通用指标、9 期含季度；000001 → 含净息差等银行特有项。
  - 合成文本：无该分节 → 空；分节在页面中部（前有【主要财务指标】）
    → 块截断正确（后续【发展能力指标】不入）。
  - `parse_finance_indicators_all_tables` 既有测试零改动（重构保兼容）。
- `test/core/llms/tools/test_get_financial_indicators.py`：
  - 真实缓存 → 输出 `【盈利能力指标（...）】` + `营业毛利率: xx.xx%`。
  - raw 缺失（monkeypatch fetch_company_finance_raw → None）→ 占位
    文本不 raise（house style 无 mock 框架——用 monkeypatch 或清缓存
    路径？TdxSource 方法 patch 即可，与 test_get_market_intel 清 env
    同风格）。
- `test_committee_enrichment.py`：`test_contains_technical_indicators_and_
  market_intel` 补【盈利能力指标】段断言。
- `test_data_markdown.py`：合成 stock_info 含 `【盈利能力指标（...）】`
  → 独立成节渲染为表格（标题"盈利能力指标"）。

## 5. 兼容性与风险

- **风险 1：重构 f10_parser 破坏既有测试**——`parse_finance_indicators_
  all_tables` 行为不变（薄包装），10 个既有用例必须全绿。
- **风险 2：盈利能力节定位串误匹配**——`【盈利能力指标】` 字符串唯一
  （实测），find 安全；块截断 `\n【` 排除后续分节。
- **风险 3：银行股指标多（净息差等）**——跟随解析全显示；LLM 上下文
  略增，可接受。
- **风险 4：% 后缀双写**——F10 原文值无 %（89.76），工具加 %；若某值
  原文带 %（未见）会变 `89.76%%`——解析时 `_to_num` 已归一纯数值，
  无此风险。
- **不回退**：vendor/overview/ZODB 模型零改动；agent 结构零改动。

## 6. 边界

- 其他分节（偿债/发展/资本充足等）不做——解析器已按节名参数化，
  后续 = 新工具 + 组装点一行 + data_markdown marker 一行。
- UI 采集数据 Tab 不新增逻辑（data_markdown 通用渲染）。
