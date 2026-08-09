# 执行：配置解析合一（env 假值元组 5 处收敛 + 极性归一）

> 中复杂度任务：prd + design + 本 implement 齐备 → 可 start。实现走
> trellis-implement 子代理；trellis-check 收尾。

## 执行顺序

### Step 1 — 原语 + 单测

- runtime_config.py 加 `env_disabled(name)`（复用 _FALSEY_STRINGS）与
  `env_int(name, default)`
- test_runtime_config.py 补三态真值表 + env_int 非法值回退
- 验证门 1：`pytest test/utils/test_runtime_config.py -q` 全绿

### Step 2 — 5 处消费点收敛

- billsions_config（_disabled → env_disabled；上限解析 → env_int）、
  web_search.web_search_enabled、get_market_intel._mcp_disabled、
  display._env_enabled（→ not env_disabled 一行）
- 公共 API 与判定语义不变；grep 确认假值元组全库仅剩 _FALSEY_STRINGS
- 验证门 2：`pytest test/utils/ test/core/llms/tools/test_web_search.py
  test/core/llms/tools/test_get_market_intel.py test/core/ui/test_display.py -q`
  全绿

### Step 3 — 全量回归 + spec + 提交

- `pytest` 全量（基线 544P/20S，不新增失败）
- spec 更新：architecture.md「Configuration」节写明 env_disabled 单点
  与极性边界（负 env → 正 bool）
- 提交：`refactor(utils): env 判定单点化——env_disabled/env_int，极性边界显式化`

## 验证命令速查

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-09-unify-config-parsing
pytest test/utils/test_runtime_config.py -q                       # Step 1 后
pytest test/utils/ test/core/llms/tools/test_web_search.py test/core/llms/tools/test_get_market_intel.py test/core/ui/test_display.py -q  # Step 2 后
pytest test/e2e/test_settings_panel.py -q                         # 面板初始值链路
pytest                                                            # Step 3 全量
```

## 回滚点

- Step 1 独立（新增 API）；Step 2 逐消费点可 revert
- 任一配置测试红 = 判定语义被改 → 停，diff 该判定（env 键名/truthy
  语义零变化是硬约束）
