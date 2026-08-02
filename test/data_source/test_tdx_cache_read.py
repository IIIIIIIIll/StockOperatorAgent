"""TdxSource.fetch_security_list 当日快照读缓存 — 离线（无网络）测试。

缓存命中路径完全本地：在临时 parquet 根下构造当日 date 分区的假快照，断言
直接读回（返回数据 = 假快照行 + market 标签列，若走了网络路径绝不可能是
假数据），且返回契约与 vendor 写后读回一致（文件列 + market 标签列，
列序/类型不变）。缓存 miss 路径走真实网络（vendor 既有行为），由
test_tdx_source.py 等 live 冒烟覆盖，此处不测。
"""

import shutil
import tempfile
from datetime import date
from pathlib import Path

import pandas as pd

from data_source.chinese_mainland.tdx.tdx_source import TdxSource


class TestSecurityListReadCache:

    def test_cache_hit_returns_todays_snapshot_without_network(self):
        root = Path(tempfile.mkdtemp(prefix="tdx_cache_test_"))
        try:
            # 按 vendor write_raw_by_market_date 的落盘布局构造当日分区
            today = date.today().strftime("%Y%m%d")
            leaf = root / "security_list" / "market=SZ" / f"date={today}"
            leaf.mkdir(parents=True)
            fake = pd.DataFrame(
                {
                    "code": ["999998", "999999"],
                    "name": ["假股票A", "假股票B"],
                    "pre_close": [10.0, 20.0],
                    "decimal_point": [2, 2],
                    "volunit": [100, 100],
                    "ts_code": ["999998.SZ", "999999.SZ"],
                }
            )
            fake.to_parquet(leaf / "data.parquet", index=False)

            df = TdxSource(root).fetch_security_list(0)

            # 命中路径：返回假快照 + market 标签列（vendor 读回契约）
            assert list(df["code"]) == ["999998", "999999"]
            assert list(df["name"]) == ["假股票A", "假股票B"]
            assert list(df["market"]) == ["SZ", "SZ"]
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_cache_hit_keeps_file_columns_and_order(self):
        root = Path(tempfile.mkdtemp(prefix="tdx_cache_test_"))
        try:
            today = date.today().strftime("%Y%m%d")
            leaf = root / "security_list" / "market=SH" / f"date={today}"
            leaf.mkdir(parents=True)
            fake = pd.DataFrame(
                {
                    "code": ["600188"],
                    "name": ["兖矿能源"],
                    "pre_close": [18.5],
                    "decimal_point": [2],
                    "volunit": [100],
                    "ts_code": ["600188.SH"],
                }
            )
            fake.to_parquet(leaf / "data.parquet", index=False)

            df = TdxSource(root).fetch_security_list(1)

            # 列序 = 落盘文件列序 + market（末尾追加），与 download_security_list 一致
            assert list(df.columns) == [
                "code",
                "name",
                "pre_close",
                "decimal_point",
                "volunit",
                "ts_code",
                "market",
            ]
            assert df.iloc[0]["market"] == "SH"
            assert df.iloc[0]["pre_close"] == 18.5
        finally:
            shutil.rmtree(root, ignore_errors=True)
