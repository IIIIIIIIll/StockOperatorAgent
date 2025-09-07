import persistent
from dataclasses import dataclass
from numpy import float64, int64


@dataclass
class ChinaStockData(persistent.Persistent):
    date : object
    ticker : object
    open : float64
    close : float64
    high : float64
    low : float64
    volume : int64
    turnover : float64
    amplitude : float64
    percentage_gain : float64
    price_change : float64
    turnover_rate : float64