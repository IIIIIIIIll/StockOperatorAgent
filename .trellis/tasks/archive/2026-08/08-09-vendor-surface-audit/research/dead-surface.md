# Research: 死面清单 + 裁剪建议

- **Query**: 不可达模块完整清单（文件名 + 行数 + 判定依据）+ 裁剪代价
- **Scope**: internal（grep 无任何引用者 = 死面）
- **Date**: 2026-08-09

## 死面清单（15 文件 / 1580 行，grep 全仓库无引用者）

### data_pipeline/ 死面（10 文件 / 401 行）

| 文件 | 行数 | 判定依据 |
|---|---|---|
| `data_pipeline/run_data_job.py` | 207 | CLI 入口（argparse）；grep `run_data_job` 仅 vendor 内部自引，非 vendor 零引用 |
| `data_pipeline/source_policy.py` | 22 | 唯一引用者 run_data_job |
| `data_pipeline/connectors/tushare_client.py` | 18 | 唯一引用者 run_data_job |
| `data_pipeline/jobs/canonical_job.py` | 27 | 唯一引用者 run_data_job |
| `data_pipeline/jobs/corporate_actions_job.py` | 21 | 唯一引用者 run_data_job |
| `data_pipeline/jobs/daily_job.py` | 21 | 唯一引用者 run_data_job |
| `data_pipeline/jobs/financial_job.py` | 22 | 唯一引用者 run_data_job |
| `data_pipeline/jobs/realtime_job.py` | 22 | 唯一引用者 run_data_job（其 extractors/tdx_quotes 同步死） |
| `data_pipeline/extractors/tdx_quotes.py` | 18 | 唯一引用者 realtime_job（已死） |
| `data_pipeline/normalizers/bars.py` | 23 | **全 vendor 内无引用者**（grep `normalizers.bars` 零命中）——孤立文件 |

### tdx_mcp/ 死面（5 文件 / 1179 行）

| 文件 | 行数 | 判定依据 |
|---|---|---|
| `tdx_mcp/tdx_concept_board.py` | 196 | 仅 import tdx_client；无任何导入者（grep `tdx_concept` 非 vendor 仅 UI 开关键名，非 import） |
| `tdx_mcp/tdx_data_enricher.py` | 533 | 同上 |
| `tdx_mcp/tdx_limit_up.py` | 195 | 同上 |
| `tdx_mcp/tdx_market_daily.py` | 136 | 同上 |
| `tdx_mcp/tdx_stock_analyzer.py` | 119 | 同上 |

以上 5 个均为 MCP 示例/批处理 CLI（argparse + `scripts.tdx_mcp.tdx_client`），彼此不互引，只共享 tdx_client——删除不影响 `get_market_intel` 直接 import 的 `tdx_client.py`(269) 与 `tdx_mcp/__init__.py`(18)（保留）。`tdx_mcp/` 簇 1466 行中 80% 是死面。

## 裁剪建议（不做实际删除，留给后续任务）

### 可删零风险候选：15 文件 / 1580 行（占 vendor 总量 37.4%）

删除后 import 闭包零变化（无引用者），`TdxSource`/`get_market_intel`/`get_trend_indicators`/`extra_indicators` 全部不受影响。screener/ 簇（330 行）单独裁决，见 screener-finding.md。

### 代价权衡：vendor 更新 vs 删除

- **更新流程**（VENDOR.md）：重新拷贝上游 `scripts/` 两子树覆盖 → 更新 commit → 冒烟 → 人工 diff 审阅。若保留死面：每次 vendor 同步都要在 diff 中审阅 37% 的惰性代码（且上游若改这些文件，与本地差异累积）。
- 若删除：下一次重拷后这些文件**复活**（上游仍含），需重复删除——一次性动作变永久手工负担。
- **建议中间路径**：删除 + 在 VENDOR.md 新增「本地删除清单」（15 文件路径 + 缘由），重拷流程按清单机械化重删（可用一行 `xargs rm` 脚本）。成本：VENDOR.md 增一段 + 更新流程多一步；收益：vendor 表面缩小 37%，后续 diff 审阅面同步缩小。
- 注意：删除后 `scripts/` 顶层与上游 `scripts/data_pipeline/` 不再同构，VENDOR.md 的「（无——拷贝时零改动）」表述需改为「本地删除清单见上」。

## Caveats

- 「死面」判定 = 非 vendor 代码零 import + vendor 内部唯一引用链亦死（run_data_job 支系）；`normalizers/bars.py` 是唯一连 vendor 内部都无引用者的完全孤立文件。
- 未探测文件系统级引用（shell 脚本/定时任务调 `run_data_job.py`）——仓库内无 `.sh` 等引用（grep 仅 .py）。
