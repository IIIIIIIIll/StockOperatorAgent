from dataclasses import dataclass

import persistent
from numpy import float64


@dataclass
class StockInfo(persistent.Persistent):
    value: float64
    ticker: str
    name: str
    total_shares: float64
    float_shares: float64
    market_cap: float64
    float_market_cap: float64  # 与 StockOverview.circulating_market_cap 语义孪生（08-09：只加注释，不动存储 schema）
    industry: str
    date_listed: str