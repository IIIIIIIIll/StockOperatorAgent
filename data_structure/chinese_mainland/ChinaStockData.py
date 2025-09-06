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

    def __init__(self):
        self.date = None
        self.ticker = None
        self.open = 0.0
        self.close = 0.0
        self.high = 0.0
        self.low = 0.0
        self.volume = 0
        self.turn_over = 0
        self.amplitude = 0.0
        self.percentage_gain = 0.0
        self.price_change = 0.0
        self.turn_over_rate = 0