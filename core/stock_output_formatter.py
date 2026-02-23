from openpyxl.styles.builtins import output

from core.data_acquisition import DataAcquisition
from data_structure.chinese_mainland.ChinaStock import ChinaStock
from data_structure.chinese_mainland.ChinaStockData import ChinaStockData

class StockOutputFormatter:

    def format_stock_output(stock: ChinaStock) -> str:
        overview = stock.overview
        output = "\n-----------\n"
        output += f"Stock: {stock.name} ({stock.ticker})\n"
        output += f"Latest price: {overview.latest_price}\n"
        output += f"Dynamic PE: {overview.pe_dynamic}\n"
        output += f"Pb: {overview.pb}\n"
        output += f"Momentum: {overview.momentum}%\n"
        output += "\n-----------\n"
        output += f"Last 60 days prices:\n"
        historical_day_data = stock.get_day_datas()
        for data in historical_day_data[-60:]:
            output += f"  Date: {data.date}, Open:{data.open}, Close: {data.close}, High: {data.high}, Low: {data.low}, Change Percent: {data.percentage_gain}%, Volume: {data.volume}lots, Turnover Rate: {data.turnover_rate}%\n"
        output += "\n-----------\n"
        output += f"Last 60 weeks prices:\n"
        historical_week_data = stock.get_week_datas()
        for data in historical_week_data[-60:]:
            output += f"  Week: {data.date}, Open:{data.open}, Close: {data.close}, High: {data.high}, Low: {data.low}, Change Percent: {data.percentage_gain}%, Volume: {data.volume}lots, Turnover Rate: {data.turnover_rate}%\n"
        output += "\n-----------\n"
        output += f"Last 60 months prices:\n"
        historical_month_data = stock.get_month_datas()
        for data in historical_month_data[-60:]:
            output += f"  Month: {data.date}, Open:{data.open}, Close: {data.close}, High: {data.high}, Low: {data.low}, Change Percent: {data.percentage_gain}%, Volume: {data.volume}lots, Turnover Rate: {data.turnover_rate}%\n"
        output = "\n-----------\n"
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
        output += "-----------\n"
        return output