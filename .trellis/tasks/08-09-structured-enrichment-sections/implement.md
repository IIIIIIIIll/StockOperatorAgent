# 执行：结构化采集段（enrichment 文本旁挂结构化 sections）

> 复杂任务三件套齐备 → 可 start。实现走 trellis-implement 子代理（主会话
> dispatch，prompt 前缀 `Active task: <task path>`）；trellis-check 收尾。

## 执行顺序

### Step 1 — data_markdown 结构化半（parse-once）

- `ParsedStockInfo` dataclass + `parse_stock_info(text)`（iter_sections 一次
  + `_rows_from_sections` 推导 daily/financial）
- `parse_daily_rows` / `parse_financial_rows` / `to_markdown_tables` 重构为
  内部复用（`_rows_from_sections` / `render_sections`），**公共签名与输出
  不变**
- 新增单测：parse_stock_info 对既有 fixture 文本产出与 parse_* 一致的行；
  空/占位文本 → 空 sections；**新段演示**：合成文本 + 一行 marker 注册 →
  render_sections 自动出通用表格
- 验证门 1：`pytest test/core/ui/test_data_markdown.py -q` 全绿（既有 +
  新增）

### Step 2 — charts 入口改造

- `iter_data_charts(parsed: ParsedStockInfo)`——内部 chart 函数不变，只改
  入口与数据来源（parsed.daily_rows / parsed.financial_rows）
- test_charts.py：文本入口用例改为 `parse_stock_info(text)` 后传入
  （断言性修改；图表结构断言不变）
- 验证门 2：`pytest test/core/ui/test_charts.py -q` 全绿

### Step 3 — display 采集 Tab 改造

- data tab：`parsed = data_markdown.parse_stock_info(stock_info)` →
  `charts.iter_data_charts(parsed)` + `render_sections(parsed.sections)`；
  graph 输入仍传 text 原样
- test_display.py：源文本断言（charts.iter_data_charts(stock_info) 行、
  渲染顺序）断言性更新；display 其余测试不动
- 验证门 3：`pytest test/core/ui/test_display.py test/e2e/ -q` 全绿
  （e2e mock 模式——种子文本流经 parse_stock_info，表格/Tab 断言即
  展示等价证明）

### Step 4 — 全量回归 + spec 更新 + 提交

- `pytest` 全量（基线 515P/20S，不新增失败）
- spec 更新：core/index.md「Streamlit UI 段」——采集 Tab 消费
  parse_stock_info/render_sections；「UI E2E 测试框架」段落如涉及
  to_markdown_tables 契约同步；architecture.md 数据流行（若含
  data_markdown 描述）
- 提交：`refactor(ui): 采集段结构化——parse-once 边界，UI 不再解析文本`

## 验证命令速查

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-09-structured-enrichment-sections
pytest test/core/ui/test_data_markdown.py -q                 # Step 1 后
pytest test/core/ui/test_charts.py -q                        # Step 2 后
pytest test/core/ui/test_display.py test/e2e/ -q             # Step 3 后
pytest                                                       # Step 4 全量
```

## 回滚点

- 每步独立可 revert；Step 1 内部重构（公共签名不变）由 test_data_markdown
  兜底，Step 2/3 为展示入口切换
- e2e 非绿 = 展示等价被破坏 → 停，diff 渲染输出（表格结构/Tab 内容）
