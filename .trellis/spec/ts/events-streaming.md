---
description: 事件协议/流式输出/LLM 重试/同源代理(src/events|progress|retry|pipeline + app/lib/proxies|logs-server)
paths:
  - src/events.ts
  - src/progress.ts
  - src/retry.ts
  - src/pipeline.ts
  - app/lib/proxies.cjs
  - app/lib/logs-server.cjs
---

# 事件协议、流式输出与同源代理

## 事件流协议(src/events.ts)

`PipelineEvent` 联合类型是 App 与业务层唯一事件契约:

```ts
| { type: 'progress'; message: string }
| { type: 'report'; key; tabTitle; content }    // 节点报告——最终内容权威来源
| { type: 'token'; roleKey; node; delta }       // 流式文本增量
| { type: 'roleStatus'; roleKey; node; status } // running|done|retry
| { type: 'done'; report: FinalReport }
| { type: 'error'; error: string }
```

- **node → roleKey 映射**:`enabledRoles().find(r => r.nodeName === node ||
  r.reviseNodeName === node)`;查不到原样用 node。
- **权威覆盖规则**:UI 收到 `report` 即清空该 role 全部 node 的流式 partial——
  流式文本只是过程视图,报告内容永远以 `report` 事件为准。实现必须用事件时刻
  的 `enabledRoles()` 而非挂载闭包(设置面板中途开关角色时闭包陈旧)。

## ProgressUpdater 协议(src/progress.ts)

```ts
export interface ProgressUpdater {
  info(msg: string): void;
  pushReport(key: string, content: string): void;
  pushDelta?(node: string, delta: string): void;   // 可选:流式增量
  pushStatus?(node: string, RoleStatus): void;     // 可选:生命周期
}
```

**扩展接口一律加可选方法**(向后兼容:committee 传 null、pipeline 用 info、
测试 fake 零改动)。调用经 `safePushDelta`/`safePushStatus` 守卫(缺失/抛错 →
no-op,图不中断,对齐 `safeProgress`)。

## 流式输出(08-11-ts-streaming-output)

### 设计决策:方案 B(agent 级流式)而非 LangGraph `streamMode:'messages'`

- **为什么**:graph messages 模式需在 events.ts 做 chunk 级
  `tool_call_chunks`/ToolMessage 状态机区分工具轮文本、依赖图回调注入、
  演示 stub 无 chat-model 事件;版本升级即碎。agent 级流式每个控制点
  (角色/轮次/重试)在源头显式、可单测。
- **要点**:`prompt.pipe(llm)` 是 RunnableSequence,`.stream()` 转发末步 chunk;
  无 `.stream()` 的 llm(假件)回退 `invokeWithRetry` + 单次全量 delta。

### streamWithRetry(src/retry.ts)

`invokeWithRetry` 的流式孪生,语义必须对齐:

- 迭代 `llm.stream()`;聚合用 `concat`(`@langchain/core/utils/stream`,正确处理
  content 数组/tool_call_chunks);文本增量实时 `onDelta`(空/工具轮 chunk 跳过)。
- 失败(含流中途断):`isRetryable` 判定 + 指数退避(1s×2 上限 8s ≤3 次),
  退避前 `warn`(attempt/errType/delay,照 `invokeWithRetry` 模式),`onRetry`
  在 warn 后、sleep 前回调;耗尽 reraise。
- 非对象聚合(纯字符串 chunk 假件)不丢文本:原样作 content 返回。

### 工具轮与重试的复位通道

- 工具角色(交易员/经理)每轮流式;轮末 `tool_calls` 非空 → `onReset()` 回滚
  该轮已流出文本;LLM 重试 → `onRetry`。**二者共用 `pushStatus(node,'retry')`
  单通道**,UI 收到 'retry' 即清该 node partial(避免额外 reset 事件类型)。
- 时序:agent `running`(首调前)→ 流式 → `pushReport` → `done`。
- 工具循环本体(`invokeWithTools`,MAX_TOOL_ROUNDS=15)见
  [agents-tools.md](./agents-tools.md)。

## 同源代理(app/lib/proxies.cjs + logs-server.cjs)

dev(metro 中间件)与生产(server.mjs)共用**单份**实现(收敛防漂移)。路由:
`/llm-proxy`(LLM 转发)、`/tdx-collect`(采集)、`/web-search`(搜索)、
`/logs`(日志汇聚,lib/logs-server.cjs)。

**SSE 透传**(流式必需):`handleLlmProxy` 必须 pipe `upstream.body` 分块转发,
**禁止 `await upstream.text()` 整体缓冲**(否则浏览器一次性收到 SSE,无实时性)。
流式透传后 `writeHead` 之后抛错(上游断流/客户端断开)不可再 writeHead——
必须 `if (res.headersSent) { res.destroy(); return; }` 兜底,否则客户端永久
挂起;未 writeHead 的错误路径保持 502 JSON。

### 代理安全契约(08-13-ts-capability-completion,C1/C2/W2-W4 教训)

- **SSRF 防线(C2)**:`X-LLM-Base` 头/body.base 是浏览器端用户配置(多提供商
  透传是**设计意图**,见 llm.ts createLlm 注释)——不丢弃机制,转发前校验:
  ① scheme 仅 http(s);② 拒绝 userinfo;③ host 经 DNS 解析后任一地址落入
  私网/环回/链路本地/保留段(127.x 10.x 172.16-31.x 192.168.x 169.254.x
  0.0.0.0 ::1 fe80::/10 fc00::/7 及 ::ffff: 映射)→ 拒发;解析失败保守拒绝。
  **IPv4-mapped IPv6 判定教训(08-27 终审)**:`::ffff:` 后内嵌 IPv4 有
  点分(`::ffff:127.0.0.1`)与十六进制(`::ffff:7f00:1`)两种拼写,按前缀
  比较的 IPv6 分支必须提取内嵌 32 位(任一拼写)重放 IPv4 黑名单,否则
  hex 形 `::ffff:7f00:1` 被误判公网,经内核 v4-mapped 路由打到环回。
  校验失败回 400(格式非法)/403(策略拒绝)。
- **请求体上限(W2)**:/llm-proxy body 累计 >1MB → 413 终止读取(终审上下文
  6 报告+修订+搜索 >64KB,64KB→1MB 为 08-16 实证修正);/logs 对齐
  logs-server MAX_BODY_BYTES 64KB。
- **日志净化(W3)**:/logs 的 message/platform 落盘前 `replace(/[\r\n]+/g,' ')`
  净化(防伪造日志行/终端注入)。
- **采集互斥(W4)**:/tdx-collect 45s 超时仅提前回 504,**锁保持到 doCollect
  真正 settle 才释放**(Abort 取消不了 node-tdx-market TCP——TdxClient 无
  AbortSignal 支持),timer 在 finally clearTimeout。
- **监听地址**:server.mjs `server.listen(PORT, process.env.HOST || '127.0.0.1')`
  ——默认回环,生产远程访问需显式 HOST=0.0.0.0。
- **静态服务兜底(C1)**:serveStatic 的 decodeURIComponent 包 try/catch,
  畸形百分号编码 → 400 不崩进程。
- **/web-search q 校验**:禁控制字符(分析师查询模板 `{} 最新新闻` 含空格,
  旧"禁空白"校验致 DDG 回退恒 400——08-16 实证修正,web/桌面同路径)。
