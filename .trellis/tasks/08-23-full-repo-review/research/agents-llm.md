# LLM 编排链评审 — agents / llm / prompt / toolLoop / reports

> 切片负责人: AgentsLlmReview · HEAD `e4d8680` (master) · 2026-08-23 · 只读静态评审

## 头部:范围 + 方法

**范围**:核心五文件全文精读——`src/toolLoop.ts`(154 行)、`src/llm.ts`、`src/prompt.ts`、`src/agents.ts`(543 行)、`src/reports.ts`;按数据流追读关联面:`src/events.ts`、`src/retry.ts`、`src/progress.ts`、`src/committee.ts`、`src/pipeline.ts`、`src/webSearch.ts`、`src/billionsClient.ts`、`src/billionsTools.ts`、`src/mcp.ts`、`src/gates.ts`,以及 App 侧接线 `app/lib/runner.ts`、`app/lib/settings.ts`、`app/lib/analysisController.ts`、`app/hooks/useAnalysis.ts`。

**方法**:纯静态取证(read/grep/`git log -S`);对照 spec `.trellis/spec/ts/agents-tools.md`、`error-handling.md`、`ts/rn-runtime.md`;先读上轮基线 `findings_verified.md`(C1/C2/E11/D7/E8 等已整改项只验证不复报)与 FP 三模式清单(信任边界混淆/忽略设计注释/变量误读),每条发现判定前过筛。

**客观基线**(未重跑):typecheck 0 错误;vitest 51 文件 581 测试 = 580 通过 + 1 跳过。

---

## 发现表

| ID | 严重度 | 标题 | 证据(file:line + 引文) | 影响 | 建议修法 | 置信度 |
|----|--------|------|------------------------|------|----------|--------|
| AL1 | **P2** | billions/MCP 客户端在真机 Hermes 上依赖未打补丁的 `AbortSignal.timeout`,整条亿信/MCP 能力静默失效 | `src/billionsClient.ts:124` `signal: AbortSignal.timeout(timeoutMs),`;`src/mcp.ts:95` `signal: AbortSignal.timeout(this.timeoutMs),`、`:139`(initialize 通知同款)。而同仓 `src/yahoo/yahooClient.ts:67-70`(U4 整改产物)明确记载:「Hermes 兼容:AbortController 全局存在……**AbortSignal.timeout 静态 API 在 Hermes 未打补丁、不可靠 → 手写 setTimeout + controller.abort()**」;`app/lib/polyfill.ts:88-102` 只补了 `throwIfAborted`,无 `timeout` 静态补丁;`ts/rn-runtime.md` 规则「新增 Hermes 缺口补丁一律进 polyfill.ts」。真机接线无平台门:`app/hooks/useAnalysis.ts:106-113` fetchIntel/makeBillionsClient/assembleTools 对 RN 同样生效 | Android 真机配置 key 后:`TypeError: AbortSignal.timeout is not a function` 在 `_post` try 内抛出 → 归一化为 `BillionsApiError("亿信 API 请求失败:…")` → 预抓四节全为「检索失败」占位、finDb 占位、三件套工具每次调用返回失败占位文本(浪费 LLM 工具轮次且诱导模型反复重试工具,放大 AL2 触发概率);cn MCP 实时情报同理降级。web/Node 不受影响(`AbortSignal.timeout` 原生存在)——与 web 端表现不一致,用户侧表现为「真机亿信永远失败」且零显式报错 | 与 `yahooClient.fetchWithTimeout` 同款手写模式替换三处调用点;或在 `polyfill.ts` 按 rn-runtime.md 流程补 `AbortSignal.timeout` 幂等 polyfill(零新依赖) | 0.65(runtime 行为需真机复验;仓内文档与接线证据充分) |
| AL2 | **P2** | toolLoop 收尾轮不校验返回是否仍带 `tool_calls` → 可静默产出空最终报告并标 done | `src/toolLoop.ts:108-112`:收尾轮后直接 `const final = await roundCall(...); return { response: final, ... }`,对 `final.tool_calls` 无任何检查(FINAL_ROUND_INSTRUCTION 只是提示词约束,模型可不服从);下游 `src/agents.ts:163-166` `completeWithTools` 将 `String(response.content)` 直接 `pushReport` + `roleStatus 'done'`。`test/tool-loop.test.ts:110-122` 仅覆盖收尾轮服从指令的路径 | 模型在全部 N 轮(经理 15/修订轮 3)+ 收尾轮仍请求工具且 content 为空时:最终结论/修订版报告以空串落 report 事件与 lastRun 缓存,UI Tab 空、`done` 正常发射、无任何错误信号。与 AL1 叠加时触发面扩大(工具持续失败占位 → 模型更易陷入工具循环直至耗尽轮数)。该边角零测试覆盖 | 收尾轮返回后检查 `final.tool_calls?.length` → 非空时以占位文本(如「搜索轮数已用尽,未能生成最终回答」)替代空 content 再 pushReport,或至少在 `completeWithTools` 对空 content 落占位;补一条不服从收尾指令的测试用例 | 0.6 |
| AL3 | P3 | `configError` 死导出(E7 同款新实例) | `app/lib/runner.ts:176-179` `export function configError(cfg){ if (cfg) return null; return '未配置 LLM 三键——将使用演示占位报告。'; }`;全仓 grep(app/src/desktop/test/tools)零消费点(App 门禁文案实际走 `App.tsx:68-70 missingLlmKeys`) | 死代码;与 U29 清理后的仓库卫生标准不一致 | 删除(或若有意保留 API 则接线到 controller 启动日志) | 0.95 |
| AL4 | P3 | 亿信条目格式化三函数双实现漂移(agents.ts 私有副本 vs billionsTools.ts 导出) | `src/agents.ts:267-277 collectContentItems`、`:286-304 formatSearchItem`、`:308-330 formatTweetItem` ≈ `src/billionsTools.ts:26-45`、`:48-74`、`:77-92` 同名同源移植(Python `_items.collect_content_items` / `billions_search._format_item` / `billions_twitter._format_tweet`);细节已现微差:agents 版 `if (item['date'])`(空串/'0' 同判)vs billionsTools 版 `item.date !== undefined && !== null && !== ''`;agents 版 extra 解析内联 vs `_extra()` 带 Array 排除 | 两份契约将来单边修改(如 snippet 截断、字段增删)必然漂移——预抓分节与工具回流格式悄然不一致;无环依赖强制理由(committee↔agents 环已存在且注释声明 Metro CJS 安全,billionsTools 不新增环形态) | agents.ts 删私有副本改 import `billionsTools.ts` 导出(注意保持 `_QUERY_TEMPLATES` 分节头等本地差异);或提取共享 `_items.ts` 单源 | 0.9 |
| AL5 | P3 | 「今天」锚点双源:App 注入 UTC 日期,gates 契约声明 asiaToday 为全仓唯一来源 | `gates.ts:17-19` 注释:「北京时间"今天"……全仓唯一"今天"来源」;`pipeline.ts:214` 缺省 `deps.today ?? asiaToday()`(北京日);但 `app/hooks/useAnalysis.ts:118` `isoNow: () => new Date().toISOString(),` + `app/lib/analysisController.ts:253/:385/:391` `today: d.isoNow().slice(0, 10)` = **UTC 日**,经 runner opts → `buildStockInformation` 覆盖缺省。`git log -S isoNow` 证实系 U13 抽取前既有写法(非新引入),但 U22 刚把 DataScreen 收敛到 `asiaToday()` 单源,此残留同类未收 | 北京时间 00:00–08:00(UTC 日仍为昨日)运行分析时,overview 当日锚定(lastBarIsToday/当日涨跌/60d 基准/ytdBase)整体错一天;探针(tools/probe.mts,走缺省 asiaToday)与 App 路径不同源。另与 system_prompt 的市场感知营业日(`agents.ts:84 getLastBusinessDay(marketToday(market))`)口径不一 | deps 注入改为 gates 单源:`isoToday: () => marketToday('cn')`(或按 market 取 `marketToday(m)`),controller 三处同步 | 0.8 |
| AL6 | P3 | `proxyUsed` 死变量 | `app/lib/settings.ts:182` `let proxyUsed = false;` → `:190` `proxyUsed = true;` 后即 return;全函数再无读取点 | 死存储,纯卫生问题 | 删除变量与赋值(分支语义由 return/warn 表达已完备) | 0.95 |
| AL7 | P3 | 工具结果注入 prompt 的截断策略不一致:fetch 有 3000 字符上限,search/twitter/web_search 无任何上限 | `src/billionsTools.ts:113-114` `FETCH_MAX_CONTENT_CHARS = 3000` + 截断注记;而 `summarizeSearchResults`(:60-70)/`summarizeTweets`(:93-102)逐条拼接 snippet 无本地截断(agent 注释声称「snippet(≤500)」仅是上游契约描述,`billionsClient._post` 原样透传不裁剪);`src/webSearch.ts:25-43 summarizeResults` 对 Tavily `content`/DDG snippet 亦无 cap;toolLoop 注入端 `ToolMessage({ content: String(content) })`(`toolLoop.ts:100`)无二次截断,15 轮累计消息无 token 预算管理 | 上游返回超常条目(脏数据/供应商变更)时长文本直入上下文,挤占窗口推高成本;Python 移植现状一致,属设计缺口而非回归 | 统一注入面截断单点(toolLoop ToolMessage 层或各 summarize 层加 per-item/总长 cap),并与 spec 记录预算策略 | 0.7 |

### 待查线索(未列为发现)

- **外部内容注入 LLM 上下文的提示注入面**:DDG/Tavily/亿信检索文本按设计进入 prompt(Python 同构,产品语义如此);系统提示词有反编造约束但无结构化隔离。属产品级设计议题,非本切片缺陷。
- **streamWithRetry 重试重复 delta**:流中途失败重试会重新流出重叠前缀;消费端 `roleStatus 'retry'` 清 partial(`analysisController.ts:438-440`)兜底,报告事件为准,未见用户可见重复——如未来出现重复渲染再立卡。
- **`enabledRoles()` 每 emit 重查表**(events.ts:96-110):设置面板中途启停角色会使进行中事件的 tabTitle/roleKey 映射漂移;影响面纯展示映射,量级极低。
- **classifyChatResponse 对 `resp.ok` 且非 JSON 体判「可达」**(settings.ts:228-233):200+HTML 网关误报可达的构造场景过于牵强,暂不列。

---

## Verified-clean 抽检清单

1. **跨 run 状态泄漏(重点排查后排除)**:曾疑 `thread_id: '1'` 固定线程 + addMessages reducer 导致 opinions/messages 跨 run 累积污染(events.ts:152 默认 config);实证 `committee.ts:187` `makeInvestmentCommittee` 每次 run 新建 `new MemorySaver()`,checkpointer 随图实例销毁 → 无跨 run 泄漏;run 内初稿+修订版经 `.at(-1)` 读最新、FinalReport.opinions 全量展开均为预期设计。
2. **C1/C2 整改后契约符合**:`events.ts:139-145` busy 同步置位拒绝(busy error 事件 + resolve undefined)、`:168-186` 运行期/配置期失败一律 emit error + resolve undefined,无 rethrow 残留(逐 throw 点核查:makeLlm/buildStockInformation/graph.stream/getState 均在 try 内);`running` done/catch 双路径复位(:167-168/:185-186)。
3. **重试分类与退避**:`retry.ts:22-30` isRetryable status 驱动(429/500/502/503/504)+ 连接类消息正则;401/400 直抛零延迟 ✓;invoke/stream 双路径共用 warn 文案与退避曲线(1s 起 ×2 上限 8s ≤3 次),`Promise.withResolvers` sleep 无泄漏。
4. **reports.ts 缺失容错**:空 records → `[]`;缺失指标 → NaN;QoQ 相邻季度门(88–93 天)+ 除零/首期 NaN(reports.ts:31-52);`value_num * mult` NaN 安全传播;`sales_gross_margin` 恒 NaN、`industry` 恒 '' 有注释背书(对齐 Python)。
5. **demoLlm 兜底(E11 已关闭)**:`buildLlm(null)` → PHRASES 最左短语路由,test/demo-llm.test.ts 18 用例钉住「提示词 ↔ 路由」耦合;demoLlm 无 `.stream` → agents/retry 自动落 invokeWithRetry + 单次全量 delta 分支,无 stream 假设破坏。
6. **prompt 市场/币种主链一致**:system_prompt 三占位符替换顺序正确(market_cycle 先于 system_message 内嵌替换,agents.ts:82-86);hk/us market_rules 注入币种/交易制度(manager {market_cycle} 同);块 3 yahooFinancialIndicatorsText 用 `marketInfo(market).currency` 标注原币(pipeline.ts:172-186);信息面 infoSection 缺失 → 空串逐字对齐 Python(agents.ts:169-175)。
7. **progress 映射三方一致**:toolLoop/agents(onDelta/onRetry/onReset/safeProgress/pushReport)→ ProgressUpdater 协议(progress.ts safe* 全容错)→ events.ts updater(nodeName/reviseNodeName/stateKey 经 ROLES 双向查表,:96-110)→ analysisController 归约(token 累积/retry 清 partial/report 清 partial+权威内容,:424-441),事件类型与消费完全对齐,无丢失通道。

---

## 未覆盖面声明

- **LangChain 库内部行为**(@langchain/core openai-stream concat 聚合、bindTools 序列化、MessagesPlaceholder 渲染、addMessages id 去重细节)按库契约信任,未审 node_modules 源码。
- **LangGraph 图执行语义**(superstep 并行 join、checkpointer 快照时机)仅静态走查,未运行验证;并行专家节点异常聚合依赖 `describeError.errors[]` 形状,未实测多节点同时失败的聚合消息形态。
- **AL1 的运行时断言**(Hermes 是否确实无 `AbortSignal.timeout`)基于仓内 U4 整改记录与 polyfill 现状推断,需真机一次最小 repro 复验定谳。
- **App UI 层对 token/report/roleStatus 的渲染细节**(partials 展示、Tab chips)归 AppLibUiReview 切片;desktop child/main 进程协议与 CI 归 DesktopToolsCiReview 切片;yahoo 采集数据面归 DataSource 切片——本报告仅在交界处(buildStockInformation/today 注入)交叉核对。
