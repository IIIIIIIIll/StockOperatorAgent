import pytest
from utils import time_helper
from datetime import datetime

class TestTimeHelper():

    def test_get_last_business_day(self):
        time_helper.get_last_business_day(datetime.today())