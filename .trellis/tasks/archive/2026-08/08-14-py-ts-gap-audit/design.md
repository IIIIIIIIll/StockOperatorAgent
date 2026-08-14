# Design：Python→TS 功能差距审计

## 1. 分片设计（8 个研究分片 + 1 汇总）

按**功能域**分片，每个 Python 文件恰好一个分片认领（0 orphan / 0 dupe）；TS 侧为对照面，跨片只读引用。

| # | 分片 | Python 认领（行数） | TS 对照面 |
|---|------|---------------------|-----------|
| 1 | py-orchestration | main.py(27)、core/investment_committee.py(185)、core/role_registry.py(200) | committee.ts、events.ts、App.tsx、lib/runner.ts |
| 2 | py-data-acq | core/data_acquisition.py、core/legacy_akshare.py(252)、core/stock_output_formatter.py(42) | webCollect.ts、pipeline.ts、overview.ts、reports.ts |
| 3 | py-llms | core/llms/ 全部（llm_factory、prompt、tool_loop、progress、retry）+ core/llms/tools/ 全部 13 文件 | llm.ts、prompt.ts、toolLoop.ts、progress.ts、retry.ts、webSearch.ts、billsTools.ts、mcp.ts、f10.ts、indicators.ts |
| 4 | py-agents | agents/base.py(142) + agents/chinese_mainland/ 7 agent(430) | agents.ts(539) |
| 5 | py-ui | core/ui/ 全部（display 527、charts 202、data_markdown 384、theme 122） | screens/DataScreen、SettingsPanel、ReportScreen、components/IndicatorChart、ReportContent、MarkdownText、theme.ts |
| 6 | py-data-source | data_source/tdx/ 非 vendor 6 文件（reports 196、overview 274、tdx_source 236、mapping 95、f10_parser 127、adjust 111）、billions/client.py(214)、akshare/fetch_stcok_data.py(47) | tdx/quoteClient.ts、tdx/xdxr.ts、tdx/f10Client.ts、billionsClient.ts、adjust.ts |
| 7 | py-storage-structure | data_storage/ZODBStorage.py(104)、data_structure/ 5 文件（ChinaStock 86、StockInfo 16、StockOverview 50、StockPerformanceReport 43、ChinaStockData 39） | store.ts、store-memory.ts |
| 8 | py-utils-scripts | utils/ 8 文件（constants、formatting、market_time、time_helper、env_file、runtime_config、state、billions_config）、scripts/ 2 文件、ts/tools/export_fixtures.py | format.ts、log.ts、lib/settings.ts、gates.ts、tdx 相关工具面 |

## 2. 输出契约（每个分片 → `research/<slice>.md`）

每个分片报告必须包含：

1. **认领文件清单**（确认逐文件读过）
2. **功能点差距表**：逐 Python 模块列能力点（公开函数/类/入口/副作用行为），每行：
   - `功能点` — Python 侧名称 + file:line
   - `TS 等价物` — 存在则 file:line；缺失则 `MISSING`
   - `状态` — FULL / PARTIAL / MISSING / BY_DESIGN
   - `差距详情` — PARTIAL 列语义差异（格式/默认值/错误处理/超时/重试/边界）；BY_DESIGN 注明决策出处
   - `阻断` — BLOCKER（删 Python 前必须补）/ NON_BLOCKER
3. **MISSING/PARTIAL 汇总清单**（可行动：移植时照此逐条）
4. **spec 符合性结论**（能力接线点是否存在：ts/index.md「能力接线」节核对）

## 3. 防假阳性规则（所有分片强制）

- 找 TS 等价物必须 grep 全仓库（含 ts/app、ts/test），名字不同但功能等价不算 MISSING
- 遵守 guides/index.md：信任边界混淆、忽略设计注释、变量误读三模式
- BY_DESIGN 仅限：北交所（App.tsx 拦截）、akshare 备用路径（08-13 用户决策）、明确注释声明「不移植」的能力
- 拿不准 → 标注「需人工确认」而非臆断

## 4. 汇总（主 agent 完成）

`research/00-gap-report.md`：按功能域差距总表（MISSING/PARTIAL 全列、FULL 计数汇总）+ 移植优先级建议 + phaseout 顺序建议。

## 5. 验证

- slices 矩阵核对：8 片认领覆盖全部 in-scope Python 文件，0 orphan / 0 dupe
- 汇总阶段对关键 MISSING/BLOCKER 二次核实（读代码确认）
- 工作树干净（零业务代码改动）
