"""亿信 Fin 开放平台开关解析（08-08-billions-api-integration，Step 1）。

可选性硬约束（R2，用户 2026-08-08 明确要求——API 配额与成本限制）：
- 主闸 `BILLIONS_API_KEY`：未配置 → 全部亿信能力关闭，现有 agent 流程
  零行为变化
- 总闸 `BILLIONS_DISABLED` + 能力级开关 `BILLIONS_{CAP}_DISABLED` 可
  单独关闭（能力名 FINDB/SEARCH/TWITTER/FETCH/ANALYST）

真值语义逐字对齐 web_search.web_search_enabled()（= get_market_intel.
_mcp_disabled() 判定）：存在且值非 ""/"0"/"false"/"no" → 视为禁用
（"1"/"true"/"yes"/随意值均禁用，显式假值留恢复路径）。

调用硬上限：`billions_max_calls` 读 `BILLIONS_{CAP}_MAX_CALLS`（env
覆盖默认值——search 3 / twitter 2 / fetch 3，见各工具工厂）。
"""

from __future__ import annotations

import os


def _disabled(env_name: str) -> bool:
    """env 置为禁用？存在且值非 ""/"0"/"false"/"no" → 禁用（truthy 语义）。"""
    value = os.environ.get(env_name, "")
    return value not in ("", "0", "false", "no")


def billions_enabled(capability: str) -> bool:
    """能力开关：主闸 key 存在 且 总闸开 且 能力闸开。

    :param capability: 能力名（FINDB/SEARCH/TWITTER/FETCH/ANALYST，
        大小写不敏感——内部 upper，env 名恒为大写）
    :return: False = 该能力静默关闭（图不绑节点/工具、前置段为空串），
        True = 启用
    """
    cap = capability.upper()
    if not os.environ.get("BILLIONS_API_KEY"):
        return False
    if _disabled("BILLIONS_DISABLED"):
        return False
    if _disabled(f"BILLIONS_{cap}_DISABLED"):
        return False
    return True


def billions_max_calls(capability: str, default: int) -> int:
    """单次 run 内工具调用硬上限：env `BILLIONS_{CAP}_MAX_CALLS` 覆盖默认。

    :param capability: 能力名（大小写不敏感）
    :param default: 调用方给的默认上限（search 3 / twitter 2 / fetch 3）
    :return: env 值非法（非整数）→ 回退默认（配置错误不阻断，按默认走）
    """
    cap = capability.upper()
    raw = os.environ.get(f"BILLIONS_{cap}_MAX_CALLS")
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default
