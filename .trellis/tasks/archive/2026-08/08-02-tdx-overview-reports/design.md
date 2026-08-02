# 设计：TDX 覆盖个股概览与业绩报告

## 1. 数据流（纯 TDX 按需单股）

```
get_stock_data(ticker)
  ├─ ensure_stock(ticker)                 # storage 无 → 构建 overview
  │    ├─ snapshot（实时价）
  │    ├─ finance_capital（股本/行业）
  │    ├─ company_finance（F10 → eps/每股净资产 → PE/PB）
  │    ├─ daily（prev_close/60日前/年初 → 涨跌幅）
  │    └─ name：security_list 名称索引（全市场名称表，缓存；非行情扫描）
  │    → StockOverview(*list(row.values())) → put_stock
  ├─ acquire_historical_data_tdx(ticker)  # 已有
  └─ acquire_performance_report_tdx(ticker)
       └─ company_finance → pivot → StockPerformanceReport（+ QoQ 自算）
```

akshare 主流程调用全部移除；`AKShareSource` / 旧 `acquire_*` 方法保留（标注备用）。

## 2. 概览构建层（`data_source/chinese_mainland/tdx/overview.py`）

**契约**：输出**恰 22 列**（含代码列），与 `StockOverview` 22 字段序一致，
消费者用**全量 22 值构造** `StockOverview(*list(row.values()))`（无切片）——
与 akshare 路径不同：akshare spot_em 23 列（含序号）才需要 `[1:]`。
M1 实测确认：22 列 = 22 字段，`[1:]` 会丢 ticker 致 TypeError。已由
`test_tdx_overview.py` 钉死（`len(OVERVIEW_COLUMNS) == len(fields(StockOverview))`
+ 真实 DataFrame 路径构造断言）。

| StockOverview 字段 | 来源 | 计算 |
|---|---|---|
| ticker | — | 入参 6 位代码 |
| name | security_list 名称索引 | code→name 映射（模块级缓存；拉取失败 → 回退 ticker） |
| latest_price | snapshot.price | 实时；snapshot 失败 → 日K 末根收盘 |
| change_percent | — | (price - prev_close)/prev_close*100；prev_close = 日K 昨日收盘 |
| change_amount | — | price - prev_close |
| volume | 日K 当日 vol | 盘中无当日 → NaN |
| turnover(成交额) | 日K 当日 amount | 盘中无当日 → NaN |
| amplitude | — | (high - low)/prev_close*100 |
| high / low / open | snapshot | 实时 |
| previous_close | 日K 昨日收盘 | — |
| volume_ratio | — | NaN（pytdx 无） |
| turnover_rate | — | vol×100/liutongguben×100（日K 当日 vol） |
| pe_dynamic | F10 eps | price/eps（最新报告期）；eps≤0 → NaN |
| pb | F10 每股净资产 | price/每股净资产；≤0 → NaN |
| market_cap | — | price × zongguben |
| circulating_market_cap | — | price × liutongguben |
| momentum | — | NaN（pytdx 无） |
| change_percent_5min | — | NaN |
| change_percent_60days | 日K | (price - 60交易日前收盘)/前收盘×100 |
| change_percent_ytd | 日K | (price - 年初首个交易日收盘)/×100 |

失败策略（逐源降级，不整块失败）：snapshot/F10/日K 单项失败 → 该源字段 NaN +
logger.warning；名称索引拉取失败 → name 回退 ticker。整体无任何数据 → 返回
空 DataFrame（调用方 ensure_stock 报错回 False）。

## 3. 业绩报告层（`data_source/chinese_mainland/tdx/reports.py`）

F10 tidy long（metric × period）→ pivot 成每期一行。**输出 15 列** =
`StockPerformanceReport` 15 字段序（ticker 计入——下表不含 ticker 行，
M2 实测类声明为 15 字段，design 原写 14 为漏数），
`StockPerformanceReport(*list(row.values()))` 全量构造：

| StockPerformanceReport | F10 metric | 备注 |
|---|---|---|
| eps | 基本每股收益(元) | value_num |
| total_income | 营业总收入(元) | |
| total_income_YoY_rate | 营业总收入增长率(%) | F10 自带 |
| total_income_QoQ_rate | 自算 | (本期-上期)/上期，首期 NaN |
| net_profit | 净利润(元) | |
| net_profit_YoY_rate | 净利润增长率(%) | |
| net_profit_QoQ_rate | 自算 | 同上 |
| net_worth_per_share | 每股净资产(元) | |
| net_worth_return_rate | 加权净资产收益率(%) | |
| cash_flow_per_share | 每股经营现金流量(元) | |
| sales_gross_margin | — | NaN |
| industry | — | NaN（overview 有 industry，此处保持 NaN 简化） |
| name | security_list 名称索引 | 失败回退 ticker |
| report_date | period | 'YYYY-MM-DD' → '%Y%m%d' |

- pivot 键：period 升序排序后计算 QoQ；period 用字符串排序（ISO 格式可排序）✓
- `add_performance_report` 协议：report_date 字符串比较"更新才加"——按 period 升序
  添加天然满足
- 输出列序 = StockPerformanceReport 字段序（ticker,name,eps,...,report_date），
  复用 `*list(row.values())` 构造

## 4. DataAcquisition 重构

```python
def ensure_stock(self, ticker):
    if self.storage.get_stock(ticker) is not None:
        return True
    ov = TdxSource().build_overview(ticker)   # → overview.py
    if ov is None:
        logger.error("TDX overview build failed for {}", ticker)
        return False
    stock = ChinaStock.ChinaStock(ov.name, ov.ticker, ov)
    self.storage.put_stock(ticker, stock)
    return True

def acquire_performance_report_tdx(self, ticker):
    stock = self.storage.get_stock(ticker)
    if stock is None: return False
    for report in TdxSource().build_reports(ticker):   # → reports.py
        stock.add_performance_report(report)
    self.storage.put_stock(ticker, stock)
    return True

def get_stock_data(self, ticker):
    if not self.ensure_stock(ticker): return None       # 纯 TDX，无 akshare 回退
    self.acquire_historical_data_tdx(ticker)            # 既有（布尔，失败记日志）
    self.acquire_performance_report_tdx(ticker)
    return self.storage.get_stock(ticker)
```

- 移除对 `acquire_daily_overview` / `acquire_performance_report`（akshare）的调用；
  两方法保留不删（备用 + 既有测试引用）
- 新鲜度：ensure_stock 已存在即跳过（不每日刷新概览——按需构建语义）；
  历史数据新鲜度逻辑不变

## 5. TdxSource 扩展

- `build_overview(ticker) -> pd.DataFrame | None`（22 列序单行）
- `build_reports(ticker) -> pd.DataFrame | None`（单表每期一行 15 列序；无报告 → None）
- `get_stock_name(ticker) -> str`：security_list 名称索引（模块级缓存
  `_NAME_INDEX: dict[tuple[int, str], str]`，**(market, code)** 键——M1 实测：
  SH 列表含指数代码，纯 code 键会撞车（000001 SH=上证指数 vs SZ=平安银行），
  market 由 `infer_hq_market` 推断；首次按 market 0/1 拉取合并；失败 → 返回
  ticker 本身，name 永不 NaN）。**名称表全市场拉取（轻量，仅 code/name 两列），
  行情/股本/F10 等具体数据按需单股拉取**——不扫全市场行情

## 6. 测试

| 文件 | 类型 | 内容 |
|---|---|---|
| `test/data_source/test_tdx_overview.py` | 离线 | 合成 snapshot/F10/股本/日K → 22 列序断言 + PE/PB/市值/涨跌幅 golden |
| `test/data_source/test_tdx_reports.py` | 离线 | 合成 F10 tidy → 15 列序 + QoQ 自算 + report_date 格式 |
| `test/data_source/test_tdx_overview.py::live` | live | 000001 构建 overview 字段合理性 |
| `test/core/data_acquisition/test_data_acquisition_tdx.py` | 扩展 | ensure_stock 布尔协议 + get_stock_data 纯 TDX 全链路 |

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| snapshot quotes 通道实测不稳（quotes 空） | overview 用 vendor snapshot（实测可用）；quotes 通道不用 |
| 名称表首次拉取耗时（SH+SZ 分页） | 仅 code/name 两列，缓存一次；失败回退 ticker |
| PE/PB 用最新报告期 eps 非 TTM | 记录口径（动态 PE 近似），与 akshare 动态市盈率有差异 |
| 盘中 overview 的 volume/成交额为 NaN | 接受（收盘后分析场景为主）；文档注明 |
| BJ 股票（market=2）无 overview | 保留 akshare 备用路径；PRD 已声明不在范围 |

## 8. 回滚

- 新增文件（overview.py/reports.py）删除即卸载；`get_stock_data` 一行可还原为
  akshare 调用；akshare 方法全程未删
- 里程碑：概览 → 业绩 → 流程重构，各自测试绿再进下一步
