from dataclasses import dataclass

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
