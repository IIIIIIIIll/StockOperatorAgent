# 执行：命名行构造（DataFrame → dataclass 列名映射）

> 中复杂度任务：prd + design + 本 implement 齐备 → 可 start。实现走
> trellis-implement 子代理；trellis-check 收尾。

## 执行顺序

### Step 1 — from_row 构造器 + 列名契约

- 3 个 dataclass 各加 `from_row(row, *, column_map=None, **overrides)`
  （design.md 语义：KeyError 响亮失败、多余列忽略、overrides 覆写）
- overview.py 加 `OVERVIEW_COLUMN_MAP`（与 OVERVIEW_COLUMNS 同源显式化）；
  注释「顺序勿改」改述为列名契约
- 验证门 1：新增 `test/data_structure/test_row_constructors.py`（class
  风格）——恒等/映射路径 == 位置构造输出、打乱列序/缺列 → KeyError、
  多余列忽略、overrides 生效；`pytest test/data_structure/ -q` 全绿

### Step 2 — 调用点替换（6 处）

- data_acquisition.py:164/214/232/321、legacy_akshare.py:88/130、
  scripts/backfill_f10_quarters.py:77 → from_row；akshare 业绩路径传
  YJBB_COLUMN_MAP + report_date overrides
- 位置构造 `*list(row.values())` 从主流程清零（grep 验证）
- 验证门 2：`pytest test/core/data_acquisition/ test/data_source/
  test/core/test_billions_fin_db.py -q` 全绿

### Step 3 — 顺带修复（验证后才动）

- `ChinaStock.info` grep 无消费者 → 移除
- `ChinaStockData.date/ticker` 注解 str（核对生产值恒 str 后）
- 孪生字段兼容注释
- 验证门 3：`pytest test/data_structure/ test/data_storage/ -q` 全绿

### Step 4 — 全量回归 + spec + 提交

- `pytest` 全量（基线 523P/20S，不新增失败）
- spec 更新：data_source/index.md 构造约定节（位置构造例外授权 →
  from_row 命名构造）、data_structure spec（若有）
- 提交：`refactor(data): 命名行构造——位置构造改 from_row，列序漂移响亮失败`

## 验证命令速查

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-09-named-row-constructors
pytest test/data_structure/ -q                        # Step 1 后
pytest test/core/data_acquisition/ test/data_source/ test/core/test_billions_fin_db.py -q  # Step 2 后
pytest test/data_structure/ test/data_storage/ -q     # Step 3 后
pytest                                               # Step 4 全量
```

## 回滚点

- Step 1 独立（新增 API 无副作用）；Step 2 逐调用点可 revert
- from_row 输出与位置构造不一致（既有测试红）→ 停，diff 字段取值
