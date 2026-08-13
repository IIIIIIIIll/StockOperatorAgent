# py-data-source 审查报告

审查者: PyDataSource（分片：Python 数据源层 akshare + billions + tdx 主仓）
审查范围: 9 文件（1306 行）全量通读 + 跨文件引用核实（vendor tdx_client/tdx_xdxr/
code_mapping/fetch_realtime_watchlist、core/data_acquisition.py、
core/llms/tools/get_financial_indicators.py、get_market_intel.py）
依据 spec: .trellis/spec/data_source/index.md / tdx.md / mapping.md / guides/index.md

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|data_source/chinese_mainland/akshare/fetch_stcok_data.py|47|无发现（薄包装形状合规；文件名 typo 为刻意保留，不计）|
|data_source/chinese_mainland/billions/__init__.py|6|无发现（纯模块 docstring）|
|data_source/chinese_mainland/billions/client.py|214|有发现（INFO×2）|
|data_source/chinese_mainland/tdx/adjust.py|111|无发现（复权算法与 spec 实测约定逐条核对一致）|
|data_source/chinese_mainland/tdx/f10_parser.py|127|无发现（日期头子表并入/去重/亿万归一与 spec 一致）|
|data_source/chinese_mainland/tdx/mapping.py|95|无发现（命名构造/列序契约/NaN vol 修复与 spec 一致）|
|data_source/chinese_mainland/tdx/overview.py|274|无发现（22 列契约/逐源降级/YTD 基准与 spec 一致）|
|data_source/chinese_mainland/tdx/reports.py|196|无发现（15 列契约/QoQ 相邻性校验/industry 空串与 spec 一致）|
|data_source/chinese_mainland/tdx/tdx_source.py|236|有发现（WARNING×1, INFO×1；导入接缝评估见下）|

## 发现

### [WARNING] fetch_company_finance_raw 的 market 推断在 try 之外，违反"不 raise"契约
- **位置**: data_source/chinese_mainland/tdx/tdx_source.py:114-115
- **问题**: 函数 docstring 承诺"文件缺失/空/损坏 → None（不 raise，error-handling
  约定，调用方回退 vendor 解析 df）"，但 `infer_hq_market(ticker)` 与
  `market_code_to_ts_code(...)` 两个调用位于 try 块之前。vendored
  `infer_hq_market`（fetch_realtime_watchlist.py:76-82）对不以 0-9（除 7 外）
  开头或非数字的代码**抛 ValueError**（如 7 前缀 '7xxxxx'、'BTC-USD' 之类）。
  该异常会穿透 `build_reports`（raw 路径未包 try，仅回退路径有 try）与
  `acquire_performance_report_tdx`（无 try），也穿透
  `get_financial_indicators`（core/llms/tools，直接调用本函数、同样承诺
  "降级（不 raise）"）——调用方本应按降级语义处理，实际却把裸 ValueError
  抛给 agent 工具链。触发面：BJ 代码（4/8）虽在入口拦截，但 7 前缀/非数字
  代码在 get_company_info 入口只过了 is_bj_ticker 检查即直达
  get_stock_data→build_reports；LLM 生成的 ticker 亦可能畸形。修复成本 2 行。
- **证据**:
  ```python
  from scripts.data_pipeline.code_mapping import market_code_to_ts_code  # noqa: E402
  ts_code = market_code_to_ts_code(infer_hq_market(ticker), ticker)   # 在 try 之外
  ```
  vendor: `raise ValueError(f'Unable to infer mainland market for code: {code}')`
- **建议**: 将这两行移入 try 块（或单独 try/except → return None），使"任何
  异常 → None"的契约名副其实。
- **spec 对照**: 违反 data_source/tdx.md "F10 失败/空 → None + logger.warning"
  与 error-handling 降级约定（函数自述契约与其实现不一致）。

### [INFO] client._post 用身份比较判 success，JSON 数字 0 会被当成功
- **位置**: data_source/chinese_mainland/billions/client.py:111
- **问题**: `data.get("success") is False` 是身份比较——JSON `false` 解析为
  `False` 单例可命中，但若上游某端点返回 `"success": 0`（数字），`0 is False`
  为 False，响应被当作成功放行（业务失败静默吞掉）。`== False` 与 `is False`
  对缺失键（None）行为等价，改用 `==` 无副作用、覆盖面更全。
- **证据**: `if not isinstance(data, dict) or data.get("success") is False:`
- **建议**: 改为 `data.get("success") == False`（或 `not data.get("success", True)`）。
- **spec 对照**: 对齐 index.md "200 + success:false → 抛 BillionsApiError" 的
  意图；数字假值属上游 schema 外输入，按健壮性建议。

### [INFO] search/twitter_search 未知 search_mode 静默回退 fast 档
- **位置**: data_source/chinese_mainland/billions/client.py:166, 181
- **问题**: `_MODE_TIMEOUTS.get(search_mode, _MODE_TIMEOUTS["fast"])` 对未知名
  静默映射到 25s 档。调用方传错档位（如 "expert " 带空格）时，客户端 25s
  就超时，而服务端按 expert 语义等待 110s → 本可成功的请求被误报
  BillionsApiError 超时，且无任何日志提示档位不识别。
- **证据**: `timeout = _MODE_TIMEOUTS.get(search_mode, _MODE_TIMEOUTS["fast"])`
- **建议**: 未知档位 logger.warning + 回退，或直接抛 ValueError（薄包装
  形状下显式失败优于静默换档）。
- **spec 对照**: 偏离 index.md "search 按档位 fast 25 / advanced 70 / expert 120"
  的档位语义（未知值未按设计失败/提示）。

### [INFO] _load_name_index 对模块级 _NAME_INDEX 写入无锁，并发首拉可重复
- **位置**: data_source/chinese_mainland/tdx/tdx_source.py:189-215
- **问题**: `get_stock_name` 在 `_NAME_INDEX_LOADED=False` 时调用
  `_load_name_index`，多个线程（agent 并行分析多股）可同时触发全市场
  证券列表网络拉取（~2.1 万行/市场 ×2，多页往返）并交错写入 `_NAME_INDEX`。
  数据同源故无内容损坏，但重复拉取放大网络成本，且 `ok`/flag 判定在线程
  交错下语义模糊。`get_tdx_source` 单例有锁而名称索引没有。
- **证据**: `for market in (0, 1): ... _NAME_INDEX[(market, str(code))] = str(name)`
  （无 lock 包裹）
- **建议**: 复用 `_instance_lock` 或独立锁包裹 `_load_name_index` 的"检查-拉取-
  置位"（双检锁，照 get_tdx_source 模式）。
- **spec 对照**: 与 tdx.md "模块级缓存 + 双重检查锁"的单例模式不一致（名称索引
  未套用同款锁）。

## 导入接缝评估（tdx_source.py，任务重点项）

- **sys.path 插入**：`ensure_vendor_on_path()` 模块级执行、幂等
  （`if str(VENDOR_ROOT) not in sys.path`），随后模块级
  `from scripts.data_pipeline.tdx_client import TdxDownloader`（vendor
  闭包 28 文件/1644 行，08-09-vendor-surface-audit 实测）。一次性插入 +
  vendor 绝对导入原样可用，与 VENDOR.md/tdx.md 描述一致；副作用为模块导入
  即改全局 sys.path，但属本模块存在前提（消费方必先 import tdx_source），
  设计可接受。无循环导入（vendor 不自引回应用层）。
- **TdxMcpClient 门控**：**tdx_source.py 内无 TdxMcpClient import**——直接
  vendor import 在 `core/llms/tools/get_market_intel.py:26`（本分片范围外），
  构造在 `_query_mcp()` 函数内、经 `_mcp_disabled()`（TDX_MCP_ENABLED）门控，
  与 VENDOR.md 记录一致。本文件内 vendor import 仅 TdxDownloader +
  infer_hq_market，均无门控——但这是本数据源模块的核心依赖（无 vendor 即无
  数据），属设计内，非缺陷。
- **日K 读缓存待办**：tdx.md 待办段（未实现理由存档）与
  `fetch_security_list` 当日快照读缓存的唯一例外声明，均与代码一致
  （vendor `write_by_symbol` 写覆盖、`download_security_list` 用
  `date.today()` 写分区、本层同用 `date.today()` 读——读写同源，无时区错配）。

## spec 符合性结论

- **akshare 层**：完全符合（class per source / method per endpoint / raw
  DataFrame 原样返回；文件名 typo 刻意保留；`_natural_day_window` 自然日
  换算注释完整）。
- **billions 层**：符合（懒加载 httpx、_http/_key 注入、超时档位 25/70/120/90/120、
  错误归一化 BillionsApiError、不重试 429、success+result[].status 语义均由
  docstring+实现双重对齐）；仅 2 条 INFO 级健壮性建议。
- **tdx 层**：符合（mapping 命名构造 + 列名契约、adjust 复权单位/因子累乘/
  vol 舍整、f10_parser 双表并入/去重、overview 22 列/逐源降级/YTD 基准、
  reports 15 列/QoQ 相邻性/industry 空串——均与 tdx.md/mapping.md 逐条核对
  一致）；1 条 WARNING（fetch_company_finance_raw 的 try 边界）为唯一偏离，
  属"函数自述契约 vs 实现"不一致，非 spec 文本冲突。
- 反模式检查：9 文件中无"source 内包装/清洗 DataFrame"（akshare/tdx 均原样
  返回）、无位置构造 dataclass（消费方全走 from_row + column_map/恒等路径）。
