# 修复 TDX 派生正确性

## Goal

修复审计中危 6 项 + 低危 5 项：formatter NaN 渲染、industry 类型契约、
adjust 成交量因子污染、QoQ 相邻性、ytd 首日口径、latest_period_value NaN、
mapping 两个边界、_NAME_INDEX 固化、BJ 范围声明、F10 命中率告警。
每项带测试。**依赖**：`utils/time_helper.asia_today()` 由
fix-data-correctness 产出（若未合入则本任务顺带实现，不重复两处）。

## 修复清单

### 1. Formatter NaN 渲染（中）

- `core/stock_output_formatter.py`：TDX 概览恒有 3 个 NaN 字段（量比/涨速
  momentum/5分钟），另换手率/成交量盘中、历史首行振幅/涨跌幅为 NaN → 每个
  prompt 都带 `nan%`/`nanlots`。
- 修法：复用 `get_trend_indicators._fmt` 的 NaN→"N/A" 思路（或抽公共 helper
  进 `utils`），overview 行与历史行统一渲染；数值保留两位小数风格不变。
- 验收：`format_stock_output` 输出无字面 `nan`；golden 字符串断言。

### 2. `industry` float NaN 进 str 字段（中）

- `reports.py:127` 写 `float("nan")` 进 `StockPerformanceReport.industry: str`
  → 改空串 `""`（保持 str 契约）。`sales_gross_margin` 保持 NaN（float64）。
- 验收：构造报告 industry == ""；测试断言类型。

### 3. adjust.py 成交量因子污染（中）

- `adjust.py:56-60`：xdxr 任一字段 NaN → `float("nan") or 0` 得 nan →
  `ratio_vol=nan` → 事件前所有 bar 成交量变 NaN。`songzhuangu` 存在但为
  NaN 时 fallback 不触发。
- 修法：字段取值 `v if pd.notna(v) else 0.0`；`ratio_vol <= 0`（如 10:1 缩股）
  → 跳过成交量调整 + `logger.warning`（价格因子照算）。
- 验收：合成含 NaN 字段的 xdxr → 事件前成交量不被污染；缩股用例不除零。

### 4. QoQ 相邻性校验（低-中）

- `reports.py _qoq_series`：`shift(1)` 不校验相邻性——缺报告期时跨 2+ 季度
  静默算环比。
- 修法：仅当相邻 period 间隔恰为一个季度（3 个月 ±容差）才算环比，否则
  NaN。period 是 'YYYY-MM-DD' 字符串 → 转 date 比较。
- 验收：缺一期数据 → 跨期位置 QoQ 为 NaN，相邻期正常。

### 5. ytd 首日口径与跨年边界（低）

- `overview.py _ytd_base_close`：(a) 年初首个交易日 base=当日自身收盘 →
  YTD=0% 漏首日；(b) 日K末根停牌停留在去年 → 用去年第一根比今年价，无意义。
- 修法：(a) 窗口内存在上年末 bar 时优先用上年末收盘；(b) 末根 bar 年份 ≠
  今年时 ytd 置 NaN。
- 验收：合成年初窗口数据 → 首日 YTD 正确；跨年停牌 → NaN。

### 6. `latest_period_value` NaN period（低）

- `overview.py:137`：period 为 NaN → `astype(str)` 得 `'nan'` 字典序最大，
  掩盖真实最新期。修法：`dropna(subset=["period"])` 后再 idxmax。
- 验收：喂含 NaN period 的 F10 → 返回真实最新期值。

### 7. mapping.py 两个边界（低）

- `mapping.py:68`：`vol.astype("int64")` 遇 NaN 抛 ValueError（在
  `acquire_historical_data_tdx` 的 try 之外 → 炸整条链）→ `fillna(0)` 先。
- `mapping.py:75`：`if float_shares:` 在 0.0 时 falsy → 换手率静默 NaN →
  改 `is not None`。
- 验收：合成含 NaN vol / 0.0 流通股本 → 不抛错且换手率语义正确。

### 8. `_NAME_INDEX` 部分失败固化（低）

- `tdx_source.py`：market 1 拉取失败仍置 `_NAME_INDEX_LOADED=True` → 进程内
  该市场名称永久回退 ticker。修法：两市场都成功才置 LOADED；或按缺失惰性
  补拉（取简单方案：两市场成功才 LOADED，失败市场下次 get_stock_name 重试）。
- 验收：模拟 market 1 失败 → 下次调用重试而非固化。

### 9. BJ 代码范围声明（低）

- 北交所（4/8 前缀）TDX 全链路不可用（无名称/无行情）。修法：
  UI ticker 校验或入口处显式 `logger.warning` + 返回失败提示；README 注明
  BJ 走 akshare 备用路径（已声明）。
- 验收：输入 BJ 代码 → 明确提示不支持而非静默 NaN。

### 10. F10 metric 命中率告警（低，可选）

- 8 个 F10 指标名与 vendor 文本强耦合，vendor 改名即全部 NaN 无告警。
  修法：`compose_reports`/`latest_period_value` 统计已知 metric 命中率，
  低于阈值（如 50%）`logger.warning`。
- 验收：合成低命中 F10 → warning 日志出现。

## Acceptance Criteria

- [ ] 10 项全部修复并有测试；定向测试全绿
- [ ] `format_stock_output` 无字面 `nan`
- [ ] 全量 pytest 0 failed 保持
- [ ] data_source spec 同步（adjust/reports/mapping 契约修正）

## Constraints

- 时区工具（`_last_bar_is_today` 的 Asia/Shanghai 统一）复用
  fix-data-correctness 的 `asia_today()`；若该任务未合入，本任务先实现
  同函数于 `utils/time_helper`（单点落位）
- deprecated 测试零改动
