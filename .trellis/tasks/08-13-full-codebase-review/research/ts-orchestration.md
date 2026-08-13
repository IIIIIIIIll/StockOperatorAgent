# ts-orchestration 审查报告

分片范围：TS 编排/状态层（ts/src/agents.ts、committee.ts、store.ts、store-memory.ts、log.ts、format.ts）。
只读审查：未运行测试/linter；所有结论来自源码 + 依赖库源码（ts/node_modules 版本）+ Python 对照。

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|ts/src/agents.ts|333|有发现（WARNING×1 关联、INFO×1）|
|ts/src/committee.ts|156|有发现（WARNING×1）|
|ts/src/store.ts|241|有发现（INFO×2，与 store-memory 分叉对照）|
|ts/src/store-memory.ts|82|有发现（INFO×3）|
|ts/src/log.ts|188|有发现（INFO×1；另 1 条在 ts/app/server.mjs，跨文件核实）|
|ts/src/format.ts|5|有发现（INFO×1，回答审查重点：数字格式化不在本文件）|

交叉核实文件（只读引用，非本片审阅目标）：
- Python agents/base.py、agents/chinese_mainland/bullish_trader.py、fundamental_analysis_expert.py、investment_manager.py（行为对齐）
- Python core/investment_committee.py、core/role_registry.py、utils/state.py（图装配/State/边表对齐）
- Python utils/formatting.py（数字格式化语义）
- ts/node_modules/@langchain/langgraph/dist/graph/messages_reducer.js、@langchain/core/dist/messages/utils.js（addMessages/coerce 语义实证）
- ts/src/retry.ts、ts/src/toolLoop.ts、ts/src/pipeline.ts（调用链/默认值核实）
- ts/test/committee.test.ts、query-content.test.ts（假 LLM 返回形状核实）

## 发现

### [WARNING] makeInvestmentDecision 为死导出，且签名/默认行为与 Python 偏离

- **位置**: ts/src/committee.ts:142-156
- **问题**: 全仓库 grep `makeInvestmentDecision` 仅 committee.ts 自身定义一处（另有归档 design.md 文字引用，非代码调用）；真实入口是 events.ts:116 内联等价的 `makeInvestmentCommittee(config, updater, llm)`。同时该导出与 Python 对应物偏离：Python `make_investment_decision(target_ticker)` 是独立可用入口（内部 `build_stock_information` 组装 + `make_llm()` 默认），TS 版要求调用方传 stockInformation，且省略 `_llm` 时直接抛 `M2: _llm required`——任何未来的误调用都会得到运行时异常而非可用图。死代码 + 行为与 Python 语义偏离。
- **证据**:
  ```ts
  export async function* makeInvestmentDecision(
    targetTicker: string, stockInformation: string, config?: unknown, _llm?: LlmLike | null,
  ): AsyncGenerator {
    const threadConfig = config ?? { configurable: { thread_id: '1' } };
    const graph = makeInvestmentCommittee(threadConfig, null, _llm);  // _llm 缺省 undefined → throw
  ```
- **建议**: 删除该导出（events.ts 已内联等价逻辑），或按 Python 语义收敛：内部组装 stock_information + `_llm ?? makeLlm()` 默认后再接入调用方。
- **spec 对照**: ts/index.md 未定义该入口；偏离 Python core/investment_committee.py `make_investment_decision` 的独立可用契约。

### [WARNING] streamWithRetry 非对象/空流分支返回裸 {content}，进 messages 通道会触发 coercion 崩溃

- **位置**: ts/src/retry.ts:132,141（关联调用链 agents.ts:122,127）
- **问题**: `completeExpert` 把 `streamOrInvoke` 的返回值原样写入 `{ messages: [query[0], response], ... }`（agents.ts:127）。messages 通道 reducer `addMessages`（= messagesStateReducer）对每个元素调用 `coerceMessageLikeToMessage`：对无 `type`/`role` 键的裸对象，最终进入 `_constructMessageFromParams` 的无匹配分支并抛 `MESSAGE_COERCION_FAILURE`（实证：ts/node_modules/@langchain/core/dist/messages/utils.js:39-77）。而 `streamWithRetry` 的两个非消息分支——空流 `return { content: '' }`（retry.ts:132）与非对象聚合 `return { content: aggregated }`（retry.ts:141，spec 明示支持的"纯字符串 chunk 假件"路径）——恰好构造这种裸对象；这与 retry.ts:134-137 注释"state 消息通道需要真实消息实例，重建 {content,tool_calls} 会破坏 LangGraph 消息 coercion"自相矛盾。当前仓库内假 LLM（committee.test.ts / query-content.test.ts）均返回 AIMessage、生产 LLM（OpenAI 兼容 SDK）stream 产出消息 chunk，故现有测试/生产不触达；但任何按 spec 用非对象 chunk 的流式假件或返回裸对象的无 stream LLM 都会在 messages reducer 处把整张图跑崩。
- **证据**:
  ```ts
  if (aggregated === undefined) return { content: '' };      // retry.ts:132 裸对象
  ...
  return { content: aggregated };                            // retry.ts:141 裸对象
  ```
  ```ts
  return { messages: [query[0], response], [stateKey]: content };  // agents.ts:127 原样入通道
  ```
- **建议**: 非对象分支返回真实消息实例（如 `new AIMessage({ content: aggregated })`）；或 completeExpert 写 messages 通道前把非 BaseMessage 响应包装为 AIMessage。
- **spec 对照**: ts/index.md 流式输出节规定"非对象聚合……原样作 content 返回"——该规定与 LangGraph JS addMessages 的 coercion 现实冲突，属 spec 与实现的张力点；修复需同步考虑。

### [INFO] 经理查询尾部空白与 Python 逐字节契约漂移

- **位置**: ts/src/agents.ts:317-326（InvestmentManager.investment_manager 查询）
- **问题**: TS 查询以 `\n` 结尾；Python investment_manager.py 同段 f-string 以 `\n        `（换行 + 8 空格）结尾。已逐段核对：专家/交易员/修订/经理中间段（含 `\n${info}` 插入点、`多头观点/空头观点` 段）渲染结果与 Python 一致；仅尾部 8 空格缺失。对 LLM 输入实质无影响，但违反 agents.ts 头注释"M3 逐字对齐"的字节级契约。
- **证据**: TS `...${bearish}\n        \n`（agents.ts:324-325）vs Python `...{bearish_opinion}\n        \n        `（investment_manager.py 收尾三行）。
- **建议**: 补上结尾 `        `（8 空格）。
- **spec 对照**: 偏离 M3 test_query_baselines 逐字契约（仅空白级）。

### [INFO] InMemoryStore.replaceDatas([]) 清空既有日K，SQLite 保留

- **位置**: ts/src/store-memory.ts:44-47 vs ts/src/store.ts:185-186
- **问题**: SQLite `replaceDatas` 对空数组早退 `if (!bars.length) return 0;`（不清数据）；InMemory 版先 `this.bars.delete(ticker)` 再走 addDatas（空输入 → 返回 0 但已清空）。空输入语义分叉：若采集代理返回空全量，InMemory 会静默抹掉该 ticker 全部日K，SQLite 不动。
- **证据**: `replaceDatas(ticker, bars) { this.bars.delete(ticker); return this.addDatas(ticker, bars); }`
- **建议**: 对齐 SQLite：`if (!bars.length) return 0;` 置于 delete 之前。
- **spec 对照**: data_storage 层"全量替换"契约未定义空输入；双实现应对齐。

### [INFO] addDatas 的 last 取值来源分叉（bars 末元素 vs stock.lastDataUpdate）

- **位置**: ts/src/store-memory.ts:24-25 vs ts/src/store.ts:131-133
- **问题**: SQLite 以 `stock.lastDataUpdate` 判重；InMemory 以现有 bars 末元素日期判重。若某 ticker 未先 putStock 就 addDatas：SQLite `last` 恒为 null → 每次全量 INSERT OR REPLACE（幂等但返回虚高计数 fresh.length）；InMemory 正确过滤。当前调用链（webCollect/pipeline）均先 putStock，未触达，但两实现边界语义不收敛。
- **证据**: `const last = stock?.lastDataUpdate ?? null;` vs `const last = existing.length ? existing[existing.length - 1].date : null;`
- **建议**: InMemory 也可优先取 stock.lastDataUpdate（存在时），与 SQLite 单点对齐。
- **spec 对照**: N/A（边界未覆盖）。

### [INFO] InMemoryStore.getStock 返回活引用，SQLite 每次新对象

- **位置**: ts/src/store-memory.ts:18-20 vs ts/src/store.ts:88-99
- **问题**: InMemory `getStock` 直接返回 Map 内对象引用（无防御拷贝），SQLite 每次反序列化出新对象；同接口下 `getDatas`/`getPerformanceReports` 两实现都拷贝。当前调用方（DataScreen/pipeline/webCollect/probe）只读返回值，无实际破坏；但未来任何调用方修改返回对象字段会污染 InMemory 存储而 SQLite 不受影响。
- **证据**: `return this.stocks.get(ticker) ?? null;`（store-memory.ts:19）
- **建议**: `{ ...stock }` 浅拷贝（与 putStock 的拷贝对称）。
- **spec 对照**: N/A（接口未承诺引用语义；getDatas 的新数组语义已由 ts/index.md 图表节明确并两实现满足）。

### [INFO] RN 沙盒日志初始化竞态：初始化完成前的日志不进文件

- **位置**: ts/src/log.ts:180-186
- **问题**: `log()` 的 RN 分支 fire-and-forget `initRnFileTransport().then(() => rnTransport?.(level, message))`——expo-file-system 为动态 import，模块级惰性初始化是异步的；初始化未完成期间产生的日志只进 console（RN 分支的 fetch 上报仍生效），沙盒文件丢失启动早期若干条。console 不丢，属低危时序问题。
- **证据**: `void initRnFileTransport().then(() => rnTransport?.(level, message));`
- **建议**: 初始化期间先缓存待写行，resolve 后回放（或接受丢失并在注释中说明）。
- **spec 对照**: ts/index.md"统一日志出口"契约未覆盖初始化窗口。

### [INFO] ts/app/server.mjs:67 启动横幅直用 console.log（第二 console 出口）

- **位置**: ts/app/server.mjs:67（跨文件核实；ts/app/lib 无 console 使用，logs-server.cjs 走 fs 落盘为设计路径）
- **问题**: 服务启动横幅 `console.log('[soa] web server: ...')` 未走 log.ts。属一次性启动消息而非业务日志，且 log.ts 的 node 分支本就只 console（server 落盘在端点内），影响可忽略；与"不新增第二日志出口"约定仅有表面冲突。
- **建议**: 可选改用 log.ts 的 info() 以完全收敛。
- **spec 对照**: 轻微偏离 ts/index.md"新增日志调用一律经它"；既有横幅非新增。

### [INFO] format.ts 仅含 fmtDate；数字格式化实现在 pipeline.ts，语义已对齐

- **位置**: ts/src/format.ts:1-5
- **问题**: 审查重点"format.ts 数字格式化与 Python utils/formatting.py 语义一致"的答案：format.ts 只有日期归一化（fmtDate，YYYYMMDD→YYYY-MM-DD 幂等）；数字格式化是 ts/src/pipeline.ts:14-17 的 `fmtNumber`——`null/undefined/NaN → 'N/A'`，否则 `toFixed(digits)`，与 Python `fmt_number`（None/NaN→"N/A"、保留 digits 位）语义一致，且 pipeline.test.ts:32-39 钉死。无语义分叉；仅位置不在本文件。另注意 DataScreen.tsx:147 存在第二处内联格式化路径（`Number.isFinite ? toFixed(3) : 'N/A'`，3 位小数）——属 UI 分片，仅提示。
- **证据**: `fmtNumber(value, digits) { if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'; return value.toFixed(digits); }`
- **建议**: 无需改动；如追求单点，可将 fmtNumber 迁入 format.ts 并让 pipeline.ts 复用。
- **spec 对照**: 符合（对齐 Python formatting.py 语义）。

## spec 符合性结论

- **状态装配/图形状（committee.ts）**：符合。StateAnnotation 键与 Python utils/state.py 一一对应；opinions 双通道用 `addMessages` reducer，写入字符串会被 messagesStateReducer 经 `coerceMessageLikeToMessage` 包装为 HumanMessage（实证 node_modules 源码），`[-1].content` 读取（bullish_revise/bearish_revise/investment_manager）与 Python `[-1].content` 一致；`buildEdges` 与 Python role_registry.build_edges 逐边一致（专家∥→交易员 N 入边 join→双入边 revise join→经理→END）；信息面分析师条件注册谓词公式与 Python 一致；`ROLES` 7 角色 nodeName/reviseNodeName 与 events.ts 查表约定匹配。
- **查询构建（agents.ts）**：整体符合 M3 逐字对齐（专家/交易员/修订/经理中段经渲染对比一致）；唯一字节级偏离是经理查询尾部 8 空格（INFO）。
- **重试/流式集成**：streamWithRetry 非对象分支与 messages 通道 coercion 存在冲突点（WARNING），当前生产/测试路径不触达。
- **存储层（store.ts / store-memory.ts）**：getDatas 每次返回新数组的新语义两实现均满足（spec 图表节依赖）；addDatas 增量/去重/单事务语义对齐 Python add_datas；replaceDatas 全量替换语义对齐。分叉点均为未先 putStock/空输入等边界（INFO 级）。
- **日志（log.ts）**：符合统一出口约定；web 上报 /logs、RN 沙盒 + EXPO_PUBLIC_LOG_ENDPOINT、node 仅 console 路由与 spec 一致；无第二业务日志出口（server.mjs 启动横幅为一次性，ts/app/lib 无 console）。RN 初始化窗口丢文件行为未在 spec 声明。
- **数字格式化**：语义与 Python utils/formatting.py 一致（NaN/None→N/A、两位小数），实现位于 pipeline.ts 而非 format.ts。

总体：编排/状态层移植与 Python 侧高度对齐，未发现 CRITICAL；2 条 WARNING（死导出 + 流式假件 coercion 崩溃路径）、7 条 INFO。
