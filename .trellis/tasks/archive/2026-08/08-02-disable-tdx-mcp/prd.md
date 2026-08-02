# TDX MCP 暂时禁用——环境变量开关

## Goal

分析流程暂时不调用 TDX MCP（实时情报段）——MCP 查询网络往返/超时拖慢
分析（无 key 或服务不稳时尤其明显）。用户确认：**环境变量开关方式**
（可逆，恢复只需删环境变量，不动代码）。

## Requirements

### R1（环境变量开关）

- `get_market_intel` 顶部检查环境变量 `TDX_MCP_DISABLED`（存在且非空/
  "1"/"true" 任一真值形式 → 禁用）。禁用时**直接返回占位文本，不查
  MCP、不读写缓存**。
- 默认（未设置）= 正常行为（MCP 查询 + 缓存逻辑不变）。
- 占位文本语义与现有无 key 降级一致（stock_information 拼接/UI 渲染
  零变化）：复用 `_FALLBACK_TEXT` 或新增专有文案（如
  `（TDX MCP 已禁用，跳过实时市场情报）`——设计定，需同步既有断言）。

### R2（禁用时不触发 MCP 副作用）

- 禁用路径不得触发：`TdxMcpClient` 构造、`_query_mcp` 调用、缓存读写
  （mcp_intel_cache 不产生文件——08-02-mcp-intel-cache 契约保持）。
- 无 TDX_API_KEY 时的既有路径不变（key 检查在开关之后/之前顺序由设计
  定，语义等价即可）。

### R3（测试）

- 新用例（test_mcp_intel_cache.py 或 test_get_market_intel.py）：
  - 设 `TDX_MCP_DISABLED=1` + 有 key → 返回占位，`_query_mcp` 零调用
    （计数包装）、缓存目录无文件。
  - 设开关 + 无 key → 同样占位（任一顺序都覆盖）。
  - 清开关 + 无 key → 既有 `_FALLBACK_TEXT` 断言仍绿（原测试不动或微调）。
- 既有测试影响：`test_committee_enrichment.py` 断言
  `"未配置 TDX_API_KEY" in text`——若占位文案变化需同步；若复用
  `_FALLBACK_TEXT` 则零改动。

## Acceptance Criteria

- [ ] `TDX_MCP_DISABLED` 设置时：get_market_intel 返回占位文本，零
      MCP 调用、零缓存文件
- [ ] 未设置时：行为与现状完全一致（缓存逻辑/查询/降级不变）
- [ ] 开关真值判定覆盖常见形式（"1"/"true"/非空——设计定一种，测试
      钉死）
- [ ] 既有测试全绿（enrichment 段断言随文案决策同步）；新增开关用例
- [ ] 全量回归 0 新增失败（基线 0F/216P/20S）

## Notes

- Lightweight task：PRD-only（改 get_market_intel 一个函数 + 测试，
  无跨层改动）。
- 文案决策：复用 `_FALLBACK_TEXT`（"（未配置 TDX_API_KEY，跳过实时
  市场情报）"）——与无 key 语义混淆；新增专有文案更清晰但需同步
  test_committee_enrichment 断言。倾向**专有文案**（如实反映状态），
  同步既有断言（一处）。
- 不做：删除 MCP 代码、配置文件开关、UI 展示变化（情报段仍显示占位
  文本——如实反映"当前未提供实时情报"）。
