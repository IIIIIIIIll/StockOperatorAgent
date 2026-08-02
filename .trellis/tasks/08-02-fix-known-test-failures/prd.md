# 修复已知测试失败与 ZODB 锁泄漏（根治版）

## Goal

根治全量回归 8F 与 testing.md 已知损坏，目标全量 pytest **0 failed**
（deprecated 20 skipped 保持不动）。"根治"= 修根因与契约，不以补丁绕过：
测试断言语义与当前纯 TDX 按需架构一致，生产代码只动必要处。
全部修复保持既有 house style：类式测试无 mock、loguru 占位符、不引入新框架。

## 修复清单（含 2026-08-02 review 新增发现）

### 1. `ZODBStorage.__del__` 锁泄漏（生产代码，6F 传染根源，最高优先）

- **根因（已实测确认）**：`__del__` 里 `connection.close()` 在"joined to a
  transaction"（ZODB 中访问 root 即开事务）时抛
  `ConnectionStateError` → `db.close()` 未执行 → FileStorage flock 泄漏 →
  同进程后续实例 `BlockingIOError`。连 `get_zodb_storage()` 单例在解释器
  退出时也抛（每次全量结束的 traceback 噪音）。
- **修法**：`data_storage/chinese_mainland/ZODBStorage.py` `__del__` 改为
  先 `connection.abort()`（或 `transaction.abort()`，以 ZODB 6.2 实测为准）
  终止未提交事务 → `connection.close()` → `db.close()`；整个 `__del__`
  用 try/except 包裹（`__del__` 不得向外抛异常）。info 日志保留。
- **验收**：同进程连续构造多个 `ZODBStorageInstance` 不再
  BlockingIOError；全量结束无 `ConnectionStateError` traceback 噪音。

### 2. `ChinaStock('dummy')` 构造损坏 + 连带坑（2 处失败）

- **根因**：构造签名变更为 `(name, ticker, overview)` 后测试未更新。
- **连带坑（review 发现）**：`ChinaStockData()` 无参构造本身 TypeError
  （13 字段全无默认值）；`add_data` 的 `data.date > last_data_update`
  比较要求 date 可比较且递增。
- **修法**（`test/data_structure/test_ChinaStock.py`）：完整三参数构造
  ChinaStock（overview 用 `StockOverview` 合成，参考
  `test_data_acquisition_tdx.py` 的 `_seed_stock`）；`ChinaStockData`
  完整字段构造，`date` 用递增日期（data2.date > data1.date，验证
  add_data 去重 + 顺序语义）。
- **验收**：test_stock 验证 add_data 去重/顺序语义且通过。

### 3. `test_storage` 用 `'000001'` 覆盖真实数据（测试污染）

- **根因（review 发现）**：`test_ZODBStorage.py::test_storage` 把 dummy
  股票 `put_stock('000001')` —— 覆盖 DB 里真实 000001（120 日K + 6 报告），
  违反 testing.md anti-pattern（storage 测试共享文件不得破坏）。
- **修法**：改用 DB 中不存在的专用 ticker（如 `'999998'`）测 put/get
  往返，保留原测试意图（持久化往返）。
- **验收**：测试通过且 DB 中 000001 真实数据不被触碰。

### 4. `test_exist_*` 依赖已不存在的全市场旧数据（4 处失败，review 发现）

- **根因**：`871263`/`002741`/`600188` 断言"DB 里存在"，但纯 TDX 按需
  架构下 DB 只有分析过的股票（实测三者全为 None）——断言的是已废弃的
  akshare 全市场扫描时代状态。
- **修法**：断言语义改为当前架构契约——
  - 未构建的 ticker：`get_stock()` 返回 `None`（按需构建契约）；
  - 已构建的 ticker：`_seed_stock` 补种后 `get_stock()` 返回数据
    （沿用 `test_data_acquisition_tdx.py` 的 `_seed_stock` 模式，测试
    自包含，不依赖旧数据）。
- **验收**：4 个用例通过且测试自包含（无旧数据依赖）。

### 5. `test_need_update` 基准与实现不一致（1 处失败）

- **根因**：测试 `bench_time = 今天 17:00`，实现用
  `get_last_business_day(date)` 的 17:00——周末（2026-08-02 周日）不一致。
- **修法**：测试基准改为 `get_last_business_day(datetime.today().date())`
  的 17:00，与 `check_need_update_overview` 完全一致（data_storage spec
  Freshness Gate 定义）。不写库（保持对真实 DB 状态的只读断言）。
- **验收**：周末与工作日均通过。

### 6. 类名错乱 + 重复定义 + 不断言（观感/规范）

- `test_ChinaStock.py` 类名 `TestZODBStorage` → `TestChinaStock`；
  顺带确认 `test_ZODBStorage.py` 类名。
- `test_akshare.py` 重复定义 `test_get_shex_stock_overview`（25/37 行）
  删一份（文件已 deprecated，坏定义不留）。
- `test_time_helper.py` 补真实断言：`get_last_business_day` 用固定日期
  （如 2026-08-01 周六 → 期望 2026-07-31 周五；2026-07-31 周五 → 自身），
  注意参数类型（实现签名 date，测试传 date 而非 datetime）。

## Acceptance Criteria

- [ ] 全量 `python3 -m pytest -q` **0 failed**（deprecated 20 skipped 保持）
- [ ] 全量结束无 `ConnectionStateError`/`BlockingIOError` traceback 噪音
- [ ] 无 `ChinaStock('dummy')` 残留；`ChinaStockData()` 无参构造无残留
- [ ] DB 中 000001/002714 真实数据不被测试破坏（测试前后可对比）
- [ ] `ZODBStorage.py` 只动 `__del__`，其余方法零改动；正常路径行为不变
- [ ] testing.md / data_storage spec 更新：Known Broken 移除、基线改
      0F、`__del__` 行为修正描述

## Constraints

- deprecated 测试（akshare/qwen/DeepSeek live）**不做任何改动**，保持 skip
- 不引入 pytest fixtures/mocking 框架；`_seed_stock` 补种是唯一允许的
  数据预置方式
- 测试自包含优先（不依赖 DB 历史状态）；契约断言优先（与当前架构语义一致）
- 若修复中出现新的环境性失败，须说明原因并回写 spec，不静默
