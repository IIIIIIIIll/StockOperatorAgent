from dataclasses import dataclass, fields

import persistent
from numpy import float64


@dataclass
class StockOverview(persistent.Persistent):
    ticker: str
    name: str
    latest_price: float64
    change_percent: float64
    change_amount: float64
    volume: float64
    turnover: float64
    amplitude: float64
    high: float64
    low: float64
    open: float64
    previous_close: float64
    volume_ratio: float64
    turnover_rate: float64
    pe_dynamic: float64
    pb: float64
    market_cap: float64
    circulating_market_cap: float64  # 与 StockInfo.float_market_cap 语义孪生（08-09：只加注释，不动存储 schema）
    momentum: float64
    change_percent_5min: float64
    change_percent_60days: float64
    change_percent_ytd: float64

    @classmethod
    def from_row(cls, row, *, column_map=None, **overrides):
        """按字段名命名构造（design 08-09-named-row-constructors）：位置构造的
        替代——行内**列名**承重而非列序，列序漂移从静默错位 → 响亮失败。

        - column_map: 字段名 → 行内列名（None = 恒等，字段名即列名；
          TDX/akshare 概览路径传 OVERVIEW_COLUMN_MAP，见 data_source/tdx/overview.py）
        - 缺列（row 无映射列）→ KeyError（位置构造遇列序漂移会静默写垃圾）
        - 行内未映射列忽略（akshare 序号列不再需要 [1:] 切片）
        - overrides: 映射后覆写（调用方给的字段）
        - 与位置构造逐字段等价：row 缺失值（NaN/None）原样进字段
          （numpy 注解不强制）
        """
        if column_map is None:
            values = {f.name: row[f.name] for f in fields(cls)}
        else:
            values = {f: row[c] for f, c in column_map.items()}
        values.update(overrides)
        return cls(**values)
