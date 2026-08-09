# 设计：配置解析合一（env 假值元组 5 处收敛 + 极性归一）

## 架构与边界

```
utils/runtime_config.py（唯一判定实现，5 处消费点已依赖本模块）
    env_disabled(name: str) -> bool   —— 负极性原语：env 存在且值非
        ""/"0"/"false"/"no" → True（复用 _FALSEY_STRINGS 单点）
    env_int(name: str, default: int) -> int —— env 整数，非法值回退默认

消费点改造（公共 API 不变，内部判定收敛）：
    billsions_config.py:33  _disabled(env_name) → env_disabled（或删除
                            改直调，grep 确认无外部引用）
    web_search.py:47-49     env_enabled 判定 → not env_disabled("WEB_SEARCH_DISABLED")
    get_market_intel.py:44-46 _mcp_disabled env 半 → not env_disabled("TDX_MCP_DISABLED")
    display.py:105-112      _env_enabled(name) → not env_disabled(name)
    billsions_config.py:69-73 亿元上限 env 解析 → env_int(...)
```

## 极性边界（显式化）

- env 层保持**负极性**键名（`X_DISABLED`，truthy = 禁用）——.env 兼容
  与既有测试不变；`env_disabled()` 是唯一的负极性判定实现
- 运行时覆盖层保持**正极性** bool 键（`X_ENABLED`/`BILLIONS_*`）——
  键表与语义不变（08-08 契约）
- 消费点一律算**正布尔**给调用方（web_search_enabled / _mcp_disabled
  取反 / display 面板初始值）——翻转只发生在判定内部，新键不会搞反
- `_FALSEY_STRINGS` 留在 runtime_config（set_runtime_overrides 归一化
  也用）——全库唯一假值元组

## 兼容与风险

- env 键名、truthy 语义、覆盖层键表、上限语义**全部不变**——现有 5 组
  配置测试全绿 = 语义等价证明（test_billions_config /
  test_runtime_config / test_web_search / test_get_market_intel /
  test_display 面板初始值）
- display._env_enabled 改为一行包装后，面板渲染逻辑不动（e2e
  test_settings_panel 覆盖初始值链路）
- int 解析：env_int 收敛 env 读路径（billions_max_calls）；覆盖层
  set_runtime_overrides 的 dict 值归一化是不同输入形态，保留各自实现
  （不硬并）

## 不做

- 不重命名任何 env 键；不改覆盖层键表；不反转 truthy 语义
- 不新增模块（runtime_config 已是 4 消费点的公共依赖）
