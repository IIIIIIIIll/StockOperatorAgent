"""TDX MCP 情报结果缓存（08-02-mcp-intel-cache）。

按 ticker 缓存 get_market_intel 的最近一次查询文本——**非交易时段
（收盘后到次日开盘前）直接读缓存**，省网络往返；交易时段实时查询。

- 路径：`<repo>/data/tdx_cache/mcp_intel/ticker=<T>/data.json`
  （与既有 parquet 缓存同树，gitignored；根由 utils.constants.REPO_ROOT
  锚定——不 import tdx_source，避免无 key 环境加载 vendor）。
- JSON：`{"fetched_at": <北京时间 ISO>, "text": <结果文本>}`。
- 读写失败不 raise（error-handling 约定）：read 缺失/损坏/空 → None
  （调用方回退实时查询）；write 原子写（临时文件 + os.replace），
  失败 → False（不影响主流程）。

cache_root 参数为测试注入点（house style 无 mock 框架——测试传临时
目录验证往返/损坏/原子写）。
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from utils.constants import REPO_ROOT

DEFAULT_CACHE_ROOT = REPO_ROOT / "data" / "tdx_cache"
_SHANGHAI = ZoneInfo("Asia/Shanghai")


def _cache_path(cache_root: Path, ticker: str) -> Path:
    return Path(cache_root) / "mcp_intel" / f"ticker={ticker}" / "data.json"


def read_cache(cache_root: Path = DEFAULT_CACHE_ROOT, ticker: str = "") -> str | None:
    """读缓存文本；缺失/损坏/空/无 text → None（回退实时查询）。"""
    path = _cache_path(cache_root, ticker)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        text = data.get("text")
        if not isinstance(text, str) or not text:
            return None
        return text
    except Exception:
        # JSON 损坏/权限等 → 视为无缓存
        return None


def write_cache(cache_root: Path = DEFAULT_CACHE_ROOT, ticker: str = "", text: str = "") -> bool:
    """写缓存（原子：临时文件 + os.replace）；失败 → False（不 raise）。"""
    path = _cache_path(cache_root, ticker)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "fetched_at": datetime.now(_SHANGHAI).isoformat(),
            "text": text,
        }
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
        return True
    except Exception:
        # 磁盘满/权限等 → 缓存失败不影响主流程
        return False
