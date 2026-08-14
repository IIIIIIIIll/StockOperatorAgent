# Python 分域删除（child E）

## Goal

在 A/B/C/D 全部完成后，按依赖顺序删除 Python 业务代码，使仓库成为纯 TS 实现。每域删除独立可验证（vitest + `tsc --noEmit` + Python 测试回归对照），删除清单与审计报告建议一致。

## Background

- 审计证据：`archive/2026-08/08-14-py-ts-gap-audit/research/*.md`（00-gap-report.md §4/§5 为删除清单与顺序主索引）。
- 前置：A-D（BLOCKER 处置 + 接线）必须已完成——删除前 TS 已具备全部被删能力。
- 决策输入：C2（M3 契约注释更新）、C4（overview 命名注释修正）在本任务收尾落实。

## 删除域（顺序执行，每域独立 commit）

| 域 | Python 文件 | 依据 |
|---|---|---|
| E1 死代码面 | `core/legacy_akshare.py`、`data_source/chinese_mainland/akshare/fetch_stcok_data.py`、`core/llms/tools/mcp_intel_cache.py`、`scripts/backfill_f10_quarters.py`、`scripts/export_seed_002027.py`、`data_structure/.../StockInfo.py`、ZODBStorage 17:00 门（check_need_update_overview/set_overview_updated_now）、`tdx_source.py` fetch_minute/fetch_index | 审计 py-data-acq #14-23、py-data-source M1/M2、py-storage-structure、py-utils-scripts |
| E2 数据源面 | `data_source/chinese_mainland/tdx/`（reports/overview/tdx_source/mapping/f10_parser/adjust）、`billions/client.py`、`data_storage/`、`data_structure/` 其余 | 审计 py-data-source（FULL 33/PARTIAL 2 处置后） |
| E3 工具/agent 面 | `core/llms/tools/`、`core/llms/`、`agents/` | 审计 py-llms、py-agents |
| E4 编排/UI 面 | `core/`（investment_committee/role_registry/data_acquisition/stock_output_formatter/ui）、`utils/`、`main.py` | 审计 py-orchestration、py-ui、py-utils-scripts |
| E5 收尾 | C2：agents.ts 头注释更新契约声明；C4：overview.ts 头注释修正命名漂移；spec 更新 | 审计决策 |

## Requirements

1. **每域删除前**：跑 `npx vitest run`（ts/ 目录）+ `npx tsc --noEmit`；对照审计报告确认被删能力在 TS 有 FULL/PARTIAL(处置后) 等价物。
2. **删除方式**：`git rm` 文件 + 清理该域 Python 测试（test/ 对应文件）——Python 测试套件随对应域删除，不迁移（TS 测试已覆盖）。
3. **禁止**：删除审计报告中未列出的文件；删除 vendor 目录；删除 `ts/tools/export_fixtures.py` 相关 fixtures（静态 JSON 被 9 个 TS 测试消费，冻结保留）。
4. **依赖检查**：删除前 grep 确认无残留 import/引用（Python 内部引用随域删除；TS 对 Python 零引用）。
5. E1 先行且必须零风险（死代码无调用者）；E2-E4 每域结束跑全量 vitest + tsc + 冒烟（probe.mts 采集一条）。
6. 收尾更新 `.trellis/spec/ts/index.md` 状态（Python 已 phaseout）与 README 若涉及。

## Acceptance Criteria

- [ ] 删除文件清单 == 审计报告建议（git diff 可核对，0 意外删除）
- [ ] 每域删除独立 commit，commit message 标注域号
- [ ] 最终 `git rm` 后 `ts/` 下 vitest 全绿 + `tsc --noEmit`
- [ ] 仓库根无 `main.py`/`core/`/`agents/`/`data_source/`/`data_storage/`/`data_structure/`/`utils/` 业务代码（测试目录随删）
- [ ] spec/README 状态更新完成；C2/C4 收尾落实
- [ ] 工作树干净

## Out of scope

- A-D 的接线/补齐工作（各自 child）
- 北交所/akshare/mcp_cache/is_trading_time（BY_DESIGN，删除即处理）
- LangSmith 遥测（C5 接受无遥测）
- Python 测试迁移（随域删除）
