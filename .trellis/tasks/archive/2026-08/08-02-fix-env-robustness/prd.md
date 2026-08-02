# 路径锚定与缓存真相

## Goal

修复审计中危 2 项 + 低危 1 项：路径 CWD 漂移（双库/双缓存/日志落错处）、
parquet 缓存 docstring 谎言。目标：无论从哪个目录启动，数据路径唯一稳定；
缓存行为与文档一致。

## 修复清单

### 1. `china_db_path` 锚定仓库根（中）

- `utils/constants.py:4`：`'database/china_stock_data.fs'` 相对路径 →
  非仓库根 CWD 启动静默创建第二个空库，新旧数据分家。
- 修法：`Path(__file__).resolve().parents[1] / "database" / "china_stock_data.fs"`
  （保持 `utils.constants.china_db_path` 单一来源，字符串值不变语义）。
- 验收：任意 CWD 下 `get_zodb_storage()` 都打开同一文件（可打印 resolved
  路径断言）。

### 2. `DEFAULT_PARQUET_ROOT` 锚定并统一（中）

- `tdx_source.py:34`：`Path("data/tdx_cache")` 相对路径 + 与 vendor 默认根
  `Path("data")` 不一致 → 现场存在 `data/daily` 与 `data/tdx_cache/daily`
  两棵缓存树，换 CWD 即全部失效。
- 修法：锚定仓库根 `Path(__file__).resolve().parents[3] / "data/tdx_cache"`；
  与 vendor 的 `data` 根关系核查：若 vendor 写 `data/daily`（非 tdx_cache），
  统一走 tdx_cache 并在 docstring 注明。
- 验收：任意 CWD 下缓存读写同一棵树；无第二棵缓存树产生。

### 3. `main.py` 日志路径绝对化（低）

- `logger.add("./logs/...")` 相对路径 → 换 CWD 日志落别处。
- 修法：锚定仓库根 `logs/`（与 constants 同源或 Path 计算）。
- 验收：任意 CWD 启动日志写入仓库 `logs/`。

### 4. parquet 缓存真相（中）

- `tdx_source.py` docstring 声称"parquet 分片落盘、重复拉取读缓存"——
  实测 `download_daily`/`download_xdxr` 永远走网络，`write_by_symbol` 只写
  不读 → 每次构建全量重拉 250 根日K + 全市场证券列表。
- 修法（二选一，实现者评估后取可行者并记录理由）：
  a) **实现读缓存**：fetch_daily/fetch_security_list 前按
     symbol+max_bars+文件时间戳（当日新鲜）读 parquet；不足时网络拉取并
     写回。需要核查 vendor `write_by_symbol` 的落盘路径/格式。
  b) **文档真相**：docstring 改为"always network（parquet 仅缓存落盘，
     不读回）"；并将"读缓存优化"记录到 spec 的待办。
- 验收：a) 二次调用相同参数不触发网络（可打点验证）；b) 文档与行为一致。

## Acceptance Criteria

- [ ] 4 项完成；任意 CWD 启动验证：ZODB 库、parquet 缓存、日志三处路径稳定
- [ ] 全量 pytest 0 failed 保持（ZODB 路径变化后 test_data_acquisition 等
      依赖真实库的测试不受影响——库文件本身未移动，只是锚定解析）
- [ ] data_storage/architecture spec 同步（路径锚定说明）

## Constraints

- `utils.constants` 仍是路径唯一来源；spec 的"不要硬编码
  `database/china_stock_data.fs`"约束延续（值不变，解析方式变）
- 缓存实现（若选 a）不得改变 fetch 返回的 DataFrame 契约（列序/类型）
- deprecated 测试零改动
