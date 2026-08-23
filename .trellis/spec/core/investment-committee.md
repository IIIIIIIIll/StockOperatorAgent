---
description: 投资委员会(TS) — 注册表驱动图装配、8 节点 4 阶段、buildStockInformation 组装、events.run 入口
paths:
  - src/committee.ts
  - src/pipeline.ts
  - src/events.ts
  - src/billionsTools.ts
  - src/prompt.ts
---
# InvestmentCommittee(src/committee.ts)

> 本文以 TS 实现为准(Python core/ 已删除);标注【历史】的段落描述 Python
> 时代行为,保留作设计沿革参考。

- `makeInvestmentCommittee(config, progressUpdater = null, _llm, _tools?, deps?)`
  builds a `StateGraph(StateAnnotation)` with **8 节点（条件 9 节点）16 边（ANALYST 开 19
  边）**——**注册表驱动装配**（08-09-role-registry 移植）：节点/边由
  `src/committee.ts` 的 `ROLES` + `buildEdges` 生成，固定 4 阶段
  形状（见下）。历史演进：2026-08-02 review #4 三对并行；08-04
  adversarial-verdict-loop +2 revise 节点；08-08 technical-indicator-
  analyst +1 技术指标分析师；08-08 billions-api-integration +1 条件信息面
  分析师（启用谓词在注册表单点定义）。形状：`START → fundamental`、
  `START → trend` 与 `START → technical_indicator_analyst` 并行（都只依赖
  `stock_information`），三专家 → `bullish/bearish` 并行（都只依赖三份
  报告，trader 变**三入边 join**），
  `bullish/bearish → bullish_revise/bearish_revise`（对抗修订轮——各
  revise 双入边 join 两份初稿，互相独立保持并行），两份修订版 →
  `investment_manager → END`。LangGraph 多入边 = **隐式 join**：trader 等
  三上游都完成、revise 等两份初稿都完成（否则对方初稿缺失）、manager 等
  两份修订版都完成——墙钟 8 串行 → 4 阶段。并行分支写不同 State key
  （无写冲突），`messages` 由 add_messages reducer 合并（顺序不确定——
  消费方只读最终 state，不依赖顺序）。边/节点两形态（16/19 边、8/9
  节点）由 `test/committee.test.ts` 冻结断言钉死；加 agent 改
  `ROLES` 即可，**不要**在 committee 手写条件接线。
- `_llm` 为测试注入点（house style 无 mock 框架）：生产入口 `run(ticker, opts)`
  缺省 `makeLlm()`（src/llm.ts 通用 OpenAI 兼容工厂，见 agents spec）；
  离线图测试（test/committee.test.ts）传路由式假 LLM 验证 join/并行语义。
  **假 LLM 路由注意**：并行下节点调用顺序非确定，必须按 system 消息路由
  （角色文案含独有短语，如「精于计算公司的基本面数据」）。
- Compiled with `MemorySaver()` checkpointer; runtime `config` must carry
  `{"configurable": {"thread_id": "1"}}`（缺省值在 events.run 的 opts.config）。
- **TS 入口与组装**（重写自 Python make_investment_decision /
  build_stock_information 段）：图执行入口是
  `createPipelineRunner(store).run(ticker, opts)`（src/events.ts）：
  采集数据先行写入 store（Node 探针 tools/probe.mts 直采；App 端注入/预载）
  → `buildStockInformation(ticker, deps)`（src/pipeline.ts，**图前 enrichment
  唯一组装点**）→ 组 initial state（messages/target_stock_ticker/
  stock_information/market）→ `graph.stream` 迭代执行（节点事件经
  ProgressUpdater 实时发射为 progress/report/token/roleStatus 事件）→ 读终态
  组 FinalReport（stock_information + final_decision + opinions）→ `done`
  事件。五段拼接顺序：个股信息（`formatStockOutput`）→ 技术指标
  （`trendIndicatorsText`）→ 盈利能力（cn `financialIndicatorsText` / hk-us
  `yahooFinancialIndicatorsText`）→ 实时情报（cn `deps.mcp` 注入闭包，无
  注入/无 key → `fallbackMarketIntel()` 占位；hk-us 无源跳过占位）→
  亿信（`deps.billions` 闭包，开关关/未注入 → 空段自然不出现）。各块降级一律
  占位不 raise；错误契约见 error-handling spec「runner never throws past
  event boundary」——运行期失败只 emit `error` 事件并 resolve(undefined)；
  并发二次 run 被 busy 守卫拒绝（error 事件 + resolve(undefined)，C2）。
- 【历史】Python `make_investment_decision(target_ticker)` 流式执行图；
  `stock_information` 由模块函数 `build_stock_information` 生成（display 与
  决策共用同一组装点；`get_stock_info` stock 缺失 raise 为唯一 raise 点；
  亿信段条件拼接与 data_markdown【亿信金融数据库】marker 注册）。TS 对应物
  即上条 events.run + pipeline.buildStockInformation（TS 无 stock 缺失
  raise——空库走演示链）。
- 【历史】**MCP 情报缓存**（Python `get_market_intel`）：非交易时段
  （utils.market_time.is_trading_time）优先读按 ticker 落盘 JSON 缓存
  （data/tdx_cache/mcp_intel/，core/llms/tools/mcp_intel_cache.py，原子写；
  盘中必须新鲜，查询失败降级占位不静默用旧缓存）。**TS 不移植缓存**
  （src/mcp.ts 头注：无 is_trading_time 完整移植 → 每次实时查询，与 Python
  交易时段行为一致；mcp_intel_cache.py 不移植）。
- **MCP 开关**：TS `mcpDisabled()`（src/mcp.ts）——优先级 TDX_MCP_ENABLED
  env 覆盖 > config.tdxMcp > env 默认（TDX_MCP_DISABLED 经
  switches.fromEnv 反推：键缺省/空/'0'/'false'/'no' → enabled，逐位等价旧
  envDisabledBool 判定）；禁用 → 返回 MCP_DISABLED_TEXT 占位，**不查 MCP、
  不等网络**；恢复 = 删环境变量/开面板开关，不动代码。开关可由设置面板经
  setCapabilitySwitches 显式注入（app 层），消费点惰性读（运行时生效）。
- **联网搜索开关**：语义不变——工具绑定是**构造期**行为：
  `makeInvestmentCommittee` 内 `_tools ?? (webSearchEnabled() ?
  [makeWebSearchTool()] : [])`（专家节点工厂忽略 tools）；web 端 App 层可经
  `assembleTools`（app/lib/runner.ts）组装 web_search + 亿信三件套整表注入。
  开关源：WEB_SEARCH_DISABLED env 反推或面板注入（src/switches.ts，语义
  enabled）。与 TDX MCP 不同：TDX MCP 在调用时判定，二者都是图级可逆开关。
- **亿信工具绑定**：src/billionsTools.ts 工厂各自按 `billionsEnabled(cap)`
  判定（关 → 不绑定）；**每次 run 调用上限**（闭包计数器）：maxCallsByCap
  注入（settings.caps 接线）> env `BILLIONS_{SEARCH,TWITTER,FETCH}_MAX_CALLS`
  > 默认 3/2/3（BILLIONS_DEFAULT_MAX 单源）——超限返回占位提示、不再发真实
  请求，防 15 轮工具循环烧配额。未配置 BILLIONS_API_KEY 时行为同「关」
  （key 约束单点在 billionsCapEnabled）。
- **信息面分析师条件接线**：有效条件 = `informationAnalystEnabled()`
  （src/committee.ts 单点）= `billionsEnabled('ANALYST') &&
  (billionsEnabled('SEARCH') || billionsEnabled('TWITTER') ||
  webSearchEnabled())`；开 → 注册 `information_analyst` 节点 + START 边 +
  trader 第 4 入边（4 专家并行，4 阶段墙钟不变）；关 → 完全不注册（条件接线
  非占位节点，图与关态逐字节一致）。无 key + web 开 → 预抓走 DDG 回退
  （见 agents spec 信息面分析师段）。信息面报告经 State key
  `information_analysis` 插值进 trader/manager 查询（src/agents.ts
  infoSection 条件段，缺失时查询字节级不变）。
- New agents mean: a new entry in `ROLES`, a new edge in `buildEdges`, a new
  `State` key, and a new prompt in `src/prompt.ts`.
