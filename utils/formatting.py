"""数值格式化公共 helper：NaN/None → "N/A"，数值保留指定小数位。

由 core/stock_output_formatter.py（prompt 文本）与
core/llms/tools/get_trend_indicators.py（指标摘要）共用——两处都需要把
pytdx 无数据字段的 NaN 渲染为 "N/A"（否则 prompt 出现 nan%/nanlots），
单点落位避免两份实现漂移（见 code-reuse-thinking-guide）。
"""

import pandas as pd


def fmt_number(value, digits: int) -> str:
    """数值 → 固定小数位字符串；None / NaN → "N/A"。

    :param value: int/float/numpy 标量；NaN 与 None 渲染为 "N/A"
    :param digits: 小数位（f-string 精度）
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "N/A"
    return f"{value:.{digits}f}"
