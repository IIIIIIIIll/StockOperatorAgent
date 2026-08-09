# VENDOR 说明：tdx_quant

- **上游**: https://github.com/henrylin99/tdx_quant
- **Commit**: `b95d8e915aa2fa4b703e64c38ca48eb51a6fa96e`（main, 2026-08-02 快照）
- **引入方式**: vendor 快照（上游无打包文件，pip 不可装；保持本仓库 clone-and-run 自包含）
- **范围**: `scripts/data_pipeline/` + `scripts/tdx_mcp/` 全子树（55 个 .py 文件）
  - 不含 `frontend/`、`tests/`、根级 README / PLAN_INTERFACES.md / pytest.ini
- **导入机制**: 本目录为 vendor 根，`tdx_source.py` 模块级一次性
  `sys.path.insert(0, vendor_root)`；上游绝对导入 `scripts.data_pipeline.*` /
  `scripts.tdx_mcp.*` 原样可用，**未改动任何上游代码**。
- **依赖**: `pytdx==1.72`（requirements.txt 新增，唯一新依赖）；pandas/pyarrow/
  numpy/httpx/tqdm/tabulate 均已存在于 requirements.txt
- **更新流程**: 重新拷贝上游 `scripts/` 两子树覆盖本目录 → 更新本文件 commit →
  运行 `python3 -m pytest -q test/data_source/test_tdx_source.py` 冒烟 → 人工审阅
  git diff 中上游代码变化（严禁本文件内出现与上游的静默分叉）

## 与上游差异

（无——拷贝时零改动）

## 可达面 vs 死面（2026-08-09 只读审计）

55 个 .py / 4219 行按本仓库实际引用闭包分三态（完整证据：
`.trellis/tasks/archive/2026-08/08-09-vendor-surface-audit/research/`）：

- **(a) 可达+在用：36 文件 / 2213 行** — `TdxDownloader` 闭包（tdx_client、
  extractors、jobs、materializers、normalizers/canonical、code_mapping）、
  `indicators/`（get_trend_indicators/extra_indicators 用）、`tdx_mcp/
  tdx_client`（TdxMcpClient——**非 vendor 层直接 `from scripts.tdx_mcp.
  tdx_client import TdxMcpClient`，无包装层**，TDX_MCP_ENABLED 开关门控）
- **(b) 可达+弃用：1 文件 / 96 行** — `extractors/tdx_company_info.py`
  （F10 季度解析被非 vendor 的 f10_parser.py 取代，仍作 fallback 执行）
- **(c) 不可达死面：15 文件 / 1580 行** — `run_data_job.py` + 其独占支系
  （tushare_client、source_policy、canonical/corporate_actions/daily/
  financial/realtime jobs、tdx_quotes）、`normalizers/bars.py`、tdx_mcp
  的 5 个 CLI 脚本（data_enricher/concept_board/limit_up/market_daily/
  stock_analyzer）
- **screener**（`data_pipeline/screener/`）：生产零引用，唯一消费是
  test_tdx_screener.py（live 冒烟）；可无副作用导入，quant API 可复用
  `screen()`/`CONDITIONS`（live 语义，缓存只写不读）

未裁剪（审计结论留档）：死面删除零风险（闭包不变），但更新流程重拷
上游会复活已删文件——若日后删除，需在本文件记「本地删除清单」机械化
重删。screener 留删取决于 quant API 路线。
