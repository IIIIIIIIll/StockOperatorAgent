"""通用运行时覆盖层（08-08-billions-switches-ui，Step 1）。

会话级配置覆盖：streamlit 设置面板的会话区（能力开关/亿信上限）经
`set_runtime_overrides` 写入内存覆盖层，消费点读取时**覆盖优先、env
兜底**。与持久化的 .env 不同，覆盖层只存活于当前进程——重载/重启后
清空，配置恢复 .env 值（会话级语义，成本兜底）。

优先级：覆盖层（键存在且值类型正确）→ env（调用方传入的 env 判定
结果）。覆盖层默认空 → 全部消费点走 env → 与既有行为逐字节一致
（AC1）。

覆盖层键表（`set_runtime_overrides` 接受的键；键大小写不敏感，存储
恒为大写）：

| 键 | 类型 | 语义 |
|---|---|---|
| `TDX_MCP_ENABLED` | bool | True=开 MCP，False=关（覆盖 env TDX_MCP_DISABLED） |
| `WEB_SEARCH_ENABLED` | bool | 同上（覆盖 env WEB_SEARCH_DISABLED） |
| `BILLIONS_MASTER` | bool | False=亿信全关；True=不强制（未覆盖项走 env） |
| `BILLIONS_{FINDB,SEARCH,TWITTER,FETCH,ANALYST}` | bool | 覆盖 env 能力闸 |
| `BILLIONS_{SEARCH,TWITTER,FETCH}_MAX_CALLS` | int | 覆盖 env 上限 |

值归一化（set 时）：`_MAX_CALLS` 后缀键 → `int(value)`（非法值丢弃、
不存储 → `runtime_int` 自然回退 env）；其余键 → `bool`——字符串按
env truthy 语义（`""`/`"0"`/`"false"`/`"no"` → False，其余 True，
大小写不敏感），非字符串 `bool(value)`。
"""

from __future__ import annotations

import os

from typing import Union

_RUNTIME: dict[str, Union[bool, int]] = {}

# env truthy 语义：这些值视为假，其余字符串视为真（全库唯一假值元组——
# env_disabled 与 set_runtime_overrides 归一化共用）
_FALSEY_STRINGS = ("", "0", "false", "no")


def env_disabled(name: str) -> bool:
    """env 负极性判定原语（08-09-unify-config-parsing：全库唯一假值判定）。

    env 层语义保持负极性（`X_DISABLED` 键，truthy = 禁用）：值缺失或
    显式假值（""/"0"/"false"/"no"，大小写敏感）→ False；其余任意值 →
    True。消费点一律取反算**正布尔**（`not env_disabled(...)` = 启用）——
    极性翻转只发生在判定内部，新键不会搞反。
    """
    return os.environ.get(name, "") not in _FALSEY_STRINGS


def env_int(name: str, default: int) -> int:
    """env 整数原语：值缺失或非法（非整数）→ 回退默认（配置错误不阻断）。

    收敛 env 读路径（billions_max_calls / display 面板初始值）；覆盖层
    set_runtime_overrides 的 dict 值归一化是不同输入形态，保留各自实现
    （不硬并）。
    """
    raw = os.environ.get(name)
    try:
        return int(raw) if raw is not None else default
    except ValueError:
        return default


def set_runtime_overrides(overrides: dict) -> None:
    """清空并全量替换覆盖层（每次表单提交收集一次，整组生效）。

    :param overrides: 键 = 覆盖层键表（大小写不敏感）；值 = bool/int
        或可归一化字符串。非法 int（`_MAX_CALLS` 键）丢弃不存储。
    """
    normalized: dict[str, Union[bool, int]] = {}
    for raw_key, value in overrides.items():
        key = str(raw_key).strip().upper()
        if not key:
            continue
        if key.endswith("_MAX_CALLS"):
            try:
                normalized[key] = int(value)
            except (TypeError, ValueError):
                continue  # 非法上限 → 不覆盖（runtime_int 回退 env）
        elif isinstance(value, str):
            normalized[key] = value.lower() not in _FALSEY_STRINGS
        else:
            normalized[key] = bool(value)
    _RUNTIME.clear()
    _RUNTIME.update(normalized)


def clear_runtime_overrides() -> None:
    """清空覆盖层——之后全部消费点回到 env 行为。"""
    _RUNTIME.clear()


def runtime_bool(key: str, env_fallback: bool) -> bool:
    """读取 bool 覆盖：键存在 → 覆盖值；否则 env_fallback（env 判定结果）。

    :param key: 覆盖层键（大小写不敏感）
    :param env_fallback: 调用方已算好的 env 判定结果（覆盖层未命中时返回）
    """
    value = _RUNTIME.get(key.strip().upper())
    if value is None:
        return env_fallback
    return bool(value)


def runtime_int(key: str, env_fallback: int) -> int:
    """读取 int 覆盖：键存在且为 int → 覆盖值；否则 env_fallback。

    set 时已归一化（非法值不存储），此处仅防御性类型检查（bool 是
    int 子类，需排除）。
    """
    value = _RUNTIME.get(key.strip().upper())
    if value is None or isinstance(value, bool) or not isinstance(value, int):
        return env_fallback
    return value
