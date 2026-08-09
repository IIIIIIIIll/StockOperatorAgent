from dataclasses import dataclass, fields

import persistent
from numpy import float64

@dataclass
class StockPerformanceReport(persistent.Persistent):
    ticker: str
    name: str
    eps: float64
    total_income: float64
    total_income_YoY_rate: float64
    total_income_QoQ_rate: float64
    net_profit: float64
    net_profit_YoY_rate: float64
    net_profit_QoQ_rate: float64
    net_worth_per_share: float64
    net_worth_return_rate: float64
    cash_flow_per_share: float64
    sales_gross_margin: float64
    industry: str
    report_date: str

    @classmethod
    def from_row(cls, row, *, column_map=None, **overrides):
        """按字段名命名构造（design 08-09-named-row-constructors）：位置构造的
        替代——行内**列名**承重而非列序，列序漂移从静默错位 → 响亮失败。

        - column_map: 字段名 → 行内列名（None = 恒等，字段名即列名；
          TDX 业绩路径的 REPORT_COLUMNS 已是字段名 → 恒等；akshare yjbb
          路径传 YJBB_COLUMN_MAP，见 core/legacy_akshare.py）
        - 缺列（row 无映射列）→ KeyError（位置构造遇列序漂移会静默写垃圾）
        - 行内未映射列忽略（akshare 序号列不再需要 [1:] 切片）
        - overrides: 映射后覆写（akshare 业绩路径的 report_date 由调用方给）
        - 与位置构造逐字段等价：row 缺失值（NaN/None）原样进字段
          （numpy 注解不强制）
        """
        if column_map is None:
            values = {f.name: row[f.name] for f in fields(cls)}
        else:
            values = {f: row[c] for f, c in column_map.items()}
        values.update(overrides)
        return cls(**values)
