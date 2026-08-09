# TdxSource 单例 + ZODB 单事务提交

## Goal

两处小债，一次清理：

1. **TdxSource/TdxDownloader 每次调用新建**（overview.py:242、reports.py:170、
   data_acquisition.py:137/204/313/351 共 4-5 处）——单次分析里 pytdx
   连接反复重建；且 `TdxSource().build_overview`/`build_reports` facade
   与 `_build_overview_module` 双入口并存（后者正确穿 `_scope`，前者绕开）
2. **ZODB 双提交**：`ensure_stock` 链 `add_datas`（内部 commit，
   ChinaStock.py:48）→ `put_stock`（再 commit，ChinaStock.py:74）——
   一个逻辑写两笔事务

## Background / Confirmed Facts

- ZODB 已有进程级懒单例先例：`get_zodb_storage()`（ZODBStorage.py:87-105，
  double-checked lock）——TdxSource 照此模式
- spec 交易纪律："write data without a transaction.commit() next to it"、
  单次 commit 一次逻辑写（core spec 反例提示）——双提交违反该纪律
- `_scope`（FetchScope 单遍拉取去重）是 08-02 review #2+#3 的成果，
  `TdxSource().build_overview` 双入口是它之后残留的——统一入口是前提
- TdxSource 构造链：`ensure_vendor_on_path()` + TdxDownloader 根路径
  显式传参（tdx_source.py:30-38）——单例化后根路径/缓存树一致性更稳

## Requirements

- **R1 TdxSource 进程级单例**：`get_tdx_source()`（模块级懒加载，同
  get_zodb_storage 模式）；DataAcquisition/overview/reports 全部消费点
  改经单例获取；TdxDownloader 构造/根路径仅单例内发生
- **R2 入口收敛**：`TdxSource().build_overview`/`build_reports` facade
  删除或改为薄转发（经 `_scope` 参数正确穿线的唯一路径）；DataAcquisition
  双入口（`_build_overview_module` vs `TdxSource().build_overview`）合一
- **R3 单事务**：`ensure_stock` 的 add_datas + put_stock 合并为一次
  commit（或明确一次逻辑写一次 commit 的等价形式）；其他 get→mutate→
  put 链同查
- **R4 测试**：现有 `test_tdx_source.py`/`test_tdx_overview.py`/
  `test_tdx_reports.py`/`test_fetch_scope.py` 全绿（单例不破坏注入点
  house style——测试注入 `_scope`/`_build_overview` 不受影响）；
  双提交修复用计数测试钉死（house style 无 mock 框架）

## Acceptance Criteria

- [ ] 单次 `get_stock_data` 全链路 TdxDownloader 构造 ≤1 次（计数注入
      断言）
- [ ] `_scope` 单遍拉取语义保留：FetchScope 测试（test_fetch_scope.py）
      全绿，无重复拉取
- [ ] ZODB 写路径：首建股票 1 次 commit 完成 add_datas+put_stock
      （计数断言）；`test_ZODBStorage.py`/`test_data_acquisition_*.py`
      全绿
- [ ] 全量回归绿（父任务 Cross-Child AC 1-4）
- [ ] spec 更新：data_source/index.md（TdxSource 构造约定）、
      data_storage spec（交易纪律实例）

## Notes

- 轻量任务，PRD-only 可接受；若 R2 入口收敛牵扯 `_scope` 语义评审，
  补 design.md 再 start
- 不改变 TdxSource 公共方法签名与降级语义（fetch 失败 → warning + 占位）
