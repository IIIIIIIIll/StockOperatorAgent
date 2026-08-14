# Python→TS 功能差距审计（phaseout 前置）

## Goal

开始 Python phaseout 前，对 Python 业务代码做**逐功能点**差距审计：列出每个 Python 实现的功能，逐项确认 TS 侧等价物的存在性、完整度与行为差异，产出带 file:line 证据的差距清单，作为后续 phaseout 计划（移植顺序 / 删除范围 / 阻断项）的唯一输入。

**纯审计任务：不修改任何业务代码。** 发现 → 报告 → 留档；移植/删除另开 task。

## Background

- 08-13-ts-capability-completion 已补齐：亿信 REST 客户端 + analyst 预抓、mcp 实时情报、qfq 生产链、服务端安全修复——TS 已是最终唯一实现（ts/index.md「能力接线」节）。
- 08-13-full-codebase-review 是质量/安全审查（已归档），**不是**功能差距审计；本任务角度不同：功能对等性，不重复审质量。
- 用户要求：spawn subagents，逐文件不留死角。

## Scope

### In scope（Python 业务功能面 + TS 对照面）

| 功能域 | Python 侧 | TS 对照面 |
|---|---|---|
| 入口/编排 | `main.py`、`core/investment_committee.py`、`core/role_registry.py` | `ts/src/committee.ts`、`ts/src/events.ts`、`ts/app/App.tsx`、`ts/app/lib/runner.ts` |
| 数据采集/汇总 | `core/data_acquisition.py`、`core/legacy_akshare.py`、`core/stock_output_formatter.py` | `ts/src/webCollect.ts`、`ts/src/pipeline.ts`、`ts/src/overview.ts`、`ts/src/reports.ts` |
| LLM 基础设施 | `core/llms/`（llm_factory、prompt、tool_loop、progress、retry） | `ts/src/llm.ts`、`ts/src/prompt.ts`、`ts/src/toolLoop.ts`、`ts/src/progress.ts`、`ts/src/retry.ts` |
| LLM 工具 | `core/llms/tools/`（13 文件） | `ts/src/webSearch.ts`、`ts/src/billsTools.ts`、`ts/src/mcp.ts`、`ts/src/f10.ts`、`ts/src/indicators.ts` |
| Agent | `agents/base.py` + `agents/chinese_mainland/`（7 agent） | `ts/src/agents.ts` |
| UI | `core/ui/`（display、charts、data_markdown、theme） | `ts/app/` screens/components/theme |
| 数据源 | `data_source/chinese_mainland/tdx/` 非 vendor 6 文件、`billions/client.py`、`akshare/fetch_stcok_data.py` | `ts/src/tdx/`（quoteClient、xdxr、f10Client）、`ts/src/billionsClient.ts`、`ts/src/adjust.ts` |
| 存储/结构 | `data_storage/chinese_mainland/ZODBStorage.py`、`data_structure/chinese_mainland/`（5 文件） | `ts/src/store.ts`、`ts/src/store-memory.ts` |
| 工具/配置/脚本 | `utils/`（8 文件）、`scripts/`（2 文件）、`ts/tools/export_fixtures.py` | `ts/src/format.ts`、`ts/src/log.ts`、`ts/app/lib/settings.ts` 等 |

### Out of scope

- `data_source/chinese_mainland/tdx/vendor/` — 上游 tdx_quant 快照（仅审 `tdx_source.py` 导入接缝）
- Python 测试套件 `test/**`（保留作契约参考，不审）；TS 测试套件不审（引用作证据）
- `database/*.fs*`、`logs/`、`.env`、`.trellis/`、`.claude/`、`.omp/`、`ts/node_modules`、`ts/app/dist`、`.expo`
- 已知决策不做的功能（08-13）：北交所、akshare 备用路径——标注 `BY_DESIGN`

## Requirements

1. **逐功能点**：每个 Python 模块输出能力清单（公开函数/类/入口/行为），逐项查 TS 等价物。
2. **差距状态分级**：`FULL`（等价且对齐）/ `PARTIAL`（有缺失或行为差异，列出具体差异）/ `MISSING`（无等价物）/ `BY_DESIGN`（决策不做，注明出处）。
3. **证据**：每条差距带 Python file:line + TS 侧证据（存在给 file:line，缺失给搜索过程说明）。
4. **行为差异**：PARTIAL 需列语义差异（格式、默认值、错误处理、边界、超时、重试等）。
5. **phaseout 阻断判定**：每条差距标注 `BLOCKER`（删 Python 前必须补）/ `NON_BLOCKER`。
6. **防假阳性**：grep 全仓库找等价物（名字不同不算 MISSING）；遵守 guides/index.md 三模式。
7. **参考 spec**：对照 `ts/index.md`（事件协议/流式/代理/图表/能力接线）核对「能力接线点」。

## Acceptance Criteria

- [x] 8 个审计分片全部完成，每个产出 `research/<slice>.md`（8/8）
- [x] 差距清单覆盖全部 in-scope Python 功能面（~300 功能点，0 结构性缺口）
- [x] 每条差距：状态分级 + 证据 file:line + 阻断判定
- [x] 汇总 `research/00-gap-report.md`：差距总表 + 4 BLOCKER + 8 项需用户确认 + 优先级 + phaseout 顺序
- [x] 工作树干净（零业务代码改动）

## 审计结论（供 phaseout 任务使用）

- **BLOCKER（4）**：B1 亿信 caps 死控件（三片交叉印证，接线一行级）；B2 日K 表缺涨跌幅/换手率列；B3 按日涨跌幅柱图缺失；B4 财务跨期趋势折线缺失（B2-4 数据全在手，纯 UI 补齐）。
- **MISSING 5 项中 4 项为 Python 死代码**（fetch_minute/fetch_index/StockInfo/脚本），随 Python 删；1 项为 B4。
- **需用户确认 8 项**（C1 web 亿信预抓注入、C2 M3 契约口径、C3 无 key 谓词、C4 overview 命名、C5 LangSmith、C6 Node 探针链路、C7 配置持久化、C8 freshness 门接线）——见 00-gap-report.md §3。
- 详细证据链：8 份分片报告 + 00-gap-report.md（§2 BLOCKER 已二次核实）。

## Notes

- 本任务不修复、不移植、不删除；差距清单与 BLOCKER 供后续 phaseout task 执行（B1 接线 / UI 补齐 / 分域删除）。
- 报告语言：中文（符号/术语可英文）。
