# 执行计划：测试质量修复

## 顺序与验证门

### 1. 基线确认（前置）
- [ ] `python3 -m pytest --collect-only -q` 无收集错误（基线 581）。
- [ ] 确认 Streamlit 应用未占用 ZODB 锁（跑全量前需停应用——data_storage spec 约定）。若占用，先跑离线子集，标注环境限制。

### 2. R2 → R1（同文件，先修失效前提再拆同义反复）
- [ ] R2：`test/data_storage/test_ZODBStorage.py` 补 `transaction` 导入（或按实际 API 修正调用）；静态检查零 F821。
- [ ] R1：重写 `test_need_update` 为表驱动独立期望（固定输入日期 + 硬编码期望布尔），不调用实现 helper 推导。
- [ ] **验证门**：`pytest test/data_storage/test_ZODBStorage.py -v` 全绿；临时 hack 实现恒 True → `test_need_update` FAIL（验证后还原）。**注意**：ZODB 测试需文件锁，确保无其他进程持有。

### 3. R3（None 降级路径）
- [ ] `test/core/data_acquisition/test_data_acquisition_tdx.py` 增 `get_stock_data` None 用例（注入 `_build_overview=None` 无价格来源）。
- [ ] `test/core/llms/tools/test_get_company_info.py` 增 `raise Exception('Stock not found')` 触发用例。
- [ ] **验证门**：两个文件离线子集全绿；触发路径断言到 raise/None 本身。

### 4. R4（专家 agent 行为测试）
- [ ] 读 `test/agents/test_agent_base.py` 与 `test/integration/test_graph_parallel.py` 的离线模式（FakeListChatModel 路由、dummy fixtures）。
- [ ] 新建 `test/agents/test_expert_agents.py`（或按现有命名），覆盖三专家：构造签名兼容注册表工厂、node 返回 State key 写入、`complete_expert` 管道形状、技术指标分析师无 bind_tools。
- [ ] **验证门**：`pytest test/agents/ -v` 全绿；零 LLM 调用审计（无真实 key、无网络——与 e2e 同款审计思路，检查日志无真实链路标记）。

### 5. R5（低优先，若进行）
- [ ] `test_mcp_intel_cache.py` 的 dummy key 改为 fixture 级 set/restore。
- [ ] **验证门**：该文件全绿 + `test/e2e/conftest.py:87-95` 的"遗留 key"注释可删（若涉及则一并更新）。

### 6. 收尾
- [ ] 离线全集（test/agents、test/core、test/data_structure、test/utils）全绿。
- [ ] 有条件时全量回归（先停 Streamlit 应用）。
- [ ] 无新增 skip/xfail；`git diff` 审视仅测试 + 最小生产注入点。
- [ ] spec 更新：testing.md 或相关 index 注记（如测试数基线 494→新值、新测试模式）。

## 回滚点

- 每步独立提交前可单独 revert；R4 若引入生产注入点，先提交测试失败态再提交生产改动（或同一提交内成对，按仓库惯例）。
