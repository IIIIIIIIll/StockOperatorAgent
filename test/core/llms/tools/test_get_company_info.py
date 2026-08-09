import pytest

from core.llms.tools.get_company_info import get_stock_info
from loguru import logger

class TestGetCompanyInfo():

    def test_get_company_info(self):
        ret = get_stock_info('002714')
        assert ret is not None
        logger.debug(ret)

    def test_bj_code_raises_clear_message(self):
        """BJ 代码（4/8 前缀）→ 明确中文错误（review #11），非通用 'Stock not found'。

        检查在构造 DataAcquisition（打开 ZODB）之前——离线可直接断言，
        不依赖 ZODB/网络。
        """
        with pytest.raises(Exception) as excinfo:
            get_stock_info('430047')
        assert '北交所' in str(excinfo.value)
        assert 'Stock not found' not in str(excinfo.value)

    def test_stock_not_found_raises_generic(self):
        """get_stock_data → None（ensure_stock 失败/无价格来源）→ 通用
        'Stock not found' raise（error-handling spec：唯一 raise 点）。

        get_stock_info 无注入点——类方法属性交换注入（house style 无 mock
        框架）：get_stock_data 直接返回 None，零网络/零抓取。
        """
        from core.llms.tools import get_company_info
        orig = get_company_info.DataAcquisition.get_stock_data
        get_company_info.DataAcquisition.get_stock_data = (
            lambda self, ticker, _scope=None: None
        )
        try:
            with pytest.raises(Exception) as excinfo:
                get_stock_info('600000')
            assert 'Stock not found' in str(excinfo.value)
        finally:
            get_company_info.DataAcquisition.get_stock_data = orig