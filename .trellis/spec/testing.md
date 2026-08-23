---
description: Test conventions — vitest runner, typecheck, invariant/unit patterns, fixtures, isolation
paths:
  - test/**
  - package.json
---

# Testing (`test/`)

## Runner

- Run everything: `npm test` (= `vitest run`, root `package.json`).
- 单测超时:`vitest.config.ts` `testTimeout: 15s`(默认 5s 对 mock-LLM 编排
  套件余量不足,高负载下批量假超时;上调不改变断言语义)。
- Type check: `npm run typecheck` (= `tsc --noEmit`).
- Targeted run: `npx vitest run test/log.test.ts`.
- Live network integration is opt-in: `SOA_LIVE=1 npx vitest run
  test/live.integration.test.ts` — the suite is `describe.skipIf(!LIVE)` and
  never runs by default. No pytest, no pytest.ini, no Python test files.

## Layout

- Flat `test/*.test.ts` mirroring `src/` (`store-idb.test.ts` tests
  `src/store-idb.ts`, `retry.test.ts` tests `src/retry.ts`). Tests run in the
  Node runtime (`test/` may use `node:fs` — e.g. `architecture.test.ts`).
- Shared data lives in `test/fixtures/` (prompts.json, f10_tdx.txt,
  f10_hk.txt, 600036_daily.json, 600036_indicators.json) — 9+ test files
  consume them; don't re-derive fixture data inline.

## House Style (no mock framework)

- **Injection points instead of mocks**: production modules accept optional
  `_fetch`/`_fs`/`_searcher`/`_endpoint`/`_collect` args; tests pass fakes.
  Examples: `makeReporter(_fetch, _endpoint)` / `makeRnFileTransport(_fs,
  _writeDisabled)` (`log.test.ts`), proxies `handleLlmProxy(req, res, _fetch)`
  (`proxies.test.ts`), `new IdbStore(factory, dbName)` with `fake-indexeddb`.
- **fake-indexeddb** (`store-idb.test.ts`): `import 'fake-indexeddb/auto'`
  installs `globalThis.indexedDB`; each test case builds a fresh factory (no
  cross-test DB bleed); same factory + same db name = shared persistence, used
  to assert hydrate across instances.
- **Fake bridge objects** (`desktopBridge.test.ts`): a `FakeBridge` class
  simulating `window.__soaDesktop`; `vi.unstubAllGlobals()` in `afterEach`;
  `until(cond, what)` polling helper for queue-async assertions (no timer
  races).
- **Static invariant tests** (`architecture.test.ts`): read source with
  `node:fs` and assert text-level contracts (no `node:` imports in `src/`
  except `store-node.ts`; no `react-native` imports; `better-sqlite3` type-only
  outside `src/store.ts`/probes; no DOM-name `declare global`; meta-key
  literals banned outside `src/metaKeys.ts` + `app/data/demo.json`; `process.env`
  reads only via `src/env.ts` + EXPO_PUBLIC direct access, writes banned; no
  `app/lib/log` relative-import regression). New `src/` modules that violate a
  whitelist fail the suite.
- **Vitest API**: `describe`/`it`/`expect`, `vi` (stubs, `unstubAllGlobals`),
  `describe.skipIf` for live suites. Assertions are behavioral (semantics,
  payload shapes, byte-exact line formats), not incidental implementation text.

## Test Isolation Rules

- `NODE_ENV === 'test'` disables log file writes (`src/log.ts`
  `fileWriteDisabled()`; `SOA_LOG_FILE=0` does the same) — tests never pollute
  `logs/`. Assert console output with a `captureConsole()` helper instead
  (`log.test.ts`).
- Each test file sets up its own env/globals and restores them:
  `setGlobal`/`restore` via `Object.defineProperty` (log.test.ts; `navigator`
  is getter-only in Node), `withEnv(pairs, fn)`, `vi.unstubAllGlobals()` in
  `afterEach` (desktopBridge.test.ts). `NODE_ENV=test` runs keep the filesystem
  and module registry clean between files.
- Store tests use per-case factories / in-memory DBs (`:memory:` default for
  `src/store.ts`); never share a persistent DB file across tests.
- Server-side endpoints (`server.mjs` serveStatic, `proxies.cjs`,
  `logs-server.cjs`) are tested by importing the module and driving fake
  `req`/`res` objects — no live port; `isMain` guard keeps `listen` out of
  imports.
- Live/network tests must stay behind `describe.skipIf(!LIVE)` — the default
  run is fully offline (CI has no TDX/LLM reachability).

## What to Test

- New behavior/contracts in `src/` — module-level unit tests (pure functions:
  `format.ts`, `indicators.ts`, `gates.ts`, `overview.ts`, `f10.ts`).
- Store semantics: dedupe, replace-empty early-exit, new-array return,
  meta round-trip, cross-instance hydrate, write-through queue failure
  non-blocking (`store-idb.test.ts`, `store-gates.test.ts`).
- Error paths: retry backoff + warn wording (`retry.test.ts`), tool failure ->
  placeholder text, proxy SSRF/body-cap/mutex (`proxies.test.ts`), log server
  validation matrix (`log-server.test.ts`), env-switch matrix
  (`switches.test.ts`).

## Anti-Patterns

- Mock frameworks / jest-style `jest.mock` — use injection points and fakes.
- Tests that write `logs/`, the store DB, or other repo state — isolation
  rules above.
- `it.only` / `it.skip` committed without reason — gate live suites with
  `describe.skipIf` and an env flag instead.
- Test-only branches in production code — prefer injection points.
- Asserting implementation text of unrelated modules — keep `architecture.test.ts`
  the single static-scan exception.
