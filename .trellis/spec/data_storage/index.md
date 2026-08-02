---
description: ZODB storage patterns — FileStorage, OOBTree index, freshness gate, transaction commits
paths:
  - data_storage/**
  - database/**
---

# Data Storage (`data_storage/`, `database/`)

## ZODBStorageInstance (`data_storage/chinese_mainland/ZODBStorage.py`)

The only storage abstraction; `database/` holds the binary data file only
(`database/china_stock_data.fs`, gitignored via `*.fs` in `.gitignore`). Local
patterns:

- **Constructor**: opens a `ZODB.FileStorage.FileStorage` on
  `utils.constants.china_db_path`, opens the DB + connection, and seeds
  `root.overview_last_updated` (defaults to `constants.default_start`). On a
  fresh file it creates `root.stocks = BTrees.OOBTree.BTree()`.
  `china_db_path` **锚定仓库根**（2026-08-02 修复：原相对路径
  `'database/china_stock_data.fs'` 在非仓库根 CWD 下静默创建第二个空库，新旧
  数据分家；现解析为 `REPO_ROOT / 'database' / 'china_stock_data.fs'`，字符串
  值语义不变、任意 CWD 都打开同一文件）。
- **Process-wide singleton**: `get_zodb_storage()` in `ZODBStorage.py` lazily
  creates one shared instance; `DataAcquisition.__init__` grabs it via
  `get_zodb_storage()`. **Do not open a second connection in one process** —
  FileStorage 的 flock 锁不可重入，同进程第二个实例打开即 `zc.lockfile.LockError`。
  全量回归中 test/core 套件已创建单例并持有锁，`test_ZODBStorage.py` 因此也走
  `get_zodb_storage()` 而非另开实例（2026-08-02 修复）。
  **跨进程同样互斥（2026-08-02 实测）**：`streamlit run main.py` 运行中持有
  flock，pytest 全量回归打开数据库即 LockError（"Couldn't lock
  .../china_stock_data.fs.lock"）——**跑全量测试前必须先停掉运行中的应用**，
  测试完成后再重启。
- **线程安全（2026-08-02）**：惰性初始化用 `threading.Lock()` 双重检查保护
  （`_instance_lock`）——Streamlit 多会话并发首调不双构造（test_singleton_
  concurrent_first_call 钉死）。**连接本身非线程安全**——Streamlit 每会话
  一线程，多会话并发读写同一连接会 POSKeyError/ConflictError（"UI 层串行
  渲染即满足"的旧假设不成立）。
  **读写锁（review #5，2026-08-02）**：`ZODBStorageInstance.lock =
  threading.RLock()`——RLock 允许嵌套持有（get → mutate → commit 链）；
  DataAcquisition 三个数据阶段方法（ensure_stock / acquire_historical_data_tdx
  / acquire_performance_report_tdx）全程 `with self.storage.lock:`。**锁只
  覆盖数据阶段，不跨 LLM 调用**（图阶段零 ZODB 访问；持锁跑图会把并发会话
  全串行化——数据阶段秒级可接受，LLM 分钟级不可）。FetchScope 预播种
  （纯网络，无 ZODB）在锁外，可并行。测试：
  test_concurrent_access_safe（2 线程 ×10 次 get/mutate/commit 无异常）+
  test_concurrent_data_phase_serializes（锁内慢 fetcher 时序断言串行化）。
- **check/set overview 门标注 deprecated（2026-08-02）**：
  `check_need_update_overview` / `set_overview_updated_now` docstring 标注
  "仅备用路径使用"——主流程纯 TDX 按需构建（ensure_stock）不经过它们，
  方法保留（akshare 备用路径 + 既有测试引用）。
- **`__del__`** (2026-08-02 根治锁泄漏)：先 `transaction.abort()` 终止未提交事务
  （访问 root 即 join 事务，否则 `connection.close()` 抛
  `ConnectionStateError` → `db.close()` 不执行 → flock 泄漏 → 同进程下一实例
  `BlockingIOError`），再 `connection.close()` → `db.close()` → info 日志；整个
  `__del__` 用 try/except 包裹（`__del__` 不得向外抛异常）。ZODB 6.0.1 实测：
  `connection.abort(transaction)` 是 storage-manager 接口需传事务参数，无参调用
  TypeError；`transaction.abort()` 正确且锁必然释放。残余噪音：解释器退出时若
  处于未提交事务态，ZODB 内部 `FileStorage.close` 的 `_save_index` 在 builtins
  拆除后打印 `NameError: name 'open' is not defined`（ZODB 自身捕获打印，非
  本类抛出）——纯装饰性；全量 pytest 结束干净（末态已提交则 `connection.close()`
  内部 KeyError 被本类 except 吞掉）。

## Key-Value Semantics

- `root.stocks` is an OOBTree keyed by ticker string: `put_stock(ticker, stock)`
  and `get_stock(ticker)` (returns `None` when missing — callers branch on that).
- Stored values are `ChinaStock` persistent objects whose collections
  (`datas`, `performance_reports`) are `PersistentList`s mutated in place, so a
  `put_stock` after mutation is what persists the change — mirror the pattern in
  `DataAcquisition` (get → mutate → `put_stock` → `transaction.commit()`).

## Transaction Rules

- **Every write ends with `transaction.commit()`** — in `ZODBStorageInstance`
  (`put_stock`, `set_overview_updated_now`) and in `ChinaStock` mutators
  (`add_data`, `add_performance_report`, `update_overview`, `add_info`).
- Reads never commit. If a method touches `root`/storage only for reading, no
  `transaction` import is needed.
- The `transaction` module is used directly (`import transaction`), not via ZODB
  helpers — match that.

## Freshness Gate

- `check_need_update_overview()` returns `False` when
  `root.overview_last_updated` is after 17:00 of the last business day
  (`datetime.time(17, 00)` + `utils.time_helper.get_last_business_day`), else
  `True` — i.e. the daily overview refreshes once per trading day.
- `set_overview_updated_now()` stamps the root and commits. `DataAcquisition`
  calls these around the exchange overview updates.

## Tests

`test/data_storage/test_ZODBStorage.py` runs against the real file database via
the **process-wide singleton** (`get_zodb_storage()` — flock 不可重入，不得另开
实例)，断言：

- 未构建的 ticker → `get_stock()` 返回 `None`（按需构建契约：纯 TDX 架构下 DB
  只含分析过的股票，`871263`/`002741`/`600188` 从未入仓，跨 run 稳定）；
- 已构建的 ticker → 模块级 `_seed_stock` 补种（沿用 `test_data_acquisition_tdx.py`
  模式，22 字段 `StockOverview` 合成 + `ChinaStock` 三参数构造）后返回数据，
  测试自包含、不依赖 DB 历史状态；
- `put/get` 往返用专用 dummy ticker（`999998`），不触碰真实数据
  （`000001`/`002714` 的 datas/reports 在测试前后保持不变）；
- `overview_last_updated` 新鲜度行为（`test_need_update` 基准与实现一致：
  `get_last_business_day` 的 17:00，周末也成立）。

## Anti-Patterns

- Importing `ZODB`/`transaction` outside `data_storage/` and `data_structure/`
  (where persistent classes live) — storage access goes through
  `ZODBStorageInstance`.
- Committing on the read path or wrapping reads in `transaction` blocks.
- Opening a second ZODB connection in core/agents code — the singleton is
  shared on purpose.
- Committing `database/china_stock_data.fs*` to git — `*.fs` is gitignored.
