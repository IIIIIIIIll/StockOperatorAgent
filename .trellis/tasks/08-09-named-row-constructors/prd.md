# 命名行构造：位置构造 DataFrame→dataclass 改列名映射

## Goal

6+ 处 `StockOverview(*list(row.values()))` / `ChinaStockData(*list(
row.values()))` 位置构造（data_acquisition.py:164/214/232/321、
scripts/backfill_f10_quarters.py:77）——字段顺序 = 承重契约，由
data_source 层的列序常量钉住（overview.py:39-45、reports.py:46-51）。
列序一变即**静默写垃圾**（akshare 曾插入列被 YJBB_COLUMN_MAP 拦截过）。
目标：命名列映射构造（沿用 YJBB_COLUMN_MAP 模式），列序漂移从静默
损坏 → 响亮 KeyError。

## Background / Confirmed Facts

- TDX 概览恰 22 列含代码列（无 `[1:]` 切片）；akshare 23 列需 `[1:]`
  （data_acquisition.py:214/232）——两种入口列序不同，位置构造极易错位
- `YJBB_COLUMN_MAP`（legacy_akshare.py:16-31）是已验证的命名映射先例
  （含存在性断言，防列名漂移）
- 顺带修复项（同文件）：`ChinaStock.info` 死字段（ChinaStock.py:19）；
  `ChinaStockData.date/ticker` 类型 `object` vs 他处 `str`；
  StockOverview/StockInfo 语义孪生字段（market_cap/circulating_market_cap
  vs market_cap/float_market_cap）
- 位置构造的消费者：DataAcquisition、scripts 回填、测试 fixture
  （test/data_structure、test/data_source 各测试构造 dataclass）

## Requirements

- **R1 命名构造器**：每个持久化 dataclass 增加 `from_row(row: pd.Series,
  column_map: dict) -> Self`（或等效类方法）——按列名取值，缺失列名抛
  KeyError（响亮失败）；TDX 路径与 akshare 路径各配自己的 column_map
  （TDX 22 列无切片、akshare 23 列含代码列两种形态）
- **R2 构造点替换**：data_acquisition.py 与 scripts/backfill_f10_quarters.py
  全部位置构造改命名构造；`*list(row.values())` 模式从主流程清零
- **R3 顺带修复**（可选但建议）：`ChinaStock.info` 死字段移除（先 grep
  确认无消费者）；`ChinaStockData.date/ticker` 类型收敛为 `str`；
  孪生字段统一命名（写兼容注释，不动存储数据）
- **R4 防护单测**：新增/改造测试——列序打乱后构造**抛错而非静默**
  （对照 YJBB 断言先例）；现有数据等价性断言保留

## Acceptance Criteria

- [ ] 主流程无 `*list(row.values())` 位置构造（grep 验证）
- [ ] 列序漂移防护：插入/重排列的 fixture 下构造抛 KeyError，测试钉死
- [ ] `test/data_structure/`、`test/data_source/test_tdx_*.py`、
      `test/core/data_acquisition/` 全绿；既有 fixture 构造等价
- [ ] 全量回归绿（父任务 Cross-Child AC 1-4）
- [ ] spec 更新：data_source/index.md 与 data_structure spec 的构造
      约定节（位置构造例外授权 → 命名构造）

## Notes

- 只动构造方式，不动 dataclass 字段定义与存储 schema——ZODB 数据兼容
- scripts/ 回填脚本为一次性工具，同样替换（保持唯一正确模式）
