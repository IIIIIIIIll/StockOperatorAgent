# py-storage-utils 审查报告

Slice: Python 存储/数据结构/工具 + 2 脚本。只读审查（无运行测试/应用，仅一次 numpy/PersistentMapping 库行为内省 + fmt_number 纯函数实测，不触碰仓库数据/网络/DB）。

## 审阅覆盖

| 文件 | 行数 | 结论 |
|---|---|---|
| data_storage/chinese_mainland/ZODBStorage.py | 104 | 有发现（2 INFO；核心机制与 spec 一致） |
| data_structure/chinese_mainland/ChinaStock.py | 86 | 有发现（2 INFO） |
| data_structure/chinese_mainland/ChinaStockData.py | 39 | 无发现 |
| data_structure/chinese_mainland/StockInfo.py | 16 | 无发现 |
| data_structure/chinese_mainland/StockOverview.py | 50 | 无发现 |
| data_structure/chinese_mainland/StockPerformanceReport.py | 43 | 无发现 |
| utils/billions_config.py | 95 | 无发现（与 runtime_config 原语核对一致） |
| utils/constants.py | 18 | 无发现 |
| utils/env_file.py | 175 | 无发现 |
| utils/formatting.py | 20 | 无发现（实测正确，见符合性结论） |
| utils/market_time.py | 68 | 有发现（1 WARNING + 1 INFO） |
| utils/runtime_config.py | 117 | 无发现（大小写敏感为测试钉死的刻意语义） |
| utils/state.py | 14 | 无发现（add_messages 用法与 agents 消费核对一致） |
| utils/time_helper.py | 27 | 无发现 |
| scripts/backfill_f10_quarters.py | 122 | 有发现（1 INFO） |
| scripts/export_seed_002027.py | 57 | 无发现 |

## 发现

### [WARNING] is_trading_time 未实现文档声明的"节假日→非交易时段"保守语义——工作日节假日盘中判交易
- **位置**: utils/market_time.py:39-44（行为）；模块 docstring utils/market_time.py:3-6、函数 docstring :39-40（声明）
- **问题**: 模块 docstring 与 08-02-market-hours-util PRD R1、architecture.md:105 一致声明"节假日（国庆/春节等）无日历可查时判定为非交易时段（保守：休市行情不变，下游用缓存是正确行为）"，但实现只排除周末，**没有任何节假日处理**。工作日节假日（如国庆/春节假期的周中）在 9:30–15:00 判 `True`，`get_market_intel` 走实时 MCP 查询而非读缓存——与保守设计意图（休市日免网络/免配额、用缓存）正好相反。消费方 core/llms/tools/get_market_intel.py:92-95 直接以 `is_trading_time()` 假值决定读缓存。
- **证据**:
  ```python
  # utils/market_time.py:3-6 文档声明
  # 节假日（国庆/春节等）无日历可查时判定为"非交易时段"（保守：休市日行情不变，下游"用缓存"是正确行为）
  # utils/market_time.py:39-44 唯一排除逻辑（仅周末）
  if get_last_business_day(now.date()) != now.date():
      # 非工作日（周末）——get_last_business_day 返回最近工作日，
      # 相等 = 今天是工作日
      return False
  ```
  `get_last_business_day`（utils/time_helper.py:19-27）只对周六/周日减 1/2 天，周中节假日返回自身 → 2026-10-01（周四国庆）10:00 判 `True`。
- **建议**: 二选一——① 内嵌沪/深交易所年度休市安排表（q3-offline-data.md:113 已评估为"可选但非必需"，若维持现状则必须改文档）；② 若保持"跳过周末的工作日近似"，修正模块 docstring/函数 docstring/PRD 记录，明确"节假日不判非交易、交易时段可能对休市日走实时查询"。推荐 ①（与文档契约一致），但至少先消除文档-实现分歧。
- **spec 对照**: 违反 data_storage 无关；违反 market_time 模块自身 docstring 契约 + 08-02-market-hours-util PRD R1（"其余（午休、收盘后、开盘前、周末、节假日）False"）与 architecture.md:105。

### [INFO] market_time.py docstring/行内注释与测试钉死的边界行为矛盾（13:00 / 15:00）
- **位置**: utils/market_time.py:11-14（模块 docstring）、:24（行内注释）
- **问题**: docstring 声称"15:00:00 本身是交易时刻；11:30:00 与 13:00:00 是午休边界，判非交易时段"，行内注释声称"含边界：9:30 与 15:00 本身是交易时刻"；实现与 test/utils/test_market_time.py:33,36 恰好相反——13:00:00 判 `True`（午后开盘）、15:00:00 判 `False`（收盘时刻）。代码行为正确（15:00 起行情不再变化，判非交易缓存安全；13:00 午后开盘），纯文档错误，但会误导维护者"修正"代码引入真实边界 bug。
- **证据**: `t = (now.hour, now.minute)` 后 `_AFTERNOON_START <= t < _AFTERNOON_END` → (13,0) 命中、 (15,0) 不命中；测试 `assert is_trading_time(_dt(..., 13, 0)) is True  # 午后开盘`、`assert is_trading_time(_dt(..., 15, 0)) is False`。
- **建议**: 将模块 docstring:11-14 与 :24 注释改为与实现一致："13:00:00 起（午后开盘）为交易时刻；15:00:00 整起判非交易时段（收盘后行情不再变化，缓存安全）"。
- **spec 对照**: 违反本模块自身文档；architecture.md:103-104 描述与代码一致（15:00 整起非交易），即只有 market_time.py 自身 docstring 是离群者。

### [INFO] ZODBStorage.py 死 import ChinaStock
- **位置**: data_storage/chinese_mainland/ZODBStorage.py:5
- **问题**: `from data_structure.chinese_mainland import ChinaStock` 全文件仅 import 行出现，类体/方法零引用（grep 确认唯一命中即 :5）。仓库惯例是清除死代码（spec 记载 "info 死字段已移除"）。
- **证据**: `grep ChinaStock data_storage/chinese_mainland/ZODBStorage.py` → 仅第 5 行。
- **建议**: 删除该 import（put_stock/get_stock 签名不依赖 ChinaStock 类型）。
- **spec 对照**: data_storage spec 无此依赖；属仓库死代码惯例。

### [INFO] `import utils` 依赖命名空间包 + 后续 from-import 的副效应绑定 utils.constants
- **位置**: data_storage/chinese_mainland/ZODBStorage.py:2（`import utils`），:17-18 消费 `utils.constants.china_db_path`
- **问题**: `utils/` 无 `__init__.py`（隐式命名空间包，全仓顶层均如此），`import utils` 只创建空包对象、**不加载子模块**；`utils.constants` 属性可用仅因第 6 行 `from utils.constants import default_start` 恰好先执行而绑定。任何 import 重排/删除第 6 行（如改为 `from utils.constants import china_db_path`）都会使 :17 在运行时 AttributeError。全仓仅此一处裸 `import utils`。
- **证据**: `import utils`（:2）→ `utils.constants.china_db_path`（:17）；`glob **/__init__.py` 无 utils/__init__.py。
- **建议**: 改为 `from utils import constants` 或直接 `from utils.constants import china_db_path, default_start`，消除对导入顺序的隐式依赖。
- **spec 对照**: 不违反明确 spec 条款；可维护性建议（data_storage spec "china_db_path 锚定仓库根"语义不受影响）。

### [INFO] 概览盖戳用 naive 本地时间，与北京时间新鲜度门不一致
- **位置**: data_storage/chinese_mainland/ZODBStorage.py:68；data_structure/chinese_mainland/ChinaStock.py:19,31
- **问题**: `set_overview_updated_now` 与 `ChinaStock.__init__/update_overview` 用 `datetime.datetime.now()`（服务器本地 naive），而消费门按北京时间：`check_need_update_overview`（ZODBStorage.py:60）与 `_overview_stale`（core/data_acquisition.py:255）分别按 `asia_today()`/`get_last_business_day(asia_today())` 比较。非北京时区服务器（如 UTC）上盖戳漂移——UTC 服务器在北京 00:00–08:00 之间盖的戳日期为"昨天"，`_overview_stale` 判陈旧多触发一次重建；root 门（deprecated 备用路径）在 UTC 服务器上 `now()` 恒小于北京 17:00 门 → 每日门永不抑制。影响有限（日期级比较最多差一天；主流程门幂等重建；root 门已 deprecated），但与时区统一约定（utils/time_helper.asia_today "全仓唯一'今天'来源"）不一致。
- **证据**: `self.root.overview_last_updated = datetime.datetime.now()`（ZODBStorage.py:68）；`self.overview_last_update = datetime.datetime.now()`（ChinaStock.py:19/31）；门侧 `datetime.datetime.combine(get_last_business_day(asia_today()), datetime.time(17, 00))`。
- **建议**: 盖戳统一为 `datetime.datetime.now(ZoneInfo("Asia/Shanghai"))`（或新增 time_helper.asia_now()），与 asia_today 时区约定一致。
- **spec 对照**: data_storage spec 的 17:00 门只约定比较基准（"after 17:00 of the last business day"），未约定盖戳时区；属 spec 未覆盖的时区一致性缺口（INFO）。

### [INFO] backfill_f10_quarters.py "零网络" 声明不精确
- **位置**: scripts/backfill_f10_quarters.py:5（docstring 声明），:71（build_reports 调用）
- **问题**: 模块 docstring 声称"重灌**已有 raw 缓存**的股票——零网络"。实际 `build_reports`（data_source/chinese_mainland/tdx/reports.py:257-258,285-288）内部：① `get_stock_name(ticker)` 在名称索引未缓存时拉取 SZ/SH 全市场证券列表（fetch_security_list 当日分区缺失 → 网络，tdx_source.py:161-162）；② raw 文本解析失败时回退 `fetcher.fetch_company_finance`（网络）。脚本仅保证"raw 缓存存在"（_cached_tickers 过滤 data.parquet），不保证名称索引已缓存/解析必成功。"零网络"是 best-effort。
- **证据**: `reports = build_reports(ticker)`（:71）；`src.get_stock_name(ticker)`（reports.py:257）→ `_load_name_index` → `fetch_security_list` → 缓存缺失 `return self.downloader.download_security_list(market)`（tdx_source.py:161-162）。
- **建议**: docstring 改为"零网络仅指 F10 数据（company_info_raw 本地解析）；名称索引缺失或 raw 解析失败时可能回退网络"，运维执行前先确认 `data/tdx_cache/security_list/market=<SZ|SH>/date=<今日>/data.parquet` 存在。
- **spec 对照**: 脚本自述契约与实现有出入；不影响 data_source/data_storage spec。

### [INFO] ChinaStock.py 类体缩进风格不一致（8 空格）
- **位置**: data_structure/chinese_mainland/ChinaStock.py:13-84（类体全部方法 8 空格；`get_datas` 的 return 11 空格，:66 附近）
- **问题**: 类体方法缩进 8 空格（仓库其他类如 ZODBStorage/各 dataclass 均 4 空格），`get_datas` 内 return 缩进 11 空格。合法 Python、无行为影响，但风格不统一、diff 噪音大。
- **证据**: `        def __init__(self, name, ticker, overview):`（:13）…`           return self.datas`。
- **建议**: 统一为 4 空格类体缩进（一次性格式化该文件，行为零变化）。
- **spec 对照**: 无 spec 条款；风格建议。

## spec 符合性结论

- **ZODBStorage 层（data_storage spec 逐条核对）**: 符合。构造（FileStorage 打开 `constants.china_db_path`、seed overview_last_updated、新库建 `root.stocks` OOBTree）✓；`china_db_path` 锚定仓库根（utils/constants.py:13 `REPO_ROOT / 'database' / 'china_stock_data.fs'`）✓；进程单例 `get_zodb_storage` + `threading.Lock` 双重检查 ✓；RLock 读写锁 ✓；事务规则（put_stock/set_overview_updated_now commit；get_stock 只读不 commit）✓；`__del__` 顺序（transaction.abort → connection.close → db.close，try/except 包裹）✓；check/set overview 门 deprecated 标注 ✓。root 属性式访问（`root.stocks`/`root.overview_last_updated`）经实测 PersistentMapping 支持且全仓无 item 式访问（grep `.root[` 零命中），自洽。
- **ChinaStock 层（data_structure spec）**: 符合。构造签名 `(name, ticker, overview)` ✓（测试已全部改三参，spec 中"stale tests"记载已过期）；`add_datas`/`add_performance_reports`/`update_overview` 带 `commit: bool = True` 参数，链上调用 `commit=False` ✓（core/data_acquisition.py:171/221/338 逐处核实：commit=False → put_stock 单 commit，提交 2→1）；`add_data`/`add_performance_report` 单行版委托批量版 ✓；dedupe by date / report_date 字符串比较 ✓；update_overview 写 `self.overview` ✓；info 字段已移除 ✓。
- **dataclass 层**: 符合。`@dataclass + persistent.Persistent` ✓；numpy 字段类型（float64/int64）✓；`from_row(row, *, column_map=None, **overrides)` 命名构造 ✓（缺列 KeyError 响亮失败；column_map 全部由 `zip(fields(cls), COLUMNS)` 构造，覆盖无缺口；backfill 走 column_map=None 恒等路径，REPORT_COLUMNS 即字段名）；`date` object（datetime.date）、`report_date` '%Y%m%d' 字符串 ✓；StockInfo.float_market_cap/StockOverview.circulating_market_cap 语义孪生注释 ✓。
- **utils 层**: 符合（含两处已核实非缺陷项——见下）。constants 锚定仓库根 ✓；env_file 原子写（tmp + os.replace、白名单、R6 不打印值、失败清 tmp）✓；billions_config 主闸/总闸/能力闸/覆盖层优先级与 runtime_config 原语核对一致 ✓；state.py TypedDict 的 `Annotated[list, add_messages]` 与 agents 消费（bearish_trader.py:47-50 `[-1].content` 消息语义）一致 ✓；time_helper 语义与 spec 门一致（17:00 门、test_need_update 基准吻合）。
  - **非缺陷（防假阳性记录）**: ① `fmt_number` 的 NaN 门 `isinstance(value, float) and pd.isna(value)` 在 numpy==2.3.2 下对 np.float64 NaN **正确**输出 "N/A"——实测 `isinstance(np.float64(np.nan), float)` 仍为 True（numpy 2.0 移除的是 int64/int 继承，float64/float 保留），`fmt_number(np.float64(np.nan), 2)` → 'N/A'；golden fixture 无字面 'nan' 与实现一致。② `env_disabled` 大小写敏感（"FALSE"/"No" 也禁用）是 test/utils/test_runtime_config.py:163-168 显式钉死的刻意语义（"大小写敏感（'FALSE'/'No' 也禁用）"），非缺陷；覆盖层大小写不敏感（`value.lower()`）同样有文档且测试覆盖，两层差异为有意设计。③ `add_datas`/`add_performance_reports` 批内不去重（仅对 last_data_update/最后一份去重）符合 spec "输入须升序、数据链路保证"契约。
- **脚本层**: backfill_f10_quarters 逻辑正确（`_cached_tickers` 解析 `ts_code=<TS>` 目录名与 tdx_source 落盘契约一致；合并替换按 report_date 升序、重跑幂等；`PersistentList` 保持持久化容器契约；经 `put_stock` 单 commit）；export_seed_002027 正确（函数内 import、写后自检 assert、docstring 注明 TDX_API_KEY 确定性注意事项）。
- **反模式检查**: 无 storage 外 ZODB/transaction import（全仓 grep：ZODB/transaction 仅出现在 data_storage/、data_structure/ 与测试文件）；读路径无 commit；无逐行 commit（批量 mutator 单次 commit 语义落实）。
- **整体偏离清单**: 1 WARNING（market_time 节假日保守语义未实现，文档-实现分歧）+ 6 INFO（文档-代码不一致 ×2、死 import、import 顺序脆弱性、时区盖戳、脚本"零网络"措辞、缩进风格）。

### 跨切片提示
- market_time 节假日问题同时牵动 architecture.md:105 与 08-02-market-hours-util PRD（文档侧）以及 get_market_intel 缓存消费方（core/llms 切片）；本切片只负责上报 utils 侧证据。
- `core/data_acquisition.py` 的 commit=False 链已在多处逐行核实，TS 移植（TsOrchestration 切片）如需对齐单事务语义可引用本报告。
