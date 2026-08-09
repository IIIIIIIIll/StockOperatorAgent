# 测试质量修复（同义反复 + 覆盖缺口）

## Goal

修复审计确认的测试质量问题：1 个高危同义反复测试、1 个静默失效测试、2 个关键 None 降级路径无覆盖、3 个专家 agent 零行为测试。全部离线可验证（零网络、零 LLM、零真实 TDX），house style 无 mock 框架（注入点 + FakeListChatModel）。

## Requirements

### R1. 拆 `test_need_update` 同义反复（高危）
`test/data_storage/test_ZODBStorage.py:48-56`——期望阈值用实现自身的 `get_last_business_day`+17:00 公式计算，两个分支各自断言自己，**删除实现测试照样绿**。
重写为**表驱动 + 独立期望**：固定输入日期（含周末/周一/跨周场景）直接给出期望布尔值，不调用实现的内部 helper 推导期望。删除 `check_need_update_overview` 实现 → 测试必须失败。

### R2. 修 `transaction.abort()` NameError（静默失效）
`test/data_storage/test_ZODBStorage.py:115`——`transaction` 未导入，NameError 被 `except Exception: pass` 吞掉，`test_singleton_concurrent_first_call`"干净关闭连接"的前提从未成立。补导入（或按 ZODB 6.0.1 实际 API 改用正确调用），使测试前提真实生效。

### R3. 补 None 降级路径测试（关键契约裸奔）
- `get_stock_data` → `None`：`core/data_acquisition.py:344` 契约"ensure_stock 失败（无任何价格来源）→ None"——现有测试全部断言 `is not None`。新增：注入 `_build_overview=None` + 无价格来源 → 断言返回 None 且不抛。
- `get_company_info.py:20` 的 `raise Exception('Stock not found')` 路径（由 get_stock_data → None 触发）——目前只有 BJ 拦截分支有测试。新增触发测试。

### R4. 三个专家 agent 行为测试
`fundamental_analysis_expert.py` / `trend_analysis_expert.py` / `technical_indicator_analyst.py` 零行为测试（只有图形状断言 + 跳过的集成测试）。
用 house style 离线模式（参照 `test/agents/test_agent_base.py` 与 `test/integration/test_graph_parallel.py`：FakeListChatModel 按 system 消息路由 + `dummy_*` fixtures），断言：
- 构造器签名与注册表 Role.factory 兼容（`(llm, config, progress_updater=None, tools=None)`）
- node 方法返回 dict 写入正确 State key（`fundamental_analysis` / `trend_analysis` / `technical_indicator_analysis`）
- `complete_expert` 管道：progress 上报、retry 包装、`{"messages": [...]}` 形状
- 技术指标分析师不传 tools 保持直调（无 bind_tools 路径）

### R5. （低优先，时间允许）env 泄漏修复
`test/core/llms/tools/test_mcp_intel_cache.py:215` 的 `TDX_API_KEY=dummy` 不还原（e2e conftest 已确认要靠下游碰巧清掉）——改为 fixture 级 set/restore。

## Acceptance Criteria

- [ ] R1：新 `test_need_update` 为表驱动独立期望；临时删除实现（或把函数体改为恒 True）→ 测试失败。
- [ ] R2：`test_ZODBStorage.py` 无未导入名字（`python -m pyflakes` 或等价静态检查零 F821）；`test_singleton_concurrent_first_call` 的前提真实执行。
- [ ] R3：两条 None 降级路径各有一个离线测试，失败路径可触发。
- [ ] R4：三个专家各 ≥1 个行为测试，全部离线（零 LLM/网络/TDX 调用），断言 State key 写入。
- [ ] 新增用例全绿；无新 skip/xfail；既有 581 用例集合不因本任务回归（离线子集 + 有条件时全量）。
- [ ] 测试风格与 house style 一致（注入点，无 mock 框架；需要最小生产改动时列出并说明）。

## Notes

- 本任务**允许最小生产改动**（如为可测性暴露注入点），但必须逐项在验收中说明理由，且不得改变既有行为（既有测试必须原样通过）。
- 不做项：`test_basic_graph.py` 恢复（live 集成，跳转保留）；`test_akshare.py` 恢复；legacy_akshare 全量离线化；e2e 覆盖扩充（面板开关矩阵、图表暗色）。
- 参照：`test/agents/test_agent_base.py`（离线 agent 测试模板）、`test/core/data_acquisition/test_data_acquisition_tdx.py`（注入点模式）、`test/data_structure/test_row_constructors.py`（from_row 失败路径模式）。
