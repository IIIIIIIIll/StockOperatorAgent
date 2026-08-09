# 设计：TdxSource 单例 + ZODB 单事务提交

## 架构与边界

```
data_source/chinese_mainland/tdx/tdx_source.py
    get_tdx_source() -> TdxSource          —— 进程级懒单例（照
        get_zodb_storage 模式：模块级缓存 + 幂等；TdxDownloader 只在
        单例内构造一次，parquet_root 锚定 REPO_ROOT 语义不变）
    删除 facade：build_overview / build_reports（薄转发双入口——
        统一走 overview.build_overview / reports.build_reports 模块函数，
        _scope 穿线语义不再绕路）

7 处实例化点 → get_tdx_source()：
    core/llms/tools/get_financial_indicators.py:33
    core/data_acquisition.py:137 / 206（facade 删除 → _build_overview_module
        单入口）/ 317（同 → _build_reports_module 单入口）/ 355
    data_source/chinese_mainland/tdx/overview.py:255
    data_source/chinese_mainland/tdx/reports.py:170

ZODB 单事务（3 条 get→mutate→put 链）：
    ChinaStock.add_datas / add_performance_reports / update_overview
        增加 commit: bool = True 参数（默认保持现状——既有调用零变化）；
    链上调用传 commit=False，由 put_stock 一次 commit 持久化
    （mutate 的 persistent 变更 + root.stocks 引用同事务）：
        ensure_stock（update_overview + put_stock）
        acquire_historical_data_tdx（add_datas + put_stock）
        acquire_performance_report_tdx（add_performance_reports + put_stock）
```

## 语义要点

- **单例**：`get_tdx_source()` 幂等——同一进程同一实例；`TdxSource()`
  直接构造仍可用（测试/独立路径不受限）；单例只为生产链路收敛
  （TdxDownloader 构造/根路径只在单例内发生一次）
- **双入口合一**：data_acquisition 的 `_build_overview_module(t, _scope=)`
  与 `_build_reports_module(t, _scope=)` 成为唯一路径——facade 删除后
  grep 无 TdxSource().build_* 调用；_scope 单遍拉取语义保留
  （test_fetch_scope 全绿即证明）
- **单事务**：commit=False 只影响 3 条链的提交次数（2 → 1）；add_datas
  的 "0 = 全部重复，不 commit" 语义保留（commit=False 时本就跳过）；
  单行追加 add_data/add_performance_report 的委托语义不变
- **测试**：提交计数用 monkeypatch `transaction.commit`（测试内
  try/finally 保存恢复——house style 注入点，不用 pytest fixture）；
  TdxDownloader 构造计数：get_tdx_source 二次调用不重建（id 相同断言）

## 兼容与风险

- 公共方法签名与降级语义零变化（fetch 失败 → warning + 占位）
- TdxSource 构造器不变（测试构造直接实例化仍合法）
- ZODB schema 零改动；事务数减少不改变可见数据（同一次逻辑写）
- 既有测试：test_tdx_source / test_tdx_overview / test_tdx_reports /
  test_fetch_scope / test_data_acquisition_tdx 全绿 = 等价证明；
  facade 若被测试引用 → 断言性更新（grep 确认）

## 不做

- 不引入连接池/多源抽象；不动 FetchScope 语义
- 不合并 add_datas/put_stock 为单一方法（职责分离保留，只去双重事务）
