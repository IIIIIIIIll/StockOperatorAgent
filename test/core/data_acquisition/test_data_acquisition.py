import pytest

from core.data_acquisition import DataAcquisition
from core.stock_output_formatter import StockOutputFormatter
from loguru import logger

# deprecated（2026-08-02）：以下 6 个用例测 akshare 备用路径方法（update_*_overview /
# acquire_daily_overview / acquire_historical_data / acquire_performance_report）——
# 主流程已纯 TDX，本环境东财端点不可达挂超时。方法保留（备用），测试常规不跑。
# test_acquire_stock_data 保留：M3 后 get_stock_data 走纯 TDX 链路，需常态回归。
# 恢复方式：删掉对应装饰器，在可达东财的网络环境执行。

class TestDataAcquisition():

    @pytest.mark.skip(reason="deprecated: akshare 备用路径（update_bjex_overview），常规不跑")
    def test_acquire_bjex_overview(self):
        da = DataAcquisition()
        assert da.update_bjex_overview() is True
        assert da.storage.get_stock('871263') is not None

    @pytest.mark.skip(reason="deprecated: akshare 备用路径（update_szex_overview），常规不跑")
    def test_acquire_szex_overview(self):
        da = DataAcquisition()
        assert da.update_szex_overview() is True
        assert da.storage.get_stock('002741') is not None

    @pytest.mark.skip(reason="deprecated: akshare 备用路径（update_shex_overview），常规不跑")
    def test_acquire_shex_overview(self):
        da = DataAcquisition()
        assert da.update_shex_overview() is True
        assert da.storage.get_stock('601188') is not None

    @pytest.mark.skip(reason="deprecated: akshare 备用路径（acquire_daily_overview），常规不跑")
    def test_acquire_day_overview(self):
        da = DataAcquisition()
        assert da.acquire_daily_overview() is True
        assert da.storage.get_stock('002741') is not None
        assert da.storage.get_stock('871263') is not None
        assert da.storage.get_stock('601188') is not None

    @pytest.mark.skip(reason="deprecated: akshare 备用路径（acquire_historical_data），常规不跑")
    def test_acquire_historical_data(self):
        da = DataAcquisition()
        assert da.acquire_historical_data('002714') is True
        stock = da.storage.get_stock('002714')
        assert stock is not None
        assert len(stock.get_datas()) > 0

    @pytest.mark.skip(reason="deprecated: akshare 备用路径（acquire_historical_data 失败路径），常规不跑")
    def test_acquire_historical_data_failed(self):
        da = DataAcquisition()
        assert da.acquire_historical_data('999999') is False

    @pytest.mark.skip(reason="deprecated: akshare 备用路径（acquire_performance_report），常规不跑")
    def test_acquire_stock_performance_report(self):
        da = DataAcquisition()
        assert da.acquire_performance_report() is True
        stock = da.storage.get_stock('002714')
        assert stock is not None
        assert len(stock.get_performance_reports()) > 0

    def test_acquire_stock_data(self):
        da = DataAcquisition()
        stock = da.get_stock_data('002714')
        logger.info(StockOutputFormatter.format_stock_output(stock))
        assert stock is not None

    def test_module_import_lazy_akshare(self):
        """修复 4 验收：import core.data_acquisition 不触发 akshare import。

        subprocess 隔离（采集期 test/data_source/test_akshare.py 已导入 akshare，
        进程内 sys.modules 检查不可靠）。失败时 stderr 会带 assert 消息。
        """
        import subprocess
        import sys
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[3]
        code = (
            "import sys; sys.path.insert(0, {repo!r})\n"
            "import core.data_acquisition\n"
            "assert 'data_source.chinese_mainland.akshare.fetch_stcok_data' not in sys.modules, "
            "'akshare imported at module level'\n"
        ).format(repo=str(repo_root))
        out = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert out.returncode == 0, out.stderr
