# Design — TS 全流式输出

## 架构与边界

**方案 B:agent 级流式**(否决 LangGraph `streamMode:'messages'`,见 D1)。
token 流在 LLM 调用点产生(agent 内 `llm.stream()`),经 `ProgressUpdater`
可选新方法进入事件总线,UI 消费;LangGraph 图保持现状(默认 updates 模式
仅 drain)。web 端流式链路:浏览器 ChatOpenAI → `/llm-proxy`(SSE 透传)→
上游 LLM。

```
agents.ts (llm.stream + 聚合) ──pushDelta/pushStatus──▶ events.ts updater
                                                          │ emit
                     App.tsx  ◀── token / roleStatus ─────┘
                     (状态条 + 每 tab 打字机)
```

## 数据流与契约

### 1. 事件协议(events.ts)

`PipelineEvent` 新增两个变体:

```ts
| { type: 'token'; roleKey: string; node: string; delta: string }
| { type: 'roleStatus'; roleKey: string; node: string;
    status: 'running' | 'done' | 'retry' }
```

- `node` 携带图节点名(如 `bullish_trader` / `bullish_revise`),UI 借此区分
  初稿与修订轮缓冲;`roleKey` = stateKey(如 `bullish_opinions` / `final_decision`),
  由 events.ts 经 `ROLES` nodeName 查表映射。
- 既有 `progress/report/done/error` 语义不变;`report` 仍是最终内容权威来源
  (UI 收到即覆盖该节点缓冲)。

### 2. ProgressUpdater(progress.ts)——可选方法向后兼容

```ts
export interface ProgressUpdater {
  info(msg: string): void;
  pushReport(key: string, content: string): void;
  pushDelta?(node: string, delta: string): void;      // 新增,可选
  pushStatus?(node: string, RoleStatus): void;        // 新增,可选
}
```

可选(非必实现)→ 现有 fake/调用方(committee 传 null、pipeline 的 info)零
改动;events.ts 的 updater 实现二者并转成事件。agent 内经
`safeProgress` 风格守卫调用(updater 缺失/抛错 → no-op)。

### 3. streamWithRetry(retry.ts)

```ts
export async function streamWithRetry(
  llm: { stream(payload, config?): AsyncIterable<unknown> },
  payload: unknown,
  config?: unknown,
  opts?: {
    attempts?: number; baseDelay?: number;          // 对齐 invokeWithRetry
    onDelta?: (delta: string) => void;               // 每文本 chunk
    onRetry?: (attempt: number, err: unknown) => void;
  },
): Promise<{ content: unknown }>
```

- 迭代 `llm.stream(...)`,chunk 文本增量实时回调 `onDelta`;聚合用
  `@langchain/core/utils/stream` 的 `concat`(正确处理 content 数组/
  tool_call_chunks),返回聚合后消息。
- 失败(含流中途断):`isRetryable` 判定 + 指数退避(1s 起 ×2 上限 8s,
  ≤3 次,与 `invokeWithRetry` 同参),重试前回调 `onRetry`;耗尽 reraise。
- 文本提取:`chunk.content` 为 string 直接取;数组取文本段 join;空/undefined
  跳过(工具轮 chunk content 为空,天然过滤)。

### 4. agent 层(agents.ts / toolLoop.ts)

- `LlmLike` 增可选 `stream?(payload, config): AsyncIterable<unknown>`。
- `completeExpert`:改走 `streamWithRetry(this.llm, {query}, config, {
  onDelta: d => safePushDelta(updater, node, d),
  onRetry: (n) => { safePushStatus(updater, node, 'retry'); } })`;
  `running` 在调用前、`done` 在 pushReport 后发射;无 `.stream()` 的 llm
  (非 sequence 假件)回退 `invokeWithRetry` + 单次全量 delta。
- `completeWithTools` / `invokeWithTools`:每轮(含收尾轮)改 `streamWithRetry`
  并透传 onDelta/onRetry;轮末 `tool_calls` 非空 → `onReset()`(回滚该轮已
  流出文本,经 `pushStatus(node,'retry')` 同通道或专用 reset 语义——实现取
  `pushStatus(node,'running')` 重发语义保持简单,UI 侧按 token 序覆盖即可,
  详见 D4)。工具执行/进度文本(safeProgress)不变。
- 节点方法签名不变(仍 `(state)`);`config` 仍是构造时传入的静态 config
  (方案 B 不需要 LangGraph 运行 config 注入)。

### 5. web SSE 透传(lib/proxies.cjs 单处)

代理实现已收敛单份 `ts/app/lib/proxies.cjs`(5d0d8ab,dev metro 与生产
server.mjs 共用;头注释已预留「R4 流式透传改造只改这一处」)。改
`handleLlmProxy` 一处即可双入口生效:

```js
const upstream = await fetch(target, { method: 'POST', headers, body });
res.writeHead(upstream.status, {
  'Content-Type': upstream.headers.get('content-type') || 'application/json',
});
// 流式透传,不 await upstream.text()
if (upstream.body) {
  for await (const chunk of upstream.body) res.write(chunk);
}
res.end();
```

- 错误路径保持 502 JSON;upstream 断开 → `res.destroy()` 兜底。
- 头透传保持最小集(content-type;SSE 通常 identity 编码,不额外处理 gzip)。

### 6. UI(App.tsx / ReportContent.tsx)

- 新 state:`partials: Record<node, string>`、`statuses: Record<node, RoleStatus>`。
- subscribe 分发:token → 追加 partial;roleStatus → 写 statuses(`retry` 同时
  清空该 node partial);report → 清空该 node partial(最终内容权威)。
- 角色状态条:每个启用角色一 chip(待运行/分析中/完成/重试中),keyed by
  role 的 nodeName(信息面分析师未启用 → 不渲染)。
- 报告 tab:opinion 角色初稿/修订两槽位分别显示 partial ?? report;非 opinion
  平铺 partial ?? report;final_decision 显示 partial ?? finalDecision;
  running 且 partial 非空时尾部渲染光标「▍」。ReportContent 增加可选
  `partial`/`streaming` props,渲染逻辑增量接入。

## 兼容性与迁移

- 协议为 additive 联合类型扩展;现有订阅方(probe.mts、events.test.ts)按
  type 过滤不受破坏;events.test.ts 断言的事件序列会新增 token/roleStatus,
  需同步更新(见 implement.md Step 5)。
- `ProgressUpdater` 方法可选 → committee/pipeline/测试 fake 零改动。
- 无新依赖(`concat` 已在 `@langchain/core` 内);metro langsmith CJS 重定向
  不受影响。
- 与 08-11-ts-log-persistence(已归档 2dafe01)无重叠:retry.ts 退避 warn
  已合入(1fc7828,errType 探针 + delay),`streamWithRetry` 照抄同一 warn
  模式即可;本任务不动 log.ts / logs-server.cjs / App.tsx 日志接线。

## 关键决策

- **D1 方案 B(agent 级流式)而非 LangGraph messages 模式**:A 需在 events.ts
  做 chunk 级 `tool_call_chunks`/ToolMessage 状态机区分工具轮、依赖图回调
  注入(config 透传)、演示 stub 无 chat-model 事件;版本升级即碎。B 每个
  控制点(角色/轮次/重试)在源头显式,可单测。
- **D2 协议双事件(token + roleStatus)**:token 满足流式;roleStatus 顺带满足
  「每 agent 独立状态」原始诉求,二者同源同通道。
- **D3 工具轮回滚而非保留下推**:报告最终内容必须与 `report` 事件逐字一致;
  工具轮中间文本轮末 reset,避免污染最终报告。代价:模型在调用工具前输出的
  少量推理文本会短暂闪现后消失——接受(工具轮文本通常为空/极短)。
- **D4 retry 复位经 roleStatus('retry')**:UI 收到 'retry' 即清该 node
  partial,重试的完整新流从头渲染;无需额外 reset 事件类型。
- **D5 演示 stub 瞬时填充**:`prompt.pipe(fn).stream()` 产单 chunk,全量
  delta 一次上屏;不做假打字机。
- **D6 状态事件由 agent 发射**(running 于首调前、done 于 pushReport 后):
  不依赖 LangGraph tasks 模式,演示/真机/离线 stub 行为一致。

## 运维与回滚

- 回滚点:协议/UI 改动独立于 LLM 调用层——若代理透传有问题,可先只合
  events/UI 侧(降级为 report 到达即时渲染),LLM 层回退 invokeWithRetry。
- 验证手段见 implement.md;web 流式正确性唯一硬验证点是真实 LLM 浏览器冒烟
  (vitest 无法覆盖 SSE 透传)。
