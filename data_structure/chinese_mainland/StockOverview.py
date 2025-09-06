from dataclasses import dataclass

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
    circulating_market_cap: float64
    momentum: float64
    change_percent_5min: float64
    change_percent_60days: float64
    change_percent_ytd: float64