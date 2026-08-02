from datetime import datetime
from pathlib import Path

default_start = datetime.strptime('1997-01-01', '%Y-%m-%d')

# 仓库根（本文件所在目录的上一级）——所有曾依赖 CWD 的路径统一锚定于此，
# 任意目录启动应用数据/缓存/日志都落在同一处（2026-08-02 修复：CWD 漂移
# 曾导致双 ZODB 库 / 双 parquet 缓存树 / 日志落错处）。
REPO_ROOT = Path(__file__).resolve().parents[1]

# ZODB 数据文件：锚定仓库根。原相对路径 'database/china_stock_data.fs' 在非
# 仓库根 CWD 下会静默创建第二个空库（新旧数据分家）；锚定后任何 CWD 都打开
# 同一文件（值语义不变：仍是仓库 database/ 下那个文件，仅解析不再依赖 CWD）。
china_db_path = str(REPO_ROOT / 'database' / 'china_stock_data.fs')

# 日志目录：main.py 的 loguru handler 落位（gitignored，见 .gitignore `logs`）。
# 原 './logs/...' 相对路径随 CWD 漂移；锚定后任意 CWD 启动日志都写入仓库 logs/。
LOG_DIR = REPO_ROOT / 'logs'
