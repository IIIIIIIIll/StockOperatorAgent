# UI 展示采集数据：新增「采集数据」Tab 原文渲染 stock_information

## Goal

采集到的原始数据（个股信息 + 技术指标 + TDX 实时情报，由
`build_stock_information` 拼接为 `stock_information`）目前只进入 LLM
上下文，用户界面完全不可见——五报告 Tab 只展示 LLM 产物。用户要求把
采集数据以"原文渲染、与现有 Tab 风格一致"的形式展示出来（确认结论：
范围=采集的原始数据；呈现=原文 markdown 渲染，类似现有 Tab，不做
表格/指标卡/折叠）。

## Requirements

### R1（新增「采集数据」Tab）

- `write_ui` 的 `st.tabs` 从五元组改为六元组：**「采集数据」放最前**，
  后接五个报告 Tab（顺序不变）。
- Tab 标题用模块级常量 `DATA_TAB_TITLE = "采集数据"`（display.py 内、
  `REPORT_TABS` 旁），与五报告契约并列。
- 五个报告 key → Tab 的渲染契约（`REPORT_TABS` / `report_tabs` dict /
  `iter_report_items`）**零改动**——数据 Tab 不参与报告 dispatch，
  插入位置不破坏相对顺序。

### R2（填充时机与原文渲染）

- 在 `build_stock_information(...)` 成功返回后、`graph.stream` 之前，
  立即填充数据 Tab：`st.header(DATA_TAB_TITLE)` + **`st.text(stock_information)`**
  （或等价保换行写法）。
- **为什么不用 `st.write`**：`stock_information` 是定宽文本布局
  （`StockOutputFormatter.format_stock_output` 的 overview 单行 + 60 根
  日K + 业绩报告，行间 `\n`），不是 markdown——`st.write` 走 markdown
  渲染会把单换行合并成空格，60 行日K 粘连成一段。`st.text` 等宽保换行，
  才是"原文"。报告 Tab 内容（LLM markdown）仍用 `st.write`，不变。
- 数据 Tab 在 enrichment 阶段（分析开始前）即就绪，天然与边算边渲染
  节奏一致：用户先看原始数据，再看报告逐 Tab 填充。

### R3（失败路径语义）

- `build_stock_information` 抛异常 → 既有 `st.error` + `return` 路径
  不变；此时数据 Tab 已被创建但**不填充内容**（数据不可用即不展示，
  不写占位文本）。
- 技术指标/实时情报的**降级占位文本**（"（无 ... 行情数据，跳过技术
  指标）"、"（未配置 TDX_API_KEY，跳过实时市场情报）"）属于
  `stock_information` 原文的一部分，照常展示——如实反映采集结果。

### R4（既有行为不变）

- 五个报告 Tab 的边算边渲染契约、`_report_content` 值形态消化、
  `progress_updater` 使用、错误守护均不变。
- `REPORT_TABS` 顺序注释更新为"五报告**相对**顺序 = st.tabs 中报告
  Tab 的创建顺序（数据 Tab 插入不影响）"。
- display.py 保持薄渲染层：不新增数据解析/格式化逻辑（`st.text`
  原文渲染即终态）。

## Acceptance Criteria

- [ ] `st.tabs` 六元组：首项「采集数据」，后五项报告标题顺序不变
- [ ] `DATA_TAB_TITLE = "采集数据"` 常量存在且被 `write_ui` 使用
- [ ] `build_stock_information` 成功后、stream 前填充：header + 原文
      文本（换行保留，`st.text`）
- [ ] 数据不可用（异常路径）→ 不填充、不占位文本，既有 `st.error` +
      return 不变
- [ ] 五个报告 key 的渲染契约零改动（`REPORT_TABS` 顺序不变，
      `report_tabs` dict 不变）
- [ ] 既有 display 测试（key 检查 / enrichment 接线 / 增量渲染映射）
      仍绿；新增测试覆盖 `DATA_TAB_TITLE` 常量与报告契约不受数据 Tab
      插入影响
- [ ] 全量回归 0 新增失败（基线 0F/112P/20S）

## Notes

- Lightweight task：PRD-only（改动集中在 `core/ui/display.py` +
  `test/core/ui/test_display.py`，无跨层改动）。
- 关键认知（2026-08-02）：`stock_information` 是定宽文本不是 markdown，
  `st.write` 合并单换行 → 必须 `st.text`/`st.code` 级渲染才保原文。
- 不做：采集数据分段展示（三段拆 Tab/expander）、表格/指标卡渲染、
  数据 Tab 内 spinner、展示前数据二次加工（超出本任务范围）。
