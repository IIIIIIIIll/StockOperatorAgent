"""亿信 Fin 开放平台数据源（08-08-billions-api-integration）。

class per source、method per endpoint、薄包装形状（对齐 data_source
spec）：``BillionsClient`` 见 ``client.py``，4 端点全部 POST +
``X-API-KEY`` 头，失败归一化为 ``BillionsApiError`` 由调用方降级。
"""
