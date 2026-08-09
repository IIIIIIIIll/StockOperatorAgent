# vendor 表面审计：TdxSource 可达面 vs 死面

## Goal

只读研究任务（不改任何代码）：测绘 `data_source/chinese_mainland/tdx/
vendor/scripts/`（~2500 行 vendored tdx_quant）中**从本仓库代码实际
可达**的模块 vs 死面。输出：可达面 import 图 + 死面清单 + 对
「quant API」路线（TODO）的启示——screener 是否存活、裁剪建议与代价。

## Background / Confirmed Facts

- `TdxSource`（tdx_source.py）是 vendored tdx_quant 的薄包装：
  `ensure_vendor_on_path()` 把 vendor 根加进 sys.path（tdx_source.py:24-30），
  `TdxDownloader` 等经 `scripts.*` 绝对导入解析
- vendor 下两个大簇：`data_pipeline/`（connectors/extractors/jobs/
  materializers/normalizers/indicators/screener/run_data_job.py/
  tdx_client.py/fetch_realtime_watchlist.py）与 `tdx_mcp/`（tdx_client/
  tdx_concept_board/tdx_data_enricher/tdx_limit_up/tdx_market_daily/
  tdx_stock_analyzer）——后者被 `get_market_intel` 的 TdxMcpClient 使用
  （非 vendor 层直接 import？需确认——research 验证）
- 已知的非 vendor 重实现（f10_parser/mapping/adjust）说明 vendor 部分
  解析器已弃用（vendor 有 bug 冻结）——审计需区分「可达但弃用」与「不可达」

## Requirements

- **R1 可达面 import 图**：从非 vendor 代码（core/ + data_source 非
  vendor + scripts/）出发的 vendor import 闭包——逐模块列出入口、按
  簇统计行数；标注「可达+在用」「可达+弃用（有非 vendor 重实现）」
  「不可达（死面）」
- **R2 死面清单**：不可达模块完整清单（文件名 + 行数 + 判定依据）
- **R3 screener 判定**：`data_pipeline/screener/run_screener.py` 与其
  conditions 是否被任何本仓库代码引用——直接决定「quant API」能否复用
  它（TODO 启示）
- **R4 裁剪建议**：死面可删的候选清单 + 代价（更新 vendor 时 diff
  负担）；**不做实际删除**（留给后续任务）

## Acceptance Criteria

- [ ] 可达面 import 图（含行数统计与三态标注）落 research/ 目录
- [ ] 死面清单完整（逐文件判定依据）
- [ ] screener 可达性有明确结论（可达/不可达 + 证据）
- [ ] 零代码改动（只读研究；research/ 目录除外）
- [ ] 裁剪建议含代价评估（vendor 更新 vs 删除的权衡）

## Notes

- 研究任务：trellis-research 子代理执行，产出落 `.trellis/tasks/
  08-09-vendor-surface-audit/research/`；不做实现
- 判定方法建议：`grep` import 引用闭包 + `python -c` 试导入（不触发
  网络）；sys.path 注入的 `scripts.*` 引用形态要特别处理
- 结论影响后续任务（vendor 裁剪 / quant API），验收后由用户拍板
