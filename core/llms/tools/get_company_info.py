from core.data_acquisition import DataAcquisition
from core.stock_output_formatter import StockOutputFormatter

def get_stock_info(ticker: str) -> str:
    data_acquisition = DataAcquisition()
    if not data_acquisition.acquire_historical_data(ticker):
        raise Exception('Data acquisition failed')
    stock = data_acquisition.storage.get_stock(ticker)
    if stock is None:
        raise Exception('Stock not found')
    return StockOutputFormatter.format_stock_output(stock)