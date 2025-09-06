import datetime
import persistent
import transaction

from utils.constants import default_start

class ChinaStock(persistent.Persistent):


        def __init__(self, name, ticker, overview):
            self.name = name
            self.ticker = ticker
            self.datas = []
            self.overview = overview
            self.info = None
            self.overview_last_update = datetime.datetime.now()
            self.last_data_update = default_start

        def update_overview(self, new_overview):
            self.info = new_overview
            self.overview_last_update = datetime.datetime.now()
            transaction.commit()

        def add_info(self, info):
            self.info = info
            transaction.commit()

        def get_info(self):
            return self.info

        def add_data(self, data):
           self.datas.append(data)
           self.last_data_update = datetime.datetime.today()
           transaction.commit()

        def get_datas(self):
           return self.datas
