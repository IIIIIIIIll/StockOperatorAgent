---
description: Error handling conventions — PipelineEvent error protocol, LLM retry, tool failure contract, store/bridge shapes
paths:
  - src/events.ts
  - src/retry.ts
  - src/toolLoop.ts
  - src/pipeline.ts
  - src/mcp.ts
  - src/billionsTools.ts
  - src/webSearch.ts
  - src/store.ts
  - src/store-idb.ts
  - src/store-file.ts
  - app/lib/desktopBridge.ts
---

# Error Handling

TS-only. The Python boolean-protocol / single-raise-site era is gone. Core
theme: **degrade, don't raise** — placeholder text or structured events keep the
graph running; the few raises sit at hard boundaries (init contracts, retry
exhaustion).

## PipelineEvent error protocol (`src/events.ts`)

`createPipelineRunner(store)` wraps the whole pipeline and emits structured
events; `error` is one event type, not an exception across the boundary:

```ts
| { type: 'progress'; message: string }
| { type: 'report'; key; tabTitle; content }
| { type: 'token'; roleKey; node; delta }
| { type: 'roleStatus'; roleKey; node; status }
| { type: 'done'; report: FinalReport }
| { type: 'error'; error: string }        // terminal: pipeline failed
```

- UI subscribes to events; `type: 'error'` -> error view. The runner never
  throws past the event boundary (top-level try/catch in `run()`).
- `describeError(err)` extracts the real cause from LangGraph aggregate errors
  (a superstep with all parallel nodes failed carries `errors[]`).

## LLM retry (`src/retry.ts`)

- `invokeWithRetry(llm, payload, config?, opts?)` and its streaming twin
  `streamWithRetry(...)` share one policy:
  - Retryable: 429 / 500 / 502 / 503 / 504 / connection / timeout -> exponential
    backoff x3 (1s base, cap 8s).
  - Business errors (400, auth) throw immediately, zero delay. Exhaustion
    re-raises the original exception.
  - Before each backoff: `warn(attempt, errType, nextDelay)` — identical wording
    on the invoke and stream paths.
- `streamWithRetry` iterates `llm.stream()`, aggregates chunks with `concat`
  (`@langchain/core/utils/stream`), streams deltas via `onDelta`; `onRetry`
  fires after warn, before sleep; returns `{content, tool_calls}`.
- Agent nodes must not catch-and-swallow LLM failures — the retry policy is
  centralized here; exhaustion bubbles to the pipeline boundary (`error` event).

## LLM tool failure contract (placeholder text, never raise)

Tools return placeholder text on failure so the model keeps generating and the
graph never breaks:

- `src/toolLoop.ts` `invokeWithTools`: <=15 tool rounds; rounds exhausted ->
  final-round instruction (no more tool calls); unknown tool -> placeholder;
  **tool exception -> placeholder, graph continues**; empty tools -> single
  direct call. `safeProgress` guards progress-updater throws (no-op).
- `src/mcp.ts` `queryMarketIntel`: disabled / no key / failure -> fixed Chinese
  placeholder (`（通达信 MCP 查询失败：...）` / `（通达信 MCP 查询异常，跳过${ticker}的实时情报）`),
  never raise.
- `src/billionsTools.ts`: `cappedCall` try/catch -> `warn` + placeholder text;
  call-cap exceeded -> placeholder (search 3 / twitter 2 / fetch 3, default in
  `BILLIONS_DEFAULT_MAX`); summarizers return `（亿信...失败：无返回结果）`
  placeholders; url scheme check -> `（亿信全文抓取失败：url 仅支持 http(s) 协议）`.
- `src/webSearch.ts` / `src/agents.ts` 预抓: DDG failure/empty ->
  `（联网搜索失败：...）` / `【...无返回结果】`; `_prefetch` degrades per-source,
  graph continues.
- `src/billionsClient.ts`: `BillionsApiError(code, status_code, message)` is a
  custom error class; raised inside the client only (network / non-2xx /
  200+success:false normalization), caught by the tool consumers above — never
  re-raised into the agent flow. No retry on 429 (quota; retry is pointless).
- 数据源家族同理（每源一个自定义异常，同 BillionsApiError 先例）：`src/yahoo/
  yahooClient.ts` `YahooApiError(code, status_code, message)`（chart 失败上抛
  中止采集；quoteSummary/crumb 失败由消费方降级不中止——见 ts/hk-us-data.md
  错误矩阵）；`src/finnhub/finnhubClient.ts` `FinnhubApiError`（无 key → null
  零网络；失败由消费方 warn 忽略）。
- `src/pipeline.ts`: pure functions degrade to placeholder text —
  `fallbackMarketIntel()` returns `（未配置 TDX_API_KEY，跳过实时市场情报）`; missing
  F10 -> `（无 ${ticker} 的盈利能力指标，跳过）`.
- `src/pipeline.ts` `safe(updater, msg)`（图前 enrichment 的进度上报）与
  `safeProgress`/`safePushDelta`/`safePushStatus` 家族（`src/progress.ts`）同一
  契约：updater 缺失或抛错一律吞掉——丢一条进度行只是 UI 流水缺失，绝不阻断图。

## Store / bridge error shapes

- `src/store.ts` `StoreLike`: missing keys -> `null` / `[]` / `getMeta -> null`,
  never throws for "expected absence". Synchronous mutators, no async errors.
- `src/store-idb.ts`: IndexedDB open/request/transaction failures reject with
  `Error` (wrapped). The **write-through queue catches and logs** (`IdbStore
  落盘失败:...`) — a persistence failure is recorded, never blocks subsequent
  writes or the business flow.
- `app/lib/desktopBridge.ts`: DesktopStore mutators apply to the local mirror
  first, then enqueue `store-op` over IPC; bridge failure ->
  `console.error(\`DesktopStore ${op} 写穿失败:...\`)`, mirror stays
  authoritative. Settings async save failure -> `console.error`, no throw.
  `bridgeStorage()` throws only when `window.__soaDesktop` is absent (init
  contract).

## Rules of Thumb

- Expected absence / degradable failure -> placeholder text (tools) or
  null/empty (stores) + a log line identifying the ticker/op. Log first,
  degrade second.
- Boundary raises are rare and explicit: missing `TDX_API_KEY` at
  `TdxMcpClient` construction, missing `__soaDesktop` at bridge init, LLM
  exhaustion after retry.
- Never log keys or secret values (settings masks; report content == console
  content).
- Use `describeError` when surfacing LangGraph aggregate failures to the UI.

## Anti-Patterns

- Raising from tools — the agent loop is the last line of defense (placeholder);
  a raise aborts the whole graph run.
- Swallowing errors silently — always `warn`/`error` before degrading.
- `assert` for flow control — asserts exist only in tests.
- Catching LLM errors inside agent nodes and "handling" them locally — retry
  policy is centralized in `src/retry.ts`.
- `try/catch` around every store call in business code — stores return
  null/empty by contract; persistence failures are handled by the queue.
