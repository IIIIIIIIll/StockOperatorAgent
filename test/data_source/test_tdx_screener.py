"""选股器冒烟测试：vendor 的 screen() 作为离线能力可运行。

跑 2 个代码 + 1 个条件（金叉），校验 RESULT_COLUMNS 输出结构。
需要 TDX 服务器可达（下载日K）；数据缓存写仓库 data/tdx_cache（gitignored，
锚定 DEFAULT_PARQUET_ROOT，见 tdx_source.py）。
不接入请求时链路——全市场扫描不适合运行时（见 design.md）。
"""

from data_source.chinese_mainland.tdx.tdx_source import DEFAULT_PARQUET_ROOT, ensure_vendor_on_path

ensure_vendor_on_path()
from scripts.data_pipeline.screener.conditions import golden_cross  # noqa: E402
from scripts.data_pipeline.screener.run_screener import RESULT_COLUMNS, screen  # noqa: E402


class TestTdxScreener:

    def test_screen_two_codes_one_condition(self):
        result = screen(
            ["000001", "600000"],
            [golden_cross],
            data_root=str(DEFAULT_PARQUET_ROOT),
            max_bars=120,
        )
        assert not result.empty
        assert list(result.columns) == RESULT_COLUMNS
        # 每 (ts_code, timeframe) 一行
        assert result["ts_code"].nunique() >= 1
        assert result["timeframe"].nunique() >= 1
        # matched 是命中的条件名列表；hit_count 与其长度一致
        assert result["matched"].apply(lambda m: isinstance(m, list)).all()
        assert (result["hit_count"] == result["matched"].apply(len)).all()
