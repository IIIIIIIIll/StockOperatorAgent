import persistent

class ChinaStockData(persistent.Persistent):


    def __init__(self):
        self.date = None
        self.ticker = 000000
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