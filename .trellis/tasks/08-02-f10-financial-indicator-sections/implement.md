# Implement：F10 盈利能力指标分节解析并入 stock_information

## 执行顺序

### 1. `f10_parser.py` 泛化（保兼容）

- 提取 `_parse_section_block(text, section_name)`：定位分节 → 块截断
  （`\n【`）→ 日期头子表并入 → (metric, period) 去重。
- `parse_finance_indicators_all_tables` 改薄包装
  `_parse_section_block(text, '【主要财务指标】')`。
- 新增 `parse_indicator_section(text, section_name)`（薄包装别名，schema
  同 all_tables）。
- 跑既有 10 个 f10_parser 测试必须全绿。

### 2. 新工具 `core/llms/tools/get_financial_indicators.py`

- `get_financial_indicators(ticker) -> str`：raw 缓存 → 解析【盈利能力
  指标】节 → 最新报告期每指标一行 `名称: 值%`；失败降级占位不 raise；
  函数内 import；`utils.formatting.fmt_number` 单点格式化。

### 3. `build_stock_information` 加第四段

- get_trend_indicators 之后、get_market_intel 之前加
  `get_financial_indicators(target_ticker)`；progress 加第四步文案。

### 4. `data_markdown` 加 marker

- `_SECTION_TITLES` 加 `"profitability": "盈利能力指标"`；分节判断加
  `line.startswith("【盈利能力指标（")`。

### 5. 测试

- `test_f10_parser.py` 追加 TestParseIndicatorSection 类（真实文本
  600519/000001 + 合成：无节/块截断）。
- 新 `test/core/llms/tools/test_get_financial_indicators.py`（真实缓存
  输出形态 + raw 缺失占位降级）。
- `test_committee_enrichment.py` 补段断言。
- `test_data_markdown.py` 补盈利能力节 marker 用例。

### 6. 验证与收尾

- 全量回归（先确认无 streamlit 在跑——flock 互斥）。
- spec 更新：data_source/index.md（f10_parser 泛化 + 分节能力）、
  core/index.md（build_stock_information 四段组装）、core/index.md UI 段
  （data_markdown profitability marker）。
- journal + commit + 归档。

## 验证命令

```bash
python -m pytest test/data_source/test_f10_parser.py -v          # 既有 10 + 新增全绿
python -m pytest test/core/llms/tools/test_get_financial_indicators.py -v
python -m pytest test/core/test_committee_enrichment.py test/core/ui/test_data_markdown.py -v
python -m pytest   # 全量（确认无 app 在跑）
```

## 评审门

- [ ] f10_parser 既有 10 用例重构后仍绿
- [ ] parse_indicator_section 真实文本：600519 6 项 / 000001 含银行特有项
- [ ] get_financial_indicators 输出 `【盈利能力指标（日期）】` + `名称: 值%`
- [ ] build_stock_information 四段齐全、顺序正确
- [ ] data_markdown 盈利能力节独立成节
- [ ] 全量 0F/188P/20S 基线 +新用例

## 回滚点

- 每步独立提交；f10_parser 重构与工具/组装点改动可分 revert。
