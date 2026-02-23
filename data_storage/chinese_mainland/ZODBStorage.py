import datetime
import utils
from loguru import logger
import ZODB, ZODB.FileStorage, BTrees.OOBTree
from data_structure.chinese_mainland import ChinaStock
from utils.constants import default_start
from utils.time_helper import get_last_business_day
import transaction
import os.path

class ZODBStorageInstance():


    def __init__(self):

        is_new_db = not os.path.exists(utils.constants.china_db_path)
        self.storage = ZODB.FileStorage.FileStorage(utils.constants.china_db_path)
        self.db = ZODB.DB(self.storage)
        self.connection = self.db.open()
        self.root = self.connection.root
        self.root.overview_last_updated = getattr(self.root, 'overview_last_updated', default_start)
        if is_new_db:
            self.root.stocks = BTrees.OOBTree.BTree()
        logger.info("ZODB connected, overview last updated at {}", self.root.overview_last_updated)

    def __del__(self):
        self.connection.close()
        self.db.close()
        logger.info("ZODBStorage instance closed")

    def put_stock(self, ticker, stock):
        self.root.stocks[ticker] = stock
        transaction.commit()
        logger.debug("Put stock {} into database", ticker)


    def get_stock(self, ticker):
        logger.debug("Getting stock {} from database", ticker)
        return self.root.stocks.get(ticker, None)