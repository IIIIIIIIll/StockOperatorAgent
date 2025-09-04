import ZODB, ZODB.FileStorage, BTrees.OOBTree
from data_structure.chinese_mainland import ChinaStock


class ZODBStorageInstance():


    def __init__(self):
        self.storage = ZODB.FileStorage.FileStorage('data/china_stock_data.fs')
        self.db = ZODB.DB(self.storage)
        self.connection = self.db.open()
        self.root = self.connection.root
        self.root.stocks = BTrees.OOBTree.BTree()

    def put_stock(self, ticker, stock):
        self.root.stocks[ticker] = stock

    def get_stock(self, ticker):
        return self.root.stocks[ticker]