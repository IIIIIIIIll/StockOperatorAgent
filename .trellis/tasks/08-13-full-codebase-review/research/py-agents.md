# py-agents 审查报告

审查分片：Python agents 层（`agents/base.py` + `agents/chinese_mainland/` 7 个 agent）。
对照 spec：`.trellis/spec/agents/index.md`、`agent-template.md`、`tools.md`；并核实
`utils/state.py` reducer 契约、`core/llms/tool_loop.py`、`core/llms/progress.py`、
`core/role_registry.py` 工厂、`core/llms/prompt.py` prompt 归属、committee 装配调用、
`test/agents/*` 与 `test/integration/test_graph_parallel.py` 钉死的契约。

审查方式：纯只读。逐文件全文阅读 + 跨文件引用验证（reducer 行为用仓库指定版本
langchain-core 实测：raw str → HumanMessage、`("human", text)` tuple → HumanMessage、
追加写原 key 后 `[-1].content` 恒为最新版；查询字节一致性对照
test_query_baselines 基线字符串逐段核对）。

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|agents/base.py|142|有发现（2 INFO）|
|agents/chinese_mainland/bearish_trader.py|44|有发现（1 INFO 风格）|
|agents/chinese_mainland/bullish_trader.py|44|有发现（1 INFO 风格，同 bearish）|
|agents/chinese_mainland/fundamental_analysis_expert.py|18|无发现|
|agents/chinese_mainland/trend_analysis_expert.py|18|无发现|
|agents/chinese_mainland/technical_indicator_analyst.py|18|无发现|
|agents/chinese_mainland/investment_manager.py|45|无发现|
|agents/chinese_mainland/information_analyst.py|212|有发现（1 INFO 注释）|

## 发现

### [INFO] `_prefetch` 文档注释误述联网回退素材判定方式
- **位置**: agents/chinese_mainland/information_analyst.py:145-156（`_prefetch` docstring）
- **问题**: docstring 断言「真实素材判定：『检索结果】』分节标记（亿信『…检索结果』/
  联网『【联网搜索结果】』）」，但 `"检索结果】"` 并不是 `"【联网搜索结果】"` 的子串
  （「联网**搜索**结果」≠「…**检索**结果」）。代码本身正确——联网节另用
  `web_section.startswith("【联网搜索结果】")` 单独判定（found_content 第二段），
  仅注释误导后续维护者（按注释误以为统一子串判定）。
- **证据**:
  ```python
  found_content = any("检索结果】" in section for section in sections)
  if not found_content and web_on:
      web_section = self._web_search_section(ticker)
      sections.append(web_section)
      found_content = web_section.startswith("【联网搜索结果】")
  ```
- **建议**: 将 docstring 括号改为「联网『【联网搜索结果】』（startswith 单独判定，
  非『检索结果】』子串）」。
- **spec 对照**: tools.md「`_prefetch` 以『检索结果】』分节标记判真实素材（亿信
  『…检索结果』/ 联网『【联网搜索结果】』）」——spec 文字同样可被读作统一子串，
  实现与 spec 语义一致，仅注释表述含混。

### [INFO] `build_chain` 重复计算 `get_last_business_day`，双链日期可能分叉
- **位置**: agents/base.py:78-81（`build_chain` 内 current_date 计算）
- **问题**: `__init__` 已计算 `current_date = get_last_business_day(datetime.date.today())`
  并 partial 进主链；`build_chain` 再次调用 `get_last_business_day(datetime.date.today())`
  计算第二条链的日期。两调用虽在构造期间毫秒级完成，但跨午夜边界构造时主链与
  revise 链会携带不同 `current_date`（交易日日历差异），且属于可避免的重复计算
  （`build_chain` 复用 `__init__` 的日期即可）。实际触发概率趋近于零，无线上影响。
- **证据**:
  ```python
  current_date = get_last_business_day(datetime.date.today())
  self.prompt = self.prompt.partial(current_date=current_date)
  ```
  ```python
  current_date = get_last_business_day(datetime.date.today())
  chain_prompt = chain_prompt.partial(current_date=current_date)
  ```
- **建议**: `build_chain` 复用构造时计算的 `current_date`（如存 `self._current_date`
  或由 `build_chain` 传参），消除重复计算与潜在分叉。
- **spec 对照**: agent-template.md「构造器 … `current_date` partials
  （`get_last_business_day(datetime.date.today())`）」——行为符合 spec，属实现细节。

### [INFO] 子类构造器默认参空格风格不一致
- **位置**: agents/chinese_mainland/{bearish_trader,bullish_trader,fundamental_analysis_expert,
  technical_indicator_analyst,trend_analysis_expert,investment_manager}.py:11-13
- **问题**: 6 个子类构造签名写 `progress_updater = None`（等号两侧空格），而基类
  `agents/base.py:44` 与 `BillionsInformationAnalyst.__init__`（information_analyst.py:71）
  写 `progress_updater=None`。纯风格不一致，功能等价，无行为影响。
- **证据**: `def __init__(self, llm: BaseChatModel, config: RunnableConfig, progress_updater = None, tools: list | None = None):`（bearish_trader.py:11）
- **建议**: 统一为 `progress_updater=None`。
- **spec 对照**: 构造签名语义符合 agent-template.md「(llm, config, progress_updater=None,
  tools=None)」，无 spec 偏离。

## spec 符合性结论

8 文件整体**符合** agents spec，逐项核验：

1. **统一构造签名** ✅ — 基类 `(llm, config, progress_updater=None, tools=None, *,
   role_message)`；三专家/信息面分析师无 tools 参（spec：专家不传 tools），两 trader
   与 manager 有 tools 可选第 4 参；`_client`/`_searcher` 注入由信息面分析师子类
   super() 前自存。committee 装配 `r.factory(llm, config, progress_updater, None|tools)`
   与全部构造签名兼容（role_registry `_expert_factory`/`_trader_factory` 零改动）。
2. **节点方法模板** ✅ — `complete_expert`/`complete_with_tools` 与 spec 骨架逐行一致：
   logger.debug → safe_progress(start) → invoke（`{"query": [("human", …)]}` 形状）→
   safe_progress(done) → push_report（ProgressBridge 节点级即时填充，非 bridge 为
   no-op）→ 返回更新 dict（**不原地 mutate state**）。
3. **revise 轮** ✅ — 两 trader 各自 `build_chain(<revise_message>)` 建第二条链（共享
   同一 bind_tools 后实例，`_bound_llm`）；revise 查询含对方初稿 + 自己初稿
   （`[-1].content`，双入边 join）；`chain=self.revise_llm, max_tool_rounds=3` 成本护栏；
   **追加写原 opinions key**（State 零新 key），初稿保留、`[-1]` 恒为最新版——
   test_graph_parallel 钉死 `[0]`=初稿 / `[-1]`=修订版，manager 零改动读修订版。
4. **State 键读写** ✅ — fundamental/trend/technical_indicator/information_analysis 由
   各节点写入正确 key；bullish/bearish_opinions 读 `[-1].content`（manager 与 revise）；
   final_decision 由 manager 写入。reducer 行为实测确认：返回 raw string 进
   add_messages key 被包装为 HumanMessage，`[-1].content` 即正文（spec 2026-08-02
   升级实测结论复现）。
5. **ANALYST 开关容错** ✅ — 读方（trader/manager）经 `AgentNode.info_section(state)`
   的 `state.get("information_analysis")` 容错，缺失/空 → 空串；关闭态查询与改动前
   逐字节一致（test_query_baselines `_BULL_BEAR_BASELINE`/`_MANAGER_BASELINE` 逐段
   比对通过，含尾部 8 空格）；开启态插入位置（trader 查询尾 / manager 技术指标与
   多头观点之间）与测试断言一致。UI 消费端经 ProgressBridge 事件 key 渲染，条件 key
   天然容忍（跨边界核验：display 无直接 state 下标访问 information_analysis）。
6. **prompt 归属** ✅ — 9 个角色消息常量全部在 `core/llms/prompt.py`
   （fundamental/trend/technical_indicator/information/bullish/bearish/
   bullish_revise/bearish_revise/investment_manager_message），agent 文件零 prompt
   定义，仅引用；唯一路由短语互斥（初稿「坚定看多/看空」vs 修订「对抗修订轮的
   多方/空方交易员」，离线测试按 system 消息路由）。
7. **返回类型与 reducer** ✅ — 所有写入 `[-1].content` 索引 key 的返回值均为 raw
   string（add_messages 包装）或 BaseMessage（消息通道 tuple→HumanMessage 实测
   通过）；`information_analysis`/`final_decision`/专家报告 key 为普通 Optional[str]
   （无 reducer），返回 string 直存，无类型错配。
8. **信息面分析师预抓/回退** ✅ — 固定参数（fast/count=5/past 3 months）逐源 1 次；
   失败源 logger.warning + 注明不 raise；「检索结果】」真实素材判定 + R2 联网回退
   （固定 1 次 `_QUERY_TEMPLATES["web"]`，`_searcher` 注入点复用单点摘要实现）；
   双失败 → 空列表 → 固定回退文本「（本次运行未检索到任何信息面素材：所有来源均
   不可用或未启用）」逐字保留；全关组合零 client 构造（test_information_analyst
   6 用例矩阵全对齐）。

未发现 CRITICAL / WARNING 级问题。整体：无数据错误、无崩溃路径、无协议破坏、
无 spec 偏离（3 条 INFO 均为注释/风格/实现细节）。
