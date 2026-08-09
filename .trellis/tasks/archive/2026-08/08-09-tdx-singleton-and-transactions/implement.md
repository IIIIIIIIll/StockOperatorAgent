# 执行：TdxSource 单例 + ZODB 单事务提交

> 轻量任务（PRD + 本 implement，design.md 见上）→ 可 start。实现走
> trellis-implement 子代理；trellis-check 收尾。

## 执行顺序

### Step 1 — TdxSource 单例 + 7 处替换 + facade 删除

- tdx_source.py：`get_tdx_source()`（模块级懒单例，照 get_zodb_storage
  模式）；删除 `build_overview`/`build_reports` facade 方法
- 7 处实例化点 → `get_tdx_source()`（data_acquisition 的 206/317 默认
  路径改 `_build_overview_module(t, _scope=...)` / `_build_reports_module
  (t, _scope=...)` 单入口）
- 测试：单例幂等（二次调用 id 相同；TdxDownloader 构造计数 1 次）；
  facade 删除后 grep 无 TdxSource().build_* 调用
- 验证门 1：`pytest test/data_source/test_tdx_source.py
  test/data_source/test_tdx_overview.py test/data_source/test_tdx_reports.py
  test/core/data_acquisition/test_fetch_scope.py -q` 全绿

### Step 2 — ZODB 单事务（3 条链）

- ChinaStock 三个 mutator 加 `commit: bool = True`；3 条链传
  commit=False → put_stock 单次 commit
- 测试：`transaction.commit` 计数（try/finally 保存恢复，house style
  不用 pytest fixture）——ensure_stock / acquire_historical_data_tdx /
  acquire_performance_report_tdx 各 1 次 commit；既有
  test_data_acquisition_*.py / test_ZODBStorage.py 全绿
- 验证门 2：`pytest test/core/data_acquisition/ test/data_storage/
  test/data_structure/ -q` 全绿

### Step 3 — 全量回归 + spec + 提交

- `pytest` 全量（基线 551P/20S，不新增失败）
- spec 更新：data_source/index.md（TdxSource 构造约定 → 单例 +
  双入口合一）、data_structure spec（交易纪律实例：mutator commit
  参数 + 链上单事务）
- 提交：`refactor(data): TdxSource 进程单例 + ZODB 单事务——双入口合一`

## 验证命令速查

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-09-tdx-singleton-and-transactions
pytest test/data_source/test_tdx_source.py test/data_source/test_tdx_overview.py test/data_source/test_tdx_reports.py test/core/data_acquisition/test_fetch_scope.py -q  # Step 1 后
pytest test/core/data_acquisition/ test/data_storage/ test/data_structure/ -q  # Step 2 后
pytest                                                            # Step 3 全量
```

## 回滚点

- Step 1/2 各自独立可 revert；facade 删除前 grep 确认无测试直引用
- test_fetch_scope 红 = _scope 穿线被破坏 → 停，diff 单遍拉取路径
