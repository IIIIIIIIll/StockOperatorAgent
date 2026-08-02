# TDX 覆盖个股概览与业绩报告

## Goal

纯 TDX 数据链路：个股概览 + 业绩报告全部由 TDX（pytdx + 派生计算）提供，
akshare 不再参与主流程。**用户决策：纯 TDX 不兜底，缺失字段能算的自算，
算不了的留 NaN。**

## Background（研究结论 2026-08-02）

| 数据 | TDX 来源 | 覆盖情况 |
|---|---|---|
| 概览-行情 | `snapshot`（price/open/high/low，实测可用） | 部分 |
| 概览-股本/行业 | `fetch_finance_capital`（zongguben/liutongguben/industry/province） | ✅ |
| 概览-估值 | F10 eps/每股净资产 → PE/PB 派生 | ✅ 派生 |
| 概览-市值 | 现价 × 股本 派生 | ✅ 派生 |
| 概览-涨跌幅/60日/ytd | 日K 派生（prev_close/60日前/年初） | ✅ 派生 |
| 概览-name | `security_list` 名称索引（code/name，实测有 name） | ✅（缓存；失败回退 ticker） |
| 概览-量比/5分钟/动量 | pytdx 无 | NaN |
| 业绩报告 | `company_finance`（F10 tidy long，108 行=指标×期） | 10/14 字段 + 环比自算，毛利率 NaN |

关键设计：akshare 的 overview/业绩是**全市场行情扫描**；TDX 无等效全市场
行情，改为**按需单股构建**（分析哪只构建哪只）。**名称表可全市场拉取**
（仅 code/name 两列，轻量），行情/股本/F10 等具体数据一律按需单股。

## Requirements

### 个股概览（TDX 按需单股）

- `data_source/chinese_mainland/tdx/` 新增 overview 构建模块：
  - 行情：`TdxSource.fetch_snapshot`（price/open/high/low）
  - 股本/行业：`fetch_finance_capital`（zongguben/liutongguben/industry/province）
  - 估值派生：PE = price/eps、PB = price/每股净资产（F10 最新报告期）
  - 市值派生：market_cap = price×zongguben、circulating = price×liutongguben
  - 涨跌派生：涨跌幅/振幅 = vs prev_close（日K 昨日收盘）；60日涨跌幅（60 交易日前
    收盘）；年初至今（年初首个交易日收盘）
  - volume/成交额：收盘后用日K 当日值（盘中为缺失 → NaN）
  - name：security_list 名称索引（模块级缓存；失败回退 ticker，永不 NaN）
  - 量比/5分钟涨跌/动量：NaN（pytdx 无数据）
- 输出：akshare `stock_*_a_spot_em` 相同的 22 列序（与 StockOverview 字段一致，
  位置构造复用）

### 业绩报告（TDX 按需单股）

- F10 tidy long → 按报告期 pivot → StockPerformanceReport 14 字段：
  - eps/营业总收入/净利润/每股净资产/加权ROE/每股经营现金流量 直接映射
  - YoY 增长率：F10 自带（营业总收入增长率/净利润增长率）
  - QoQ 环比：相邻报告期自算（营收/净利）
  - sales_gross_margin：F10 无 → NaN；name：security_list 名称索引（失败回退 ticker）
  - report_date：period 'YYYY-MM-DD' → '%Y%m%d'
- 与 `add_performance_report` 的 report_date 字符串比较协议兼容

### DataAcquisition（纯 TDX 主流程）

- 新增 `ensure_stock(ticker)`：storage 无该股票 → TDX 构建 overview → put_stock
- 新增 `acquire_performance_report_tdx(ticker)`：F10 → 报告列表 → add_performance_report
- `get_stock_data` 重构为纯 TDX 按需链路：ensure_stock → 历史数据(TDX) → 业绩报告(TDX)
- akshare 路径代码**保留不动**（回退可能性），但主流程不再调用
- 布尔协议 + 新鲜度优先不变

## Acceptance Criteria

### 概览

- [ ] 离线单测：合成 snapshot/F10/股本/日K → 22 列序与 StockOverview 字段一致，
      PE/PB/市值/涨跌幅/60日/ytd 派生值正确（golden values）
- [ ] live：`000001` 构建 overview 成功，name/price/market_cap/PE/PB 合理
- [ ] 缺量比/5分钟/动量 = NaN，不报错

### 业绩报告

- [ ] 离线单测：合成 F10 tidy → StockPerformanceReport 字段正确（含 QoQ 自算）
- [ ] live：`000001` F10 → ≥1 份报告，eps/净利合理，report_date 为 '%Y%m%d'
- [ ] 环比计算首期 NaN，无除零错误

### 流程

- [x] `get_stock_data('000001')` 纯 TDX 跑通（overview + 历史 + 业绩全链路）
      —— 实测 120 日K + 6 份报告 + 平安银行
- [x] 全量 pytest 无新增失败 —— 实测 **8F/59P/20S，3.5 分钟**（2026-08-02
      deprecated 后基线：akshare/qwen 相关 21 个 live 测试标记 skip，8F 全为
      既有环境性失败：ChinaStock('dummy') 损坏 ×2、ZODB 锁泄漏传染、周末
      日历边界；原 29F/32P 基线含网络类失败已消除，见 testing.md）
- [x] spec/README 更新（data_source、core、architecture、testing、error-handling）

## Constraints

- 纯 TDX：主流程不调用 akshare；akshare 代码保留但标注"备用"
- vendor 代码尽量零改动；确需微调（如 snapshot 字段扩展）须记 VENDOR.md 差异
- 按需单股构建，不做全市场扫描（screener 等离线批量场景另议）
- 北交所（market=2）不在本任务范围（pytdx 通道覆盖 0/1；akshare BJ 路径已保留）
