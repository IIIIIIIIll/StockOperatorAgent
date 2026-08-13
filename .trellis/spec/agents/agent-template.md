---
description: Agent 模板与对抗修订轮 — AgentNode 基类管道、节点骨架、revise 语义与成本护栏
paths:
  - agents/base.py
  - agents/chinese_mainland/**
---
# Agent 模板与对抗修订轮

All seven agents (`agents/chinese_mainland/`) inherit **`AgentNode`
（`agents/base.py`，08-09-agent-base-class）**——模板公共管道收敛到基类：
**继承基类 + 显式查询构建**（不再复制模板）。基类承载**不变管道**：

1. **构造器** `AgentNode.__init__(llm, config, progress_updater=None, tools=None, *, role_message)`：
   - prompt 壳 `ChatPromptTemplate.from_messages([("system", system_prompt),
     MessagesPlaceholder(variable_name="query")])` + `system_message` /
     `current_date` partials（`get_last_business_day(datetime.date.today())`）
   - **可选工具绑定（08-03-websearch-tool-calling）**——三个工具角色
     （bullish/bearish/investment_manager）由 committee 传 `tools`；构造时
     `llm.bind_tools(tools)` 包 **NotImplementedError 回退**（硬约束：
     langchain-core 1.5.3 `FakeListChatModel.bind_tools` 实测抛
     NotImplementedError——离线图测试靠它保持全绿；生产 DeepSeek/Qwen
     OpenAI 兼容路径正常绑定）。专家不传 tools，保持直调：
     ```python
     if tools:
         try:
             llm = llm.bind_tools(tools)
         except NotImplementedError:
             logger.warning("LLM {} 不支持 bind_tools，跳过工具绑定", type(llm).__name__)
     self.llm = self.prompt | llm
     ```
   - 另存 `config` / `progress_updater` / `self.tools = tools or []`；
     已绑定实例存 `self._bound_llm`（build_chain 复用）
   - 子类构造签名保持 `(llm, config, progress_updater=None, tools=None)`
     ——注册表 Role.factory 零改动（`super().__init__(llm, config,
     progress_updater, tools, role_message=<角色消息>)`；information_analyst
     的 `_client=None`/`_searcher=None` 注入由子类 super() 前自存，不进基类）
2. **`build_chain(role_message, llm=None)`** — 第二条链（trader 的 revise
   链）：复用构造时**已绑定** llm（双链共享同一实例）；revise 角色 system
   消息（含"对抗修订轮的多方/空方交易员"独有短语，与初稿路由短语互斥——
   离线测试按 system 消息路由）
3. **节点骨架方法**（progress/report/retry/state 返回收敛）：
   - `complete_expert(query_text, state_key, *, start_msg, done_msg, log_label)`
     ——专家（三专家 + 信息面分析师末段 LLM）：`logger.debug("{} Query: {}",
     log_label, query_text)` → `safe_progress(start_msg)` →
     `invoke_with_retry(self.llm, {"query": [("human", query_text)]},
     config=self.config)`（2026-08-02，review #6 重试约定）→
     `safe_progress(done_msg)` → `push_report(updater, state_key,
     response.content)`（08-02 queue bridge 节点级即时填充；None/非 bridge
     updater 为 no-op，superstep update 兜底）→
     `{"messages": [query[0], response], state_key: response.content}`
   - `complete_with_tools(query_text, state_key, *, chain=None,
     max_tool_rounds=None, start_msg, done_msg, log_label)` ——工具角色
     （bullish/bearish 初稿与修订 + manager）：`invoke_with_tools(...)`
     （08-03-websearch-tool-calling，见"工具调用循环"段，返回
     `(final, 全量 messages)`；修订轮传 `chain=self.revise_llm,
     max_tool_rounds=3`，缺省 None → tool_loop 默认 15）→ push_report →
     `{"messages": 全量, state_key: content}`——消息通道完整含工具交换
     （AIMessage with tool_calls + ToolMessage）
   - `info_section(state)` ——信息面条件段（3× 复制的 4 行收敛，见
     Tools 段）
   - 骨架不改变 invoke 语义：safe_progress 的中文文案、state dict 形状
     与改造前逐字节一致（progress 文案原样传参；`test_query_baselines.py`
     钉死查询文本）
4. **State key 显式传参**：agent 不 import role_registry（注册表保持装配/
   UI 面向——避免 agents → core.role_registry 反向耦合）

**agent 文件保留差异化**（基类只收不变管道）：角色 prompt 常量
（prompt.py）、查询构建（f-string，**逐字节不变**——`test/agents/
test_query_baselines.py` 钉死）、角色特有逻辑（信息面分析师的确定性预抓
`_prefetch`/`_search_section`）。

UI 路径的 `progress_updater` 是 **`ProgressBridge`**（core/llms/progress.py，
`info`/`push_report` 线程安全入队，脚本线程消费后渲染；离线图测试可传
`_ThrowingUpdater` 验证 safe_progress 降级——详见 core spec Streamlit
UI 段）。

Reference: `agents/base.py` + 任一 agent，以及 wiring 在
`core/investment_committee.py` 与单 agent 测试图（`test/integration/
test_basic_graph.py`，用 `dummy_*` fixtures 隔离下游 live LLM）。

## 对抗修订轮（08-04-adversarial-verdict-loop，critique-and-revise）

bullish/bearish trader 各新增**第二个节点方法** `bullish_revise` /
`bearish_revise`——单轮对抗修订（verdict MVP：固定轮数、无收敛检测、无
多轮循环、无 conditional edge）：各读对方初稿与自己初稿
（`state['<opp_key>'][-1].content` / `state['<own_key>'][-1].content`——
双入边 join 保证两份初稿已就绪），修订一版**追加写原 opinions key**
（State 零新 key，add_messages 累积；初稿保留在列表中供 UI 展示对抗过程
与评估"修订保留率"），manager 经 `[-1].content` **零改动**读修订版。
模板（bullish 侧，bearish 对称）：

```python
def bullish_revise(self, state: State):
    own_draft = state['bullish_opinions'][-1].content
    opponent_draft = state['bearish_opinions'][-1].content
    query = f"…对方观点 {opponent_draft} …你的初稿 {own_draft} …"
    response, messages = invoke_with_tools(
        self.revise_llm, query, self.config,
        tools=self.tools, max_tool_rounds=3, progress_updater=self.progress_updater,
    )
    push_report(self.progress_updater, "bullish_opinions", response.content)
    return {"messages": messages, "bullish_opinions": response.content}
```

- **第二条链 `self.revise_llm`**：`self.revise_llm = self.build_chain(
  <revise_message>)`（08-09-agent-base-class：基类 build_chain 承载同一
  实例的第二条链）——system 消息为 `bullish_revise_message` /
  `bearish_revise_message`（prompt.py），角色独有短语"对抗修订轮的多方/
  空方交易员"，**与初稿路由短语（"坚定看多/看空的股票交易员"）互斥**
  （离线测试按 system 消息路由，歧义即 "UNROUTED" 暴露）；`llm` 复用
  同一 bind_tools 后实例（初稿链 `self.llm` 不动）。
- **成本护栏**：revise 节点 `invoke_with_tools(..., max_tool_rounds=3)`
  ——初稿轮保持默认 15（`_MAX_TOOL_ROUNDS`）。公共签名零改动，只传参；
  评估跑批仍可用 `WEB_SEARCH_DISABLED` 整体停用搜索。
- **修订约束（prompt 硬约束，R4）**：**先复述对方最强的一条论据，再逐条
  回应**（strongest-rebuttal，08-04-draft-prompt-pure 用户拍板）、保留自己
  ≥80% 核心论据、可承认对方有效点但**不得反转立场**、输出**完整修订版观点**
  （manager 把 [-1] 当完整观点消费，不能只输出反驳）、可联网搜索验证、中文
  禁编造（house style）。
- **初稿纯观点（08-04-draft-prompt-pure）**：bullish/bearish **初稿** prompt
  只要求完整多头/空头观点（不要求预想对方反驳——方案 4 增补已撤，2026-08-04
  用户拍板）；**对抗只发生在修订轮**（看到对方真实观点后交锋）。
- **UI 契约（core spec Streamlit UI 段）**：display 同 key **追加渲染**
  （观点 tab 初稿 → `---` 分隔 → 修订版），去重集合按 `(key, content)` 对
  （防 superstep 兜底重复推送同内容）。
- 图装配：8 节点 16 边（ANALYST 开 9 节点 19 边；08-09-role-registry
  起由 `core/role_registry.py` 注册表驱动——加角色只改 `ROLES`，装配
  循环生成，见 core spec InvestmentCommittee 节）。历史增量：+2 节点
  +6 边（各 revise 双入边 join 两份初稿、各 revise → manager）；+1 节点
  +3 边（技术指标分析师——START → 分析师 与三专家并行、分析师 → 两个
  trader，bullish/bearish 变**三入边 join**）；+1 节点 +4 边（信息面分析
  师，条件接线——启用谓词在注册表单点定义）；墙钟 3 → 4 阶段。manager /
  State / tool_loop 公共语义零改动。
