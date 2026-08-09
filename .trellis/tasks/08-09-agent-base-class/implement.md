# 执行：Agent 基类（7× 模板公共管道去重）

> 复杂任务三件套齐备 → 可 start。实现走 trellis-implement 子代理（主会话
> dispatch，prompt 前缀 `Active task: <task path>`）；每步验证门全绿再进
> 下一步；trellis-check 在全部完成后做收尾校验。

## 执行顺序

### Step 1 — `agents/base.py` 基类 + 单测

- `AgentNode`：构造（role_message 必填；tools 绑定 NotImplementedError
  回退）、`build_chain`、`complete_expert`、`complete_with_tools`、
  `info_section`（design.md 契约）
- 新测试 `test/agents/test_agent_base.py`（class 风格，house style 无
  mock）：注入假 llm 验证——prompt partials 生效、bind_tools 回退、
  complete_expert 返回 dict 形状（messages 含 query+response、key 写入）、
  complete_with_tools 全量 messages、info_section 三态（缺失/有值）
- 验证门 1：`pytest test/agents/test_agent_base.py -v` 绿

### Step 2 — 三专家迁移（机械同构）

- fundamental / trend / technical_indicator_analyst 改继承 AgentNode
- 验证门 2：`pytest test/agents/ test/core/llms/ test/integration/ -q`
  全绿（test_query_baselines 钉死查询字节；test_basic_graph deprecated
  skip 不动）

### Step 3 — 交易员 + 经理（双链/工具角色）

- bullish/bearish：基类 + revise 双链 + info_section；manager 同构
- 验证门 3：`pytest test/agents/ test/core/llms/tools/ test/integration/
  test/core/test_billions_tools.py -q` 全绿（工具绑定/修订轮语义）

### Step 4 — 信息面分析师 + 工具去重

- information_analyst：构造走基类（_client 注入保留），预抓逻辑不动，
  末段 LLM 调用走 complete_expert
- `core/llms/tools/_items.py`：collect_content_items（3 处收敛）
- `core/llms/tools/_capped.py`：capped_call（3 工厂收敛；占位文本逐字
  保留，对照现有文本 diff）
- 验证门 4：`pytest test/core/llms/tools/ test/core/test_billions_tools.py
  test/agents/test_information_analyst.py -q` 全绿

### Step 5 — 全量回归 + spec 更新 + 提交

- `pytest` 全量（基线 504P/20S，不新增失败）
- spec 更新（agents/index.md）：「The Agent Class Template」节改写为
  基类约定（继承 + 显式查询构建；state_key 显式传参；info_section/
  collect_content_items/capped_call 助手单点）；code-reuse guide 追加
  亿信工具骨架条目
- 提交：`refactor(agents): AgentNode 基类——7× 模板公共管道去重`

## 验证命令速查

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-09-agent-base-class
pytest test/agents/test_agent_base.py -v                    # Step 1 后
pytest test/agents/ test/core/llms/ test/integration/ -q    # Step 2 后
pytest test/agents/ test/core/llms/tools/ test/integration/ test/core/test_billions_tools.py -q  # Step 3 后
pytest test/core/llms/tools/ test/agents/test_information_analyst.py -q  # Step 4 后
pytest                                                      # Step 5 全量
```

## 回滚点

- 每步独立提交可 revert；Step 2-4 为行为等价替换（无 schema/数据迁移）
- test_query_baselines 非绿 = 查询被改动 → 立即停，diff 查询文本
- tool 占位文本被改动（test_billions_tools 红）→ 对照原文本还原
