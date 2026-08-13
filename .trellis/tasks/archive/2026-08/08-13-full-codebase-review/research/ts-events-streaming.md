# ts-events-streaming 审查报告

审查人: TsEventsStreaming
审查方式: 纯只读代码审查（未运行任何测试/linter/应用；跨文件引用仅用 read/grep 验证消费方与导入关系）

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|ts/src/events.ts|158|有发现（1 INFO；协议主体符合）|
|ts/src/progress.ts|65|无发现|
|ts/src/pipeline.ts|227|无发现|
|ts/src/retry.ts|154|无发现|
|ts/src/llm.ts|68|无发现|
|ts/src/prompt.ts|42|无发现|
|ts/src/toolLoop.ts|115|有发现（1 WARNING + 1 INFO）|
|ts/src/gates.ts|64|无发现（review 点 6 落点不在本文件，见 spec 符合性结论）|

跨文件验证对象（只读、不纳入发现）: ts/src/committee.ts（ROLES/enabledRoles/envDisabledBool）、ts/src/agents.ts（completeExpert/completeWithTools/streamOrInvoke——running→流式→pushReport→done 时序与 onReset/onRetry→'retry' 单通道的消费方）、ts/app/App.tsx:79-123（report 清 partial 规则消费方）、ts/src/webSearch.ts:13-23（envDisabled）、store.ts/overview.ts/indicators.ts/f10.ts/log.ts（导入符号存在性）。

## 发现

### [WARNING] 删除 toolLoop 中 `finalContent`/`void finalContent` 死代码
- **位置**: ts/src/toolLoop.ts:73-76
- **问题**: `finalContent` 在每一轮被计算（含 `String(response.content)` 归一化），随后仅在 `void finalContent;` 中作废——纯死代码，且恰好位于"无 tool_calls → 提前返回"分支内，该分支实际返回的是**未归一化**的 `response`，与计算意图矛盾。任何后续维护者读到此处会误以为早退分支对 content 做了归一化。无运行时影响（String 无副作用），但属于 spec 严重度定义中的死代码，应删除两行（返回类型 `{ response: { content: unknown } }` 不需要归一化，调用方 agents.ts:157 自行归一化）。
- **证据**:
  ```ts
  const finalContent = typeof response.content === 'string' ? response.content : String(response.content);
  if (!toolCalls?.length) {
    void finalContent;
    return { response, messages: [...messages, response as BaseMessage] };
  }
  ```
- **建议**: 删除第 73 行 `const finalContent = ...` 与第 75 行 `void finalContent;`。
- **spec 对照**: 无直接 spec 条款；严重度表「死代码/重复 → WARNING」。
- 置信度: 1.0（逐行可证：`finalContent` 全文件唯一引用即 `void`）

### [INFO] toolLoop 非流式回退路径可能把 'undefined'/'[object Object]' 当文本增量发射
- **位置**: ts/src/toolLoop.ts:63-64（roundCall 的 invokeWithRetry 分支）
- **问题**: `String(out.content)` 对 `undefined` 得 `'undefined'`（truthy），对对象得 `'[object Object]'`——若假件（无 `.stream()` 的 LLM）返回 `{ content: undefined }` 或非字符串 content，onDelta 会把垃圾文本追加进 UI partial。真实 ChatOpenAI 恒有 `.stream()`（走上一分支），故仅在离线假件路径可达；agents.ts:105 streamOrInvoke 的 invoke 回退存在同一模式（同文件级问题，一并建议修复）。
- **证据**:
  ```ts
  const out = (await invokeWithRetry(llm, payload, config)) as { content: unknown; tool_calls?: unknown };
  const text = typeof out.content === 'string' ? out.content : String(out.content);
  if (text) onDelta?.(text);
  ```
- **建议**: 改为 `const text = typeof out.content === 'string' ? out.content : '';` 或对非字符串内容显式跳过（工具轮 chunk 语义下 content 应为空串/字符串，二者之外均为异常形态）。
- **spec 对照**: streamWithRetry 契约「空/工具轮 chunk 跳过」；invoke 回退路径应保持同等"非文本不发射"语义。
- 置信度: 0.8（触发依赖假件返回形态，无法在 ts/test（片外）核实）

### [INFO] events.ts FinalReport.opinions 用 run 结束时刻的 enabledRoles() 快照，与事件时刻映射不一致（中途开关角色边界）
- **位置**: ts/src/events.ts:128-139
- **问题**: 事件发射（pushReport/pushDelta/pushStatus）用**事件时刻** `enabledRoles()`（符合 spec），但最终 opinions 组装用**结束时刻** `enabledRoles()` 遍历 state 取值。若运行中途设置面板关闭某角色：该角色 report 事件仍发射（UI tab 可见），但其产出被 FinalReport.opinions 丢弃；若中途开启某角色：注册表含它但 values 无其 key（静默跳过）。两种快照不一致，最终报告对象与已发射事件流可能对不上。影响面：UI 主消费事件流、仅 done 事件的 finalDecision/stockInformation 直接读 report，故实际可见影响小；属边界未覆盖。
- **证据**:
  ```ts
  const opinions: Opinion[] = [];
  for (const r of enabledRoles()) {
    const v = values[r.stateKey ?? ''];
    if (Array.isArray(v)) { ... } else if (typeof v === 'string' && r.kind !== 'manager') { ... }
  }
  ```
- **建议**: 在 run() 开头捕获 `const roles = enabledRoles()`（即图实际注册的角色快照）并据此组装 opinions，与事件映射语义（事件时刻）统一；或显式注释该快照点差异。
- **spec 对照**: spec 权威覆盖规则要求事件映射用事件时刻 enabledRoles()（本文件已满足）；FinalReport 组装快照点 spec 未规定，属实现层不一致。
- 置信度: 0.85（中途开关角色为设置面板运行时操作，可达；影响为报告对象与事件流不一致）

## spec 符合性结论

六个审查点逐条核对（含消费方跨文件验证）：

1. **PipelineEvent 联合类型 + node→roleKey 映射 + 'report' 清 partial 规则** —— 符合。联合类型六变体与 spec 逐字一致（events.ts:14-20）。pushDelta/pushStatus 用 `enabledRoles().find(r => r.nodeName === node || r.reviseNodeName === node)`、查不到 `?? node` 原样（events.ts:81-88, spec 公式逐字）。'report' 清流式 partial 规则在消费方 App.tsx:88-98 真实现：收到 report 清该 stateKey 对应角色的 nodeName+reviseNodeName 双节点 partial，且用事件时刻 enabledRoles()（注释明确"设置面板中途启用/禁用角色后,报告清除仍按当前注册表生效"）。**边界观察**（App 侧、超本片范围）:中途禁用某角色后其 report 到来时 `nodes.length===0` → `return prev` 不清 partial，ReportContent 的 `partial || fallback` 会让流式 partial 优先于权威报告显示——仅该边界场景，事件侧无改进空间（report 事件形状由 spec 固定）。
2. **enabledRoles() 事件时刻调用** —— 符合。updater 虽在 createPipelineRunner 闭包中只创建一次，但三个 push* 方法体内每次事件都重新调用 `enabledRoles()`（events.ts:77,82,86），无挂载闭包陈旧问题。
3. **streamWithRetry** —— 符合。迭代 `llm.stream()`（retry.ts:120）；聚合用 `@langchain/core/utils/stream` 的 `concat`（retry.ts:121,126）；`isRetryable` 判定（status 429/500/502/503/504 + message 正则 connection/connect error/timeout/timed out/network）；退避 `min(baseDelay × 2^(attempt-1), 8s)` ≤3 次（1s,2s,4s）；`onRetry` 在 `warn` 之后、sleep 之前回调（retry.ts:134-139, 顺序 warn→onRetry→sleep 逐字符合）；非对象聚合返回 `{ content: aggregated }` 不丢文本（retry.ts:141-142）；空流返回 `{ content: '' }`（retry.ts:127）。onDelta 经 extractDeltaText 过滤空/工具轮 chunk（content 为 string/数组 text 块）。
4. **toolLoop 工具轮复位通道与时序** —— 符合。每轮（含收尾轮）走 streamWithRetry 流式（toolLoop.ts:57-66）；轮末 tool_calls 非空 → warn + `onReset()`（toolLoop.ts:80-82）；消费方 agents.ts:151-153 将 onDelta→safePushDelta、onRetry→safePushStatus('retry')、onReset→safePushStatus('retry')——**共用单通道**，与 spec「二者共用 pushStatus(node,'retry') 单通道」一致；时序 running(completeWithTools 首行)→流式→doneMsg→pushReport→done（agents.ts:139-160）符合。附带验证：messages 累积（human tuple + AIMessageChunk + ToolMessage）与收尾轮 +1 有界（≤16 次调用）正确；bullish_opinions 通道 addMessages 收 draft+revise 两篇（events.ts 组装出初稿+修订版 opinions，符合 FinalReport 契约）。
5. **retry.ts 与 invokeWithRetry 语义对齐 + prompt.pipe(llm) 假件回退** —— 符合。streamWithRetry 与 invokeWithRetry 共用 isRetryable/退避公式/retryWarnMessage（R2 文案一致）；prompt.ts 的 `{system_message}`/`{current_date}` 占位符在 agents.ts:56-58/80-82 构造期 `.replace` 格式化；prompt.pipe(llm) 有 `.stream()` → streamWithRetry，无（假件）→ invokeWithRetry + 单次全量 delta（agents.ts:90-104 与 toolLoop.ts:57-66 双路径一致）。
6. **gates.ts 开关语义** —— **落点不在本文件**。gates.ts 仅含 freshness 门（asiaToday/getLastBusinessDay/overviewNeedsRefresh/latestPastQuarterEnd/reportsFresh/FetchScope），全部逻辑正确（周末回退、季度末候选序、请求尺寸判重用均与注释契约一致），无任何 *_DISABLED 环境开关。开关语义实现在 committee.ts:31-33 `envDisabledBool` 与 webSearch.ts:17-20 `envDisabled`，两处**逐字相同**且符合 ("", "0", "false", "no") → 关 的语义（含 toLowerCase）。**观察**（涉及文件超本片范围，仅记录）:同一语义双份实现，committee.ts 与 webSearch.ts 各一份，建议收敛为单点共享（如放入 gates.ts 或独立 util），防后续漂移。

整体结论: 事件流/流式/重试层实现与 spec 高度一致，协议级正确性无 CRITICAL；唯一功能性瑕疵是 toolLoop 死代码与假件路径的垃圾 delta 边界，均为非阻断级。
