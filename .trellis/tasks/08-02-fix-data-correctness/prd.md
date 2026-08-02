# 修复数据获取与新鲜度正确性

## Goal

修复审计高危 3 项 + 中危 5 项：UI key 检查与 LLM 构造矛盾、120 根历史永久
缺口、yjbb_em 列序错位、date==datetime 恒假、latest_possible_date 拉未来、
时区漂移、legacy 自然日缺口、备用路径 ticker 硬编码。每项带测试。

## 修复清单

### 1. UI key 检查与 LLM 构造矛盾（高）

- `core/ui/display.py` 检查"DEEPSEEK **或** DASHSCOPE 任一存在"即放行，但
  `investment_committee.py` 永远构造 `DeepSeekApi()` → 只配 DASHSCOPE 时
  崩溃（OpenAIError）。
- 修法：检查改为**只认 `DEEPSEEK_API_KEY`**（与实现一致）；缺失时 UI 提示
  引导配置 DeepSeek key（保留中文提示风格）。同步修正 architecture.md 断言。
- 验收：只配 DASHSCOPE 或无 key 时 UI 显示提示不崩溃；配 DEEPSEEK 正常。

### 2. 历史数据 120 根永久缺口（高）

- `core/data_acquisition.py`（TDX + legacy 两处）：缺口 > 120 交易日时
  `look_back_days` 截断 → `add_data` 拒绝补旧 → 永久空洞、新股票只有 120 根。
- 修法：gap > 120（或首次构建）时 `max_bars=None`/`look_back_days=gap` 全量
  回填一次，再走增量。TDX 路径 `fetch_daily(ticker, max_bars=None)` 拉全量。
- 验收：模拟 200 交易日缺口 → 数据完整无空洞；新股票全量构建。

### 3. `stock_yjbb_em` 列序错位（高，akshare 备用路径）

- `core/data_acquisition.py:192` `StockPerformanceReport(*list(row.values())[1:])`
  与 yjbb_em 实际列序不匹配（eps..QoQ 吃到 `_` 占位、`industry` 吃到净资产
  收益率）——备用路径启用即写垃圾（源码级验证）。
- 修法（**位置构造例外授权**）：按列名映射构造（`row[["股票代码", ...]]`
  到 StockPerformanceReport 字段）+ 列名存在性断言；列名不符时
  `logger.error` + 返回 False 而不是静默写垃圾。
- 验收：合成 yjbb_em 列序数据 → 字段映射正确；列序变化 → 断言拦截不写库。

### 4. `last_data_update == datetime.today()` 恒假（中，两处）

- `core/data_acquisition.py:64,102`：date 与 datetime 永不相等 → 新鲜度
  短路死代码，每次无谓重拉（靠 add_data 去重掩盖）。
- 修法：改为 `== datetime.today().date()`（TDX + legacy 两处）。
- 验收：`test_freshness_skip` 语义增强：当日已拉 → 跳过路径真实生效。

### 5. `latest_possible_date` 拉未来报告期（中，akshare 备用）

- `acquire_performance_report` 的 1-3 月分支用 `today.year + '1230'` → 拉
  未来报告期 + 永远漏去年年报；`'1230'` vs `'1231'` 差一天。
- 修法：month<4 分支用 `(year-1, '1231')`；其余月份分支核对 `'0930'/'0630'`
  的 30/31 问题。
- 验收：2026-02 模拟 → 上限为 2025-12-31，且 2025 年报在轮询范围内。

### 6. 时区漂移统一（中，跨层）

- 新增 `utils/time_helper.asia_today()`（`datetime.now(ZoneInfo("Asia/Shanghai"))`
  的 date）作为唯一"今天"来源。
- 替换：`check_need_update_overview`（ZODBStorage.py 17:00 门）、
  `fetch_stcok_data.py:31`（akshare 日K 窗口边界）。（`overview.py`
  `_last_bar_is_today` 在 fix-tdx-correctness 复用本工具，不重复实现。）
- 验收：非中国时区模拟（TZ 环境变量）下判定与北京时间一致。

### 7. legacy 自然日 vs 交易日缺口（低-中，akshare 备用）

- `fetch_stock_history` 的 `start_date` 按自然日 `look_back_days+1` → 天然
  少拉约 30%。
- 修法：传 `look_back_days*7//5` 自然日余量（或提前 1.5 倍），靠 `add_data`
  去重。
- 验收：合成日历验证余量公式。

### 8. 备用路径 ticker 硬编码（低）

- `acquire_performance_report` 硬编码 `'601988'` → 参数化（或 docstring
  标注演示代码 + 显式 `logger.warning`）。方法与调用方签名保持兼容。
- 验收：调用方可传 ticker。

## Acceptance Criteria

- [ ] 8 项全部修复并有测试；定向测试全绿
- [ ] 全量 pytest 0 failed 保持（父任务验收前）
- [ ] architecture.md / data_source spec 同步（key 检查断言、yjbb 列序
      实测结论、列名映射例外）
- [ ] 主流程（TDX）行为零变化（冒烟 get_stock_data('000001') 正常）

## Constraints

- `utils/time_helper` 是时区/日期工具唯一落点，本任务产出 `asia_today()`
  供 fix-tdx-correctness 复用
- deprecated 测试零改动；akshare 方法保留（备用）
