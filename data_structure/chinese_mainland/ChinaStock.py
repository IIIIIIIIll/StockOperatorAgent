import persistent

class ChinaStock(persistent.Persistent):


   def __init__(self, name):
       self.name = name
       self.datas = []

   def add_data(self, data):
       self.datas.append(data)
       self._p_changed = True

   def get_data(self):
       return self.datas
