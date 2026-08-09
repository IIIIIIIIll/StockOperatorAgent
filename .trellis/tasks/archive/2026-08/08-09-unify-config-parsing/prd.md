# 配置解析合一：env 假值元组 5 处收敛 + 极性归一

## Goal

同一 env 假值语义（存在且值非 `""/"0"/"false"/"no"` → 真）被重写 5 处：
`utils/runtime_config.py:37`（`_FALSEY_STRINGS`）、`utils/billions_config.py:33`
（`_disabled`）、`core/llms/tools/web_search.py:48`（`web_search_enabled`）、
`core/llms/tools/get_market_intel.py:45`（`_mcp_disabled`）、
`core/ui/display.py:120`（`_env_enabled`）。且 env 层为**负极性**
（`TDX_MCP_DISABLED`，truthy = 禁用）而运行时覆盖层为正极性
（`TDX_MCP_ENABLED`，bool = 启用），display.py 桥接这个翻转。目标：
一个 `env_bool` helper + 单一极性边界，配置语义零变化。

## Background / Confirmed Facts

- 5 处假值元组逐字相同（`"", "0", "false", "no"`），真值判定语义
  spec 明言"逐字对齐"（billions_config.py:9-11）——这是已承诺的契约
- 极性翻转点：env `TDX_MCP_DISABLED`/`WEB_SEARCH_DISABLED`（truthy=关）
  → runtime 键 `TDX_MCP_ENABLED`/`WEB_SEARCH_ENABLED`（bool=开）——
  新键/新消费点容易搞反（08-08 曾出现）
- int 解析双份：runtime_config.py:51-55 与 billions_config.py:69-73
  （非法值回退默认，语义一致）
- 消费点行为：`billions_enabled`（主闸+总闸+能力闸，覆盖层优先）、
  `web_search_enabled`（装配时判定）、`_mcp_disabled`（调用时判定）、
  `_env_enabled`（面板初始值）——各自语义不同但共用同一假值判定

## Requirements

- **R1 `env_bool` helper**：`utils/env_config.py`（或 billsions_config
  内）单一 `env_bool(name, default=False) -> bool`：值缺失/假值列表 →
  False 语义的规范化判定；所有 5 处改为调用（`_disabled`/`_env_enabled`
  成为一行包装或直接替换）
- **R2 极性归一（仅内部）**：消费点统一按**正极性 bool** 思考——env
  负值在读取边界归一（`env_bool("TDX_MCP_DISABLED")` 返回 `not` 语义或
  提供 `env_disabled()` 显式名）；**env 键名与 truthy 语义不变**
  （现有 .env 与测试兼容）
- **R3 int 解析合一**：`billions_max_calls` 与 runtime int 归一化共用
  同一 int-parse 实现
- **R4 契约单测**：真假值/未设置三态 × 各消费点（现有测试已覆盖
  web_search/get_market_intel/billions_config/display 面板初始值——
  改造后全绿即语义等价证明）

## Acceptance Criteria

- [ ] `grep -rn "false\|FALSEY" utils/ core/` 仅剩单一判定实现
      （helper 内），无重复假值元组
- [ ] 现有配置测试全绿：`test/utils/test_billions_config.py`、
      `test_runtime_config.py`、`test/core/llms/tools/test_web_search.py`、
      `test_get_market_intel.py`、`test/core/ui/test_display.py`（面板
      初始值）——零修改或仅断言性修改
- [ ] e2e `test_settings_panel.py` 绿（env → 面板初始值 → 提交 → 覆盖
      生效全链路语义不变）
- [ ] 全量回归绿（父任务 Cross-Child AC 1-4）
- [ ] spec 更新：architecture.md「Configuration」节写明单一判定实现与
      极性边界

## Notes

- 硬边界：不重命名 env 键、不反转 truthy 语义、不改覆盖层键表——
  `.env` 兼容优先
- display.py `_env_enabled` 改造后若变一行，面板渲染逻辑不动
