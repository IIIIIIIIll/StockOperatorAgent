# 重试/回滚日志可见性——onReset warn + warn 补状态码

## 目标与用户价值

UI 显示「重试中」时,日志必须能回答「到底发生了什么」。现状:LLM 真重试
(onRetry)有 warn,但工具轮回滚(onReset)只发 UI 状态事件、**无日志**——
用户在 8081 实测看到投资经理 3 次「重试中」,日志里只有 INFO 状态行,无原因
(2026-08-12 23:23-23:24,ts/logs/soa-ts.log)。另外真重试 warn 只记类名不记
status 数字码。修复后:每次「重试中」都有对称的可读日志,含原因与状态码。

## 现状盘点(证据)

- `ts/src/toolLoop.ts` `invokeWithTools`:轮末 `tool_calls` 非空 → `onReset?.()`
  (agents.ts 转 `pushStatus(node,'retry')`)——**无任何日志**;工具名在
  `call.name` 可得,轮次在循环变量。
- `ts/src/retry.ts` `streamWithRetry` / `invokeWithRetry` warn:
  `LLM stream attempt N failed with <errType>; retrying in Xs`——errType 是
  `err.constructor.name`(如 InternalServerError),**未记 `err.status` 数字码**;
  错误对象有 `status` 字段(OpenAI SDK APIError)。
- 日志通道:`ts/src/log.ts` 统一出口(warn 落 console + 上报 /logs →
  logs/soa-ts.log)。

## 需求

- **R1** `toolLoop.ts` onReset 路径打 `warn`(对齐 retry warn 风格):
  「工具轮 N:模型请求工具 <name>,回滚该轮中间文本」——发生在 onReset 触发
  时(工具名取该轮 tool_calls[0].name 或全部名字)。日志通道用 `log.ts`
  `warn`(与 retry.ts 一致)。
- **R2** `retry.ts` 两处 warn 补 status 数字码:`err.status` 存在 → 追加
  `(HTTP <status>)`;不存在 → 维持现状(类名)。invokeWithRetry 与
  streamWithRetry 同步改,文案一致。
- **R3** 不回归:UI 行为零变化(「重试中」文案与事件协议不动——用户已拍板
  保持现状);vitest 全绿;既有 warn 格式兼容(日志消费无依赖)。

## 明确不做(Out of Scope)

- UI「重试中」文案拆分(onReset 显示「搜索中」)——用户明确保持现状。
- 事件协议改动(roleStatus 语义、字段)。
- Python 侧。

## Acceptance Criteria

- [ ] **AC1** 工具轮发生时(离线 stub LLM 首轮返回 tool_calls)日志出现
      WARN 含「工具轮」与工具名与轮次;且该轮中间文本照常回滚(既有 onReset
      行为不回归)。
- [ ] **AC2** 可恢复错误(注入 status=429)重试 warn 含 `(HTTP 429)`;无
      status 字段的错误维持类名格式;streamWithRetry 与 invokeWithRetry
      两路径一致。
- [ ] **AC3** vitest 全绿(ts/test,新增 onReset warn 与 warn 状态码断言);
      tsc clean;Python 全量 pytest 零新增失败。

## Open Questions

(无阻塞项。)
