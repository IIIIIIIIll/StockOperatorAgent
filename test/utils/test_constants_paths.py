"""路径锚定测试：china_db_path / LOG_DIR / DEFAULT_PARQUET_ROOT 不依赖 CWD。

prd（08-02-fix-env-robustness）验收：任意 CWD 下 ZODB 库、parquet 缓存、日志
三处路径都解析到仓库锚定处——无第二库/第二缓存树/日志落别处。前两个用例
进程内断言（锚定值本身），第三个用例 subprocess 换 CWD=/tmp 实测解析结果。
"""

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


class TestConstantsPaths:

    def test_china_db_path_anchored_to_repo_root(self):
        from utils.constants import china_db_path

        assert china_db_path == str(REPO_ROOT / "database" / "china_stock_data.fs")
        # 值语义不变：锚定前后指向同一个真实库文件（套件依赖真实库运行）
        assert os.path.exists(china_db_path)

    def test_log_dir_anchored_to_repo_root(self):
        from utils.constants import LOG_DIR, REPO_ROOT

        assert LOG_DIR == REPO_ROOT / "logs"


class TestParquetRootAnchoring:

    def test_default_parquet_root_anchored_to_repo_root(self):
        from data_source.chinese_mainland.tdx.tdx_source import DEFAULT_PARQUET_ROOT

        assert DEFAULT_PARQUET_ROOT == REPO_ROOT / "data" / "tdx_cache"


class TestAnchoredPathsIndependentOfCwd:

    def test_subprocess_from_tmp_resolves_all_anchored_paths(self):
        # 任意 CWD 启动（prd 冒烟）：三处路径全部锚定仓库根，不随 CWD 漂移
        code = (
            "import sys; sys.path.insert(0, {repo!r})\n"
            "from utils.constants import china_db_path, LOG_DIR\n"
            "from data_source.chinese_mainland.tdx.tdx_source import DEFAULT_PARQUET_ROOT\n"
            "print(china_db_path)\n"
            "print(LOG_DIR)\n"
            "print(DEFAULT_PARQUET_ROOT)\n"
        ).format(repo=str(REPO_ROOT))
        out = subprocess.run(
            [sys.executable, "-c", code],
            cwd="/tmp",
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert out.returncode == 0, out.stderr
        lines = out.stdout.strip().splitlines()
        assert lines[0] == str(REPO_ROOT / "database" / "china_stock_data.fs")
        assert lines[1] == str(REPO_ROOT / "logs")
        assert lines[2] == str(REPO_ROOT / "data" / "tdx_cache")
