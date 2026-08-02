from openpyxl.styles.builtins import output

from core.data_acquisition import DataAcquisition
from data_structure.chinese_mainland.ChinaStock import ChinaStock
from data_structure.chinese_mainland.ChinaStockData import ChinaStockData
from utils.formatting import fmt_number

class StockOutputFormatter:

    def format_stock_output(stock: ChinaStock) -> str:
        # 数值统一经 fmt_number 渲染：NaN/None → "N/A"（TDX 路径恒有 NaN 字段：
        # 量比/涨速/5分钟涨跌、盘中换手率与成交量、历史首行振幅/涨跌幅、F10
        # 缺失指标），数值保留两位小数——prompt 不再出现 nan%/nanlots 字面。
        overview = stock.overview
        output = "\n-----------\n"
        output += f"Stock: {stock.name} ({stock.ticker})\n"
        output += f"Latest price: {fmt_number(overview.latest_price, 2)}\n"
        output += f"Dynamic PE: {fmt_number(overview.pe_dynamic, 2)}\n"
        output += f"Pb: {fmt_number(overview.pb, 2)}\n"
        output += f"Momentum: {fmt_number(overview.momentum, 2)}%\n"
        output += f"Last 60 days prices:\n"
        historical_data = stock.get_datas()
        for data in historical_data[-60:]:
            output += (f"  Date: {data.date}, Open:{fmt_number(data.open, 2)}, "
                       f"Close: {fmt_number(data.close, 2)}, High: {fmt_number(data.high, 2)}, "
                       f"Low: {fmt_number(data.low, 2)}, Change Percent: {fmt_number(data.percentage_gain, 2)}%, "
                       f"Volume: {fmt_number(data.volume, 2)}lots, "
                       f"Turnover Rate: {fmt_number(data.turnover_rate, 2)}%\n")
        output += f"Last 20 financial abstracts:\n"
        performance_reports = stock.get_performance_reports()
        for report in performance_reports[-20:]:
            output += (f"  Report Date: {report.report_date}, "
                       f"EPS: {fmt_number(report.eps, 2)}, "
                       f"Net Profit: {fmt_number(report.net_profit, 2)}, "
                       f"Net Profit YoY percent {fmt_number(report.net_profit_YoY_rate, 2)}, "
                       f"Net Profit QoQ percent {fmt_number(report.net_profit_QoQ_rate, 2)}, "
                       f"Net worth per share {fmt_number(report.net_worth_per_share, 2)}, "
                       f"Return on Equity percent {fmt_number(report.net_worth_return_rate, 2)}, "
                       f"Cash flow per share {fmt_number(report.cash_flow_per_share, 2)}, "
                       f"Sales gross margin percent {fmt_number(report.sales_gross_margin, 2)}\n")
        output += "-----------\n"
        return output
