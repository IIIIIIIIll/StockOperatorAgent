# Research: screener 可达性判定（quant API TODO 启示）

- **Query**: `data_pipeline/screener/`（run_screener.py + conditions.py）是否被任何本仓库代码引用 → 决定「Add my quant API」（TODO:2）能否复用
- **Scope**: internal（全仓库 grep + 离线 import probe）
- **Date**: 2026-08-09

## 判定：生产代码零引用；唯一引用者是测试文件

- **生产路径（core/、data_source/、agents/、scripts/、main.py）零引用**：grep `screener|run_screener|screen(` 非 vendor 命中仅 `test/data_source/test_tdx_screener.py` 与文档/spec 提及。screener 不在 TdxSource / 任何 LLM 工具 / 任何入口的 import 闭包内。
- **测试引用（唯一）**：`test/data_source/test_tdx_screener.py:12-13` import `conditions.golden_cross` + `run_screener.RESULT_COLUMNS, screen`。live 冒烟测试（需 TDX 服务器可达；非 skip、非 deprecated——testing spec「TDX Tests」一节将其与 test_tdx_source 并列为 live smoke）。
- **screener 簇构成**：`run_screener.py`(240) + `conditions.py`(80) + `__init__.py`(10) = 330 行。run_screener 的闭包 = code_mapping + fetch_realtime_watchlist + indicators/__init__(compute_all) + data_pipeline/tdx_client(TdxDownloader)——全部已属生产可达面，**screener 自身不新增任何独有 vendor 依赖**（tushare/run_data_job 等死面不在其内）。

## 离线可导入性（probe 实测）

`python -c` 注入 vendor 根后 `import scripts.data_pipeline.screener.run_screener` 与 `...conditions` 成功，模块级无网络/构造副作用（TdxDownloader 仅在函数体内构造）。`screen(codes, conditions, data_root, max_bars)` API 可用，输出契约由 `RESULT_COLUMNS` 钉死且有冒烟测试断言（每 (ts_code, timeframe) 一行、matched 列表与 hit_count 一致）。

## 对「Add my quant API」的启示

- **可复用（软件面）**：screener 是一个干净的可导入库——`screen()` + `CONDITIONS`（conditions.py）+ `golden_cross`，冒烟测试钉住输出契约；import 面与生产闭包完全重叠（零新增 vendor 依赖）。
- **硬约束（数据面）**：`screen()` 内部构造 TdxDownloader 走**实时网络**拉日K（`data_root` 缓存只写不读，见 tdx_source.py 缓存真相）——quant API 若复用它即绑定「TDX 可达时才能跑」的 live 语义；全市场扫描不适合运行时（test 文件 docstring 亦自述，见 design.md）。
- **取舍**：若 quant API 走「TDX 网络实时扫描」路线 → 直接复用 screener，保留现状即可；若走「离线/缓存优先」路线 → screener 的 live 下载模型不匹配，需非 vendor 重写，此时 screener/ 与 test_tdx_screener.py 一并进入可删清单（330 行 + 1 测试文件）。
- 删除 screener/ 的唯一代价：test_tdx_screener.py 会 ImportError，需同步删除或加 skip（此前 baseline 0F/494P/20S 会 +1 删除）。

## Evidence

- `grep -rn "screener\|run_screener" --include="*.py" . --exclude-dir=vendor` → 仅 test_tdx_screener.py（生产零命中）
- `test/data_source/test_tdx_screener.py` 全文（imports at :12-13；live 冒烟，非 skip）
- 离线 import probe：screener 两个模块导入成功、无副作用
- TODO:2「- Add my quant API」
