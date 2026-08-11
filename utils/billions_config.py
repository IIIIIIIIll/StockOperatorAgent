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

运行时覆盖层（08-08-billions-switches-ui，utils/runtime_config.py）：
会话级覆盖优先于 env——`BILLIONS_MASTER`（False=全关）、
`BILLIONS_{CAP}`（能力闸）、`BILLIONS_{CAP}_MAX_CALLS`（上限）；
覆盖层默认空 → 全部走 env → 与既有行为逐字节一致（AC1）。无
BILLIONS_API_KEY 的硬约束始终优先（主闸，覆盖无效）。

`billions_cap_switch`（08-10-web-search-fallback）：无 key 约束的
能力开关——开关部分（总闸/能力闸/覆盖层优先级）与 `billions_enabled`
逐字一致，仅剔除主闸 key 硬约束（信息面分析师联网回退谓词用：无 key
仍可按开关判定 ANALYST 能力，亿信路径的 key 约束由 `billions_enabled`
承担）。
"""

from __future__ import annotations

import os

from utils.runtime_config import env_disabled, env_int, runtime_bool, runtime_int


def billions_enabled(capability: str) -> bool:
    """能力开关：主闸 key 存在 且 总闸开 且 能力闸开。

    :param capability: 能力名（FINDB/SEARCH/TWITTER/FETCH/ANALYST，
        大小写不敏感——内部 upper，env 名恒为大写）
    :return: False = 该能力静默关闭（图不绑节点/工具、前置段为空串），
        True = 启用

    优先级（覆盖层 → env 兜底）：① 无 key 硬约束（始终首位）；②
    `BILLIONS_MASTER` 覆盖 False → 全关（True=不强制，未覆盖项走
    env）；③ `BILLIONS_{CAP}` 覆盖存在 → 覆盖值；④ env 总闸/能力闸。
    """
    cap = capability.upper()
    if not os.environ.get("BILLIONS_API_KEY"):
        return False
    if not runtime_bool("BILLIONS_MASTER", True):
        return False
    env_enabled = not (
        env_disabled("BILLIONS_DISABLED") or env_disabled(f"BILLIONS_{cap}_DISABLED")
    )
    return runtime_bool(f"BILLIONS_{cap}", env_enabled)


def billions_cap_switch(capability: str) -> bool:
    """能力开关（无主闸 key 约束）——开关部分语义与 `billions_enabled`
    逐字一致，仅剔除 `BILLIONS_API_KEY` 硬约束。

    :param capability: 能力名（FINDB/SEARCH/TWITTER/FETCH/ANALYST，
        大小写不敏感——内部 upper，env 名恒为大写）
    :return: False = 该能力静默关闭，True = 启用

    用途（08-10-web-search-fallback）：信息面分析师启用谓词的 ANALYST
    段——无 BILLIONS_API_KEY 时仍需按开关判定能力（联网搜索回退路径
    无 key 约束），亿信路径的 key 硬约束仍由 `billions_enabled` 承担。

    优先级（覆盖层 → env 兜底）：① `BILLIONS_MASTER` 覆盖 False →
    全关（True=不强制，未覆盖项走 env）；② `BILLIONS_{CAP}` 覆盖
    存在 → 覆盖值；③ env 总闸/能力闸。
    """
    cap = capability.upper()
    if not runtime_bool("BILLIONS_MASTER", True):
        return False
    env_enabled = not (
        env_disabled("BILLIONS_DISABLED") or env_disabled(f"BILLIONS_{cap}_DISABLED")
    )
    return runtime_bool(f"BILLIONS_{cap}", env_enabled)


def billions_max_calls(capability: str, default: int) -> int:
    """单次 run 内工具调用硬上限：覆盖层/env `BILLIONS_{CAP}_MAX_CALLS`
    覆盖默认。

    :param capability: 能力名（大小写不敏感）
    :param default: 调用方给的默认上限（search 3 / twitter 2 / fetch 3）
    :return: 覆盖层/env 值非法（非整数）→ 回退默认（配置错误不阻断，
        按默认走）
    """
    cap = capability.upper()
    env_value = env_int(f"BILLIONS_{cap}_MAX_CALLS", default)
    return runtime_int(f"BILLIONS_{cap}_MAX_CALLS", env_value)
