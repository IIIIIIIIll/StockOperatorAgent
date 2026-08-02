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
        # __del__ 不得向外抛异常。先 transaction.abort() 终止未提交事务
        # （访问 root 即 join 事务），否则 connection.close() 抛
        # ConnectionStateError → db.close() 不执行 → FileStorage flock 锁
        # 泄漏，同进程下一个实例打开即 zc.lockfile.LockError / BlockingIOError。
        # ZODB 6.0.1 实测：connection.abort(transaction) 是 storage-manager
        # 接口需传事务参数，无参调用 TypeError；transaction.abort() 正确且
        # abort → close → db.close 后锁必然释放。
        try:
            try:
                transaction.abort()
            except Exception:
                pass  # abort 尽力而为；close/db.close 才是锁释放的关键
            self.connection.close()
            self.db.close()
            logger.info("ZODBStorage instance closed")
        except Exception:
            logger.exception("ZODBStorage destructor failed")

    def check_need_update_overview(self):
        if self.root.overview_last_updated > datetime.datetime.combine(get_last_business_day(datetime.date.today()), datetime.time(17, 00)):
            logger.info("No update required as latest overview is already updated at {}", self.root.overview_last_updated)
            return False
        logger.debug("Overview last updated at {}, updating...", self.root.overview_last_updated)
        return True

    def set_overview_updated_now(self):
        self.root.overview_last_updated = datetime.datetime.now()
        logger.debug("Overview last updated at {}", self.root.overview_last_updated)
        transaction.commit()

    def put_stock(self, ticker, stock):
        self.root.stocks[ticker] = stock
        transaction.commit()
        logger.debug("Put stock {} into database", ticker)


    def get_stock(self, ticker):
        logger.debug("Getting stock {} from database", ticker)
        return self.root.stocks.get(ticker, None)


_instance = None


def get_zodb_storage():
    """进程级单例：整个进程共享一个 ZODB 连接。

    FileStorage 的 flock 锁在同一进程内不可重入——本环境（ZODB 6.2 +
    Python 3.13）下实例的 __del__ 偶发无法关闭连接（ConnectionStateError），
    锁泄漏会导致同进程第二个实例打开失败（zc.lockfile.LockError）。所有
    DataAcquisition 共用本单例即消除该类问题（core spec 所述"module-level
    singleton"的落地实现）。
    """
    global _instance
    if _instance is None:
        _instance = ZODBStorageInstance()
    return _instance