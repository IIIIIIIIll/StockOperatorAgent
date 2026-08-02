from core.data_acquisition import DataAcquisition
from core.stock_output_formatter import StockOutputFormatter
from data_source.chinese_mainland.tdx.tdx_source import is_bj_ticker

def get_stock_info(ticker: str) -> str:
    """
    Get the stock information for a given ticker symbol.
    :param ticker:
    :return: Formatted stock information string.
    """
    # BJ 显式提示（review #11，2026-08-02）：UI 路径已拦截，API 路径
    # （make_investment_decision）这里给明确中文错误——TDX 全链路不覆盖
    # BJ（无名称/无行情），ensure_stock 的通用 'Stock not found' 误导。
    # 检查在构造 DataAcquisition（打开 ZODB）之前——离线可直接断言异常。
    if is_bj_ticker(ticker):
        raise Exception('北交所（BJ）股票暂不支持分析：TDX 数据源不覆盖 BJ 证券（无名称/无行情），请使用沪深 A 股代码')
    data_acquisition = DataAcquisition()
    stock = data_acquisition.get_stock_data(ticker)
    if stock is None:
        raise Exception('Stock not found')
    return StockOutputFormatter.format_stock_output(stock)