# py-core-data 审查报告

审查范围：core/data_acquisition.py（TDX 采集链主流程）、core/legacy_akshare.py（akshare 备用路径）、core/stock_output_formatter.py（纯字符串构建器）。
对照 spec：core/index.md、core/data-acquisition.md、data_storage/index.md、guides/index.md（防假阳性验证规则）。

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|core/data_acquisition.py|384|有发现（1 CRITICAL + 2 INFO）|
|core/legacy_akshare.py|252|有发现（2 INFO）|
|core/stock_output_formatter.py|42|无发现|

## 发现

### [CRITICAL] acquire_historical_data_tdx 在 scope 已标记 daily 失败时以 KeyError 崩溃，违反"预播种失败 → 消费者降级"契约

- **位置**: core/data_acquisition.py:148-159（触发源 FetchScope.fetch_daily :58-59 / :71-72）
- **问题**: 同一 FetchScope 内早先的 daily 拉取失败（预播种 `get_stock_data` :369 或 build_overview 阶段抛异常/返回空）时，`FetchScope.fetch_daily` 将 `("daily", ticker)` 记入 `_failed`，此后请求**直接返回无列空 DataFrame（`pd.DataFrame()`，不抛异常）**。`acquire_historical_data_tdx` 的 try/except 捕获不到空表（无异常），空表直接进入 `to_akshare_hist_schema` → `df["datetime"]` → **KeyError: 'datetime'**；该调用不在任何 try 内，异常穿透 `acquire_historical_data_tdx` → `get_stock_data` → `get_company_info`（唯一兜底是 `stock is None` 分支，KeyError 无 catch）→ LLM 工具调用崩溃。
- **触发条件（真实场景）**: TDX daily 瞬时失败（限流/网络抖动/新股尚无日K）而 snapshot 成功——首建路径预播种失败标记 failed → build_overview 用 snapshot 成功构建概览（`_fetch_degraded` 空→None 转换正常）→ ensure_stock True → `acquire_historical_data_tdx` 经 scope 取到空表 → KeyError 崩溃。已有股票 + 概览 stale 的刷新路径同样可达。与 FetchScope docstring"消费者按空降级"及 spec"预播种失败 → 消费者后续请求空 → 各自降级，保首建不阻断"直接冲突；现有测试（_CountingSrc 恒成功）未覆盖该降级路径。
- **证据**:
  ```python
  # core/data_acquisition.py:58-59（FetchScope.fetch_daily 失败短路）
  if key in self._failed:
      return pd.DataFrame()
  # core/data_acquisition.py:148-159（消费者无空检查）
  try:
      daily = tdx_source.fetch_daily(ticker, max_bars=max_bars)
  except Exception:
      logger.error("TDX daily fetch failed for {}; historical data unavailable.", ticker)
      return False
  # ← 此处无 daily is None/daily.empty 检查
  mapped = to_akshare_hist_schema(daily, ticker, float_shares=float_shares)
  # data_source/chinese_mainland/tdx/mapping.py:70
  # out["日期"] = pd.to_datetime(df["datetime"]).dt.date  → 无列空表 KeyError: 'datetime'
  ```
- **建议**: 在 daily 拉取后补空检查，与 `build_overview._fetch_degraded` 的空→降级语义对齐：
  ```python
  try:
      daily = tdx_source.fetch_daily(ticker, max_bars=max_bars)
  except Exception:
      logger.error("TDX daily fetch failed for {}; historical data unavailable.", ticker)
      return False
  if daily is None or daily.empty:
      logger.error("TDX daily returned no rows for {}; historical data unavailable.", ticker)
      return False
  ```
- **spec 对照**: 违反 data-acquisition.md"单遍拉取"段——"预播种失败 → warning + scope 标记 failed（消费者后续请求空 → 各自降级，保首建不阻断）"；`acquire_historical_data_tdx` 是唯一未实现空降级的消费者（build_overview 经 _fetch_degraded、reports 经 build_reports 均有空处理）。

### [INFO] _overview_stale 混用服务器本地时区时间戳与北京时间交易日

- **位置**: core/data_acquisition.py:255
- **问题**: `overview_last_update` 由 data_structure `ChinaStock.__init__` / `update_overview` 用 `datetime.datetime.now()`（服务器本地时区）盖章，而 `_overview_stale` 与 `get_last_business_day(asia_today())`（Asia/Shanghai）比较。服务器时区晚于 +8（如东京 +9）时：北京 08-13 23:30 构建的股票盖章日期已进入 08-14 → 08-14 当日分析判定"不 stale" → **跨交易日概览刷新被跳过一天**（违反方法注释"跨交易日必刷新"）；UTC 服务器则仅在凌晨多一次无害刷新。国内部署（+8）不受影响。仓库约定 `asia_today()` 为"全仓唯一今天来源"（time_helper docstring 明确防时区漂移），本门未遵循。
- **证据**: `return stock.overview_last_update.date() < get_last_business_day(asia_today())`（255 行）；data_structure/chinese_mainland/ChinaStock.py：`self.overview_last_update = datetime.datetime.now()`。
- **建议**: 盖章改用 `asia_today()`（`datetime.datetime.combine(asia_today(), datetime.time.min)`），与全仓时区约定一致；改动点位于 data_structure 两处盖章位。
- **spec 对照**: data-acquisition.md"ensure_stock"段 freshness 门注释"同日多次分析结果稳定，跨交易日必刷新"在非 +8 时区不成立（属 WARNING 级别潜在 bug 的边界情形，受部署时区限制，按 INFO 上报）。

### [INFO] 北交所 ticker 预播种在 is_bj_ticker 拦截之前发起必然失败的 TDX 全量拉取

- **位置**: core/data_acquisition.py:365-372（拦截点 231 行）
- **问题**: `get_stock_data` 首建分支先 `scope.fetch_daily(ticker, max_bars=None)` 预播种（365-371），之后才在 `ensure_stock` 内 `is_bj_ticker` 拦截（231 行）。每次 BJ 代码查询（UI 已明确提示不支持）都会先发起一次必然失败的 TDX 全量日K拉取 + warning 日志噪音。若 legacy akshare 路径（update_bjex_overview）曾种入 BJ 股票，已有股票分支同样先预播种再尝试刷新。结果正确（返回 None/保留旧概览），仅无效网络请求 + 噪音。
- **证据**: `scope.fetch_daily(ticker, max_bars=None)`（369 行）→ `if not self.ensure_stock(ticker, _scope=scope): return None`（372 行）→ ensure_stock 内 `if is_bj_ticker(ticker): ... return False`（231-235 行）。
- **建议**: 在 `get_stock_data` 入口（预播种之前）做 `is_bj_ticker(ticker)` 提前短路，复用 ensure_stock 内同一判断逻辑。
- **spec 对照**: data-acquisition.md ensure_stock 段"北交所（4/8 前缀）：TDX 全链路不可用"——拦截语义正确，但位置晚于预播种，拦截收益被先行网络请求抵消。

### [INFO] legacy acquire_historical_data 逐行 commit（与 TDX 双胞胎的批量单事务模式不一致）

- **位置**: core/legacy_akshare.py:135-142
- **问题**: 备用路径 `acquire_historical_data` 循环内逐行 `stock.add_data()`（`add_data → add_datas` 默认 `commit=True`，每行一次 transaction.commit），再加 `put_stock` 一次 commit。多年回填约 1500 行 = 1500 次 FileStorage tpc；TDX 双胞胎（review #3）已是"先收集 rows → `add_datas(commit=False)` → `put_stock` 单事务"。属明确标注 deprecated 的备用路径（spec："akshare 备用路径可独立演进"），非主流程缺陷，仅性能/一致性提示。
- **证据**: `for row in AKShareSource().fetch_stock_history(...).to_dict(...): ... stock.add_data(stock_data)`（135-140 行）→ `self.storage.put_stock(ticker, stock)`（142 行）。
- **建议**: 若后续维护该备用路径，仿 TDX 版本改为收集后 `add_datas(rows, commit=False)` + `put_stock` 单事务。
- **spec 对照**: data_storage/index.md"Transaction Rules"——"逐行 commit 是 anti-pattern"；备用路径保留逐行行为属 spec 明确的独立演进豁免（非违规）。

### [INFO] legacy update_overview_in_storage 双 commit + 每行 logger.info 全对象

- **位置**: core/legacy_akshare.py:102-104
- **问题**: 已存在股票分支 `stock.update_overview(new_overview=...)`（默认 `commit=True` 内部提交）+ `put_stock` 再 commit = 一行两次事务；随后 `logger.info(stock_overview)` 打印整个 22 字段 dataclass，全市场刷新（沪+深+北约 5000 行）时日志爆炸。deprecated 备用路径，非主流程缺陷。
- **证据**: `stock.update_overview(new_overview=stock_overview)`（102 行）→ `self.storage.put_stock(stock_overview.ticker, stock)`（103 行）→ `logger.info(stock_overview)`（104 行）。
- **建议**: 备用路径若保留，`update_overview` 传 `commit=False` 由 `put_stock` 单次提交；日志降为 `logger.debug` 关键字段。
- **spec 对照**: data_storage 单事务链模式（08-09）仅约束主流程链上调用；本方法为遗留路径默认行为（非违规）。

## spec 符合性结论

- **core/data_acquisition.py**：FetchScope 单遍拉取、预播种时机（ensure_stock 之前）、三门 helper 共用单份实现、单事务链（`commit=False` → `put_stock` → commit）、锁范围（数据阶段全程持 `storage.lock` RLock、图阶段不持锁）、Boolean 结果协议、纯 TDX 无 akshare 兜底、AKShareSource 惰性导入——均与 data-acquisition.md 一致。**唯一实质偏离：预播种失败后的消费者降级契约在 `acquire_historical_data_tdx` 未实现——空表直接进入 `to_akshare_hist_schema` 抛 KeyError 崩溃（CRITICAL）**。FetchScope 复用按请求尺寸（`cached_bars ≥ max_bars`）而非实际行数的设计已核实正确（250 拉取短历史返回 <250 行复用是正确语义）。
- **core/legacy_akshare.py**：akshare 惰性导入、YJBB_COLUMN_MAP 字段名→列名映射 + 存在性断言（缺列 → logger.error + None/False，不静默写垃圾）、`from_row` 命名构造、report_date 调用方覆写——符合 spec；逐行 commit / 双 commit / 全对象日志为 spec 允许保留的备用路径遗留行为（INFO）。
- **core/stock_output_formatter.py**：纯字符串构建器（无 I/O、无数据获取）、全部数值经 `utils.formatting.fmt_number` 单点渲染（NaN/None → "N/A"，数值两位小数，已核对 fmt_number 实现：`isinstance(value, float) and pd.isna(value)`，numpy.float64 是 float 子类故 NaN 正确命中）、`historical_data[-60:]` / `performance_reports[-20:]` 窗口、已知 dead import（`openpyxl.styles.builtins.output` 被局部变量遮蔽，spec 注明保留）——符合 spec，无发现。
