from core.data_acquisition import DataAcquisition
from core.stock_output_formatter import StockOutputFormatter

def get_stock_info(ticker: str) -> str:
    """
    Get the stock information for a given ticker symbol.
    :param ticker:
    :return: Formatted stock information string.
    """
    data_acquisition = DataAcquisition()
    stock = data_acquisition.get_stock_data(ticker)
    if stock is None:
        raise Exception('Stock not found')
    return StockOutputFormatter.format_stock_output(stock)