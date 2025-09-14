from core.llms.tools.get_company_info import get_stock_info
from loguru import logger

class TestGetCompanyInfo():

    def test_get_company_info(self):
        ret = get_stock_info('002714')
        assert ret is not None
        logger.debug(ret)