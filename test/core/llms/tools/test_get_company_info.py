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