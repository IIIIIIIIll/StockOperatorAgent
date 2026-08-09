# 设计：命名行构造（DataFrame → dataclass 列名映射）

## 架构与边界

```
data_structure/chinese_mainland/（3 个 dataclass 各加 classmethod）
    ChinaStockData.from_row(row, *, column_map=None, **overrides)
    StockOverview.from_row(row, *, column_map=None, **overrides)
    StockPerformanceReport.from_row(row, *, column_map=None, **overrides)
        —— 按**字段名**取值构造；缺列/字段缺失 → KeyError（响亮失败，
        替代位置错位的静默写垃圾）；column_map: 字段名 → 行内列名；
        overrides: 映射后覆写（akshare 业绩的 report_date 由调用方给）。

data_source 层（列名契约随列序常量同居，调用方传入 map）：
    overview.py  OVERVIEW_COLUMN_MAP = {字段名: 中文列名}（与 OVERVIEW_COLUMNS
                 同源：zip(fields(StockOverview), OVERVIEW_COLUMNS) 显式化）
    reports.py   REPORT_COLUMNS（已是英文字段名 → 恒等 map，不建新表）
    mapping.py   AKSHARE_HIST_COLUMNS（已是字段名 → 恒等）
    legacy_akshare.py YJBB_COLUMN_MAP（已有，akshare 业绩路径复用）

调用点替换（6 处位置构造清零）：
    data_acquisition.py:164   ChinaStockData.from_row(row)                [恒等]
    data_acquisition.py:214/232 StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)
    data_acquisition.py:321   StockPerformanceReport.from_row(row)        [恒等]
    legacy_akshare.py:88      StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)
                              （原 [1:] 丢弃序号列 → map 天然忽略未映射列）
    legacy_akshare.py:130     ChinaStockData.from_row(row)                [恒等]
    scripts/backfill_f10_quarters.py:77 StockPerformanceReport.from_row(row)
```

## 语义

- `from_row` 只取映射到的字段——行内**多余列忽略**（akshare 序号列不用
  再 [1:] 切片）；**缺失列 KeyError**（列序漂移从静默写垃圾 → 响亮失败）
- 恒等路径（column_map=None）：字段名即列名（daily/业绩 TDX 路径已如此）
- overrides：akshare 业绩路径 report_date 由调用方赋值（YJBB 映射不含
  该字段——现状语义保留）
- 与位置构造输出**逐字段等价**：同输入行 → 同 dataclass 值（新单测
  断言；既有 data_source/data_structure 测试全绿即等价证明）

## 顺带修复（PRD R3，验证后才动）

1. `ChinaStock.info` 死字段——grep 确认无消费者后移除
2. `ChinaStockData.date/ticker` 注解 object → str——**仅当**生产值恒为 str
   （daily 行来自 to_akshare_hist_schema，实现者核对）；测试 fixture 用
   datetime.date 构造的仍可跑（注解无运行时强制）
3. market_cap 孪生字段（StockOverview.circulating_market_cap vs
   StockInfo.float_market_cap）——只加兼容注释，**不动存储 schema**

## 兼容与风险

- 存储 schema 零改动（字段定义/顺序不变）——ZODB 数据兼容
- 位置构造的输出（含 NaN 语义）由 from_row 逐字段复现：row 缺失值
  （NaN/None）原样进字段（float64 注解不强制）
- 顺序契约文档（"顺序勿改"注释）更新为列名契约说明——列序不再承重
- 测试：新增 test/data_structure/test_row_constructors.py（class 风格）
  ——打乱列序/缺列 → KeyError；恒等与映射路径 == 位置构造输出；
  overrides 生效；多余列忽略
