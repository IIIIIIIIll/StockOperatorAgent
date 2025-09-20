from core.data_acquisition import DataAcquisition
from data_structure.chinese_mainland.ChinaStock import ChinaStock
from data_structure.chinese_mainland.ChinaStockData import ChinaStockData

class StockOutputFormatter:

    def format_stock_output(stock: ChinaStock) -> str:
        overview = stock.overview
        output = f"Stock: {stock.name} ({stock.ticker})\n"
        output += f"Latest price: {overview.latest_price}\n"
        output += f"Dynamic PE: {overview.pe_dynamic}\n"
        output += f"Pb: {overview.pb}\n"
        output += f"Momentum: {overview.momentum}%\n"
        output += f"Last 60 days prices:\n"
        historical_data = stock.get_datas()
        for data in historical_data[-60:]:
            output += f"  Date: {data.date}, Open:{data.open}, Close: {data.close}, High: {data.high}, Low: {data.low}, Change Percent: {data.percentage_gain}%, Volume: {data.volume}lots, Turnover Rate: {data.turnover_rate}%\n"
        output += f"Last 20 financial abstracts:\n"
        performance_reports = stock.get_performance_reports()
        for report in performance_reports[-20:]:
            output += (f"  Report Date: {report.report_date}, "
                       f"EPS: {report.eps}, "
                       f"Net Profit: {report.net_profit}, "
                       f"Net Profit YoY percent {report.net_profit_YoY_rate}, "
                       f"Net Profit QoQ percent {report.net_profit_QoQ_rate}, "
                       f"Net worth per share {report.net_worth_per_share}, "
                       f"Return on Equity percent {report.net_worth_return_rate}, "
                       f"Cash flow per share {report.cash_flow_per_share}, "
                       f"Sales gross margin percent {report.sales_gross_margin}\n")
        return output