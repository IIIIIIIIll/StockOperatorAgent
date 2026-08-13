---
description: TS 侧(web/RN)移植约定——事件协议、流式输出、LLM 调用、同源代理
paths:
  - ts/**
---

# TS 侧移植约定(`ts/`)

Python 侧分层规范不覆盖 TS 移植。本层沉淀 TS 侧(web 浏览器 + RN app + Node
server)的跨层契约:事件流协议、流式输出、LLM 重试、同源代理。

## 事件流协议(ts/src/events.ts)

`PipelineEvent` 联合类型是 App 与业务层唯一事件契约:

```ts
| { type: 'progress'; message: string }          // 扁平进度文本(不落角色)
| { type: 'report'; key; tabTitle; content }      // 节点报告——最终内容**权威来源**
| { type: 'token'; roleKey; node; delta }         // 流式文本增量(node 区分初稿/修订轮)
| { type: 'roleStatus'; roleKey; node; status }   // 角色生命周期 running|done|retry
| { type: 'done'; report: FinalReport }
| { type: 'error'; error: string }
```

- **node → roleKey 映射**:`enabledRoles().find(r => r.nodeName === node || r.reviseNodeName === node)`;查不到原样用 node。
- **权威覆盖规则**:UI 收到 `report` 即清空该 role 对应所有 node 的流式 partial——流式文本只是过程视图,报告内容永远以 `report` 事件为准。实现必须用事件时刻的 `enabledRoles()` 而非挂载闭包(设置面板中途开关角色时闭包会陈旧)。

## ProgressUpdater 协议(ts/src/progress.ts)

```ts
export interface ProgressUpdater {
  info(msg: string): void;
  pushReport(key: string, content: string): void;
  pushDelta?(node: string, delta: string): void;    // 可选:流式增量
  pushStatus?(node: string, RoleStatus): void;      // 可选:生命周期
}
```

**扩展接口一律加可选方法**(向后兼容——committee 传 null、pipeline 用 info、
测试 fake 零改动)。调用经 `safePushDelta`/`safePushStatus` 守卫(缺失/抛错 →
no-op,图不中断,对齐 `safeProgress`)。

## 流式输出(08-11-ts-streaming-output)

### 设计决策:方案 B(agent 级流式)而非 LangGraph `streamMode:'messages'`

- **为什么**:graph messages 模式需在 events.ts 做 chunk 级
  `tool_call_chunks`/ToolMessage 状态机区分工具轮文本、依赖图回调注入、
  演示 stub 无 chat-model 事件;版本升级即碎。agent 级流式每个控制点
  (角色/轮次/重试)在源头显式、可单测。
- **要点**:`prompt.pipe(llm)` 是 RunnableSequence,`.stream()` 转发末步
  chunk;无 `.stream()` 的 llm(假件)回退 `invokeWithRetry` + 单次全量 delta。

### streamWithRetry(ts/src/retry.ts)

`invokeWithRetry` 的流式孪生,语义必须对齐:

```ts
export async function streamWithRetry(
  llm: StreamableLlm,
  payload: unknown,
  config?: unknown,
  opts?: { attempts?; baseDelay?; onDelta?; onRetry? },
): Promise<{ content: unknown; tool_calls?: unknown }>
```

- 迭代 `llm.stream()`;聚合用 `concat`(`@langchain/core/utils/stream`,正确处理
  content 数组/tool_call_chunks);文本增量实时 `onDelta`(空/工具轮 chunk 跳过)。
- 失败(含流中途断):`isRetryable` 判定 + 指数退避(1s×2 上限 8s ≤3 次),
  退避前 `warn`(attempt/errType/delay,照 `invokeWithRetry` 模式),`onRetry`
  在 warn 后、sleep 前回调;耗尽 reraise。
- 非对象聚合(纯字符串 chunk 假件)不丢文本:原样作 content 返回。

### 工具轮与重试的复位通道

- 工具角色(交易员/经理)每轮流式;轮末 `tool_calls` 非空 → `onReset()` 回滚该轮
  已流出文本;LLM 重试 → `onRetry`。**二者共用 `pushStatus(node,'retry')` 单通道**,
  UI 收到 'retry' 即清该 node partial(避免额外 reset 事件类型)。
- 时序:agent `running`(首调前)→ 流式 → `pushReport` → `done`。

## 同源代理(ts/app/lib/proxies.cjs)

dev(metro 中间件)与生产(server.mjs)共用**单份**实现(收敛防漂移)。路由:
`/llm-proxy`(LLM 转发)、`/tdx-collect`(采集)、`/web-search`(搜索)、
`/logs`(日志汇聚,见 lib/logs-server.cjs)。

**SSE 透传**(流式必需):`handleLlmProxy` 必须 pipe `upstream.body` 分块转发,
**禁止 `await upstream.text()` 整体缓冲**(否则浏览器一次性收到 SSE,无实时性)。

```js
if (upstream.body) {
  for await (const chunk of upstream.body) res.write(chunk);
}
res.end();
```

> **Warning**: 流式透传后 `writeHead` 之后抛错(上游断流/客户端断开)不可再
> writeHead——必须 `if (res.headersSent) { res.destroy(); return; }` 兜底,
> 否则客户端永久挂起。未 writeHead 的错误路径保持 502 JSON。

## 环境与启动约束

- proxies.cjs / logs-server.cjs 用 CJS(metro.config.js 是 CJS,server.mjs 是
  ESM,两者都能 require)。
- proxies.cjs `require('../../src/*.ts')` 依赖 Node `--experimental-strip-types`
  (dev `npm start` 与生产启动命令已带;node ≥23.6 默认开启)。
- `ts/src/log.ts` 是全端统一日志(web 上报 `/logs` + RN 沙盒 + Node),新增
  日志调用一律经它,不新增第二日志出口。

## 图表(web-only;08-13-ts-all-indicator-charts)

全指标多面板图在 `ts/app/components/IndicatorChart.tsx`(DataScreen 内嵌)。
约定:

- **web-only + 动态 import**:lightweight-charts 只走 `import('lightweight-charts')`
  运行时加载(保持独立 chunk,不拉进 RN 原生 bundle);类型注释放顶层
  `import type`。**坑**:`LineStyle` 是运行时枚举(值),须从动态 import 解构
  取值(`LineStyle: LineStyleValue`),不能只 import type。
- **多 pane 布局**:`addSeries(def, opts, paneIndex)` 建面板,全部 series 建完后
  `chart.panes()[i].setStretchFactor(n)` 设比例。**禁止用 `setHeight`**:Pane
  初始 `height=0`,首帧布局前 setHeight 以 totalHeight=0 参与
  `_internal_changePanesHeight` 重分配 → 面板高度错乱;stretch 是比例布局,
  与当前高度/调用顺序无关。
- **数据同源**:图表消费 `computeAll` 结果行(与「最新指标」chips 同一份),
  不新算第二遍;窗口切片与 K 线一致。DataScreen 用 `useMemo([ticker,
  dataVersion])` 缓存 bars 与指标行,避免流式重渲染时重建图表
  (`store.getDatas` 每次返回新数组)。
- **NaN 处理**:指标 warmup 前导 NaN → 线/柱数据过滤 null(warmup 只出现在
  序列头部,无中间断档);柱系列用 `base: 0` + 正负着色。
- **图例与颜色单点定义**:系列色常量 `C` 与 `LEGEND` 数组同源,图例 chips
  与图上线条不漂移;柱(成交量/MACD/MACD_VH)用 `theme.colors.up/down` 半透明。

