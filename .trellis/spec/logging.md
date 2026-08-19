---
description: Logging conventions — unified src/log.ts API, web /logs transport, RN file transport, levels
paths:
  - src/log.ts
  - app/lib/logs-server.cjs
---

# Logging

## Unified API (`src/log.ts`)

One logging module for all runtimes (web / RN / Node / vitest). Do not add a
second log surface (`app/lib/log.ts` re-export shim was deleted; architecture
test contract 7 bans its return).

```ts
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type Platform = 'web' | 'rn' | 'node';
log(level: LogLevel, message: string): void;
info / warn / error / debug(message: string): void;   // level-bound helpers
```

- **Message style (TS successor of the Python `{}`-placeholder rule)**: `message`
  is a single pre-formatted string — build it at the call site with a template
  literal (backticks), never string concatenation, never format args (the API
  has no bound args):
  `warn(\`TDX host ${host} 采集失败:${String((err as Error)?.message ?? err)}——尝试下一个\`)`
  (`src/tdx/deviceCollect.ts`). Identifiers/tickers/log subjects go inline.
- **Platform detection**: `detectPlatform()` = `isWebEnv()` (`window`+`document`
  present) -> `isRnEnv()` (`navigator.product === 'ReactNative'`) -> `node`
  fallback (`process.versions.node`). Probes only — no platform module imports.
- **Transports** (selected by platform):
  - console: `[soa <level>] <message>` verbatim; error -> console.error,
    warn -> console.warn, debug -> console.debug only when `__SOA_DEBUG === '1'`,
    else console.log.
  - web: fire-and-forget `POST <origin>/logs` (same-origin), `keepalive: true`;
    failure -> silent catch, business continues.
  - RN: sandbox file via expo-file-system — `Paths.document/soa-logs.log`
    (`RN_LOG_FILE`), >=5MB -> rename `soa-logs.log.1`; plus POST to
    `EXPO_PUBLIC_LOG_ENDPOINT` when set (empty/absent -> no report).
  - Node: console only — the server's own fs writes (`logs-server.cjs`) own
    persistence.
- **Factories (injection points — house style, no mock framework)**:
  `makeReporter(_fetch?, _endpoint?)` and `makeRnFileTransport(_fs, _writeDisabled?)`.
  `fileWriteDisabled()`: `NODE_ENV === 'test'` or `SOA_LOG_FILE === '0'` -> no
  file writes (vitest must not pollute `logs/`).
- **Dynamic import**: `expo-file-system` is imported only inside the RN branch
  via `await import('expo-file-system')` (static specifier — Metro requirement;
  module-level lazy init once; failure -> silent console fallback). Never
  static-import it or other platform modules at top level — web/Node builds
  would drag in RN code.

## Line Format (single source of truth)

`formatLogLine(d, level, message, platform)` — shared with the server endpoint
(comments cross-reference both sides):

```
<ts> | <LEVEL> | [soa] <message> (platform:<platform>)
```

`<ts>` = local time `YYYY-MM-DD HH:mm:ss` (`formatLogLine` on the client,
`formatTs` on the server — identical shape).

## Web Transport (`app/lib/logs-server.cjs`)

`POST /logs` with `{ts?, level, message, platform}` -> `200 {ok:true}`. One
shared CJS file wired into both the metro dev middleware and `app/server.mjs`
(CJS: both can load it; behavior must not drift).

- Validation matrix: level not in `info|warn|error|debug` -> 400; message
  non-string -> 400; platform empty -> 400; body > `MAX_BODY_BYTES` (64KB) ->
  413; non-JSON -> 400; disk write failure -> 500 `{error}` (server stays up).
- `sanitizeLine()`: `\r`/`\n` -> space before append (log-injection guard);
  message truncated to 4KB.
- File: `setLogDir()` injected (desktop uses `userData/logs`) -> `SOA_LOG_DIR`
  -> default `<repo>/logs/soa-ts.log`; >=5MB -> rename `.1` (same rotation
  semantics as the RN sandbox).

## Levels

- `debug` — detailed flow: per-host failover attempts, tool-round rollback
  notices, cache skips. Console-gated behind `__SOA_DEBUG=1`; still reported
  and recorded.
- `info` — meaningful transitions: analysis start, collection skips
  (`跳过采集:...`).
- `warn` — recoverable degradation: LLM retry backoff (`src/retry.ts`), TDX
  host failover, tool-call failures, write-through persistence failures.
- `error` — failures surfaced to the user or blocking.

## Anti-Patterns

- Static `import 'expo-file-system'` / `react-native` / `node:fs` into
  `src/log.ts` — breaks other platforms' bundles (metro/vitest).
- Logging secrets or full API keys — settings masks keys; report content equals
  console content (both go over the wire / to disk).
- A second logging entry point anywhere (web/RN/Node) — all calls go through
  `src/log.ts`.
- Letting client-side report/file failures interrupt business flow — always
  catch -> console fallback (degradation style, see error-handling.md).
