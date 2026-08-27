# Design: Go-live Fix — Majors (Bucket A)

Per-item design. Fix methods are authoritative from parent `research/fix-backlog.md`;
this doc adds contract detail, edge cases, and test points.

## F01 — start() re-entry guard (analysisController.ts)

- **Change**: first line of `start()`: `if (s.running) return;` (or set
  synchronously before first await to close the async re-entry window).
- **Contracts preserved**: second invocation while running must NOT wipe
  events/decision/error/statuses/hasDone (:286-297), must not re-run
  switches/keepAlive/collect/fetchIntel before the events.ts C2 guard.
- **Test point**: call start twice in sequence; assert second call is a no-op
  (state intact, no duplicate collect).
- **Note**: mediums will edit the same file (F17/F20/#96) — keep hunks disjoint.

## F02 — chunk decode (proxies.cjs ×2, logs-server.cjs ×1)

- **Change**: `parts.push(chunk)` (Buffer[]), then `Buffer.concat(parts)` +
  single `.toString()` before JSON.parse. NOT `setEncoding('utf8')` — that
  shifts MAX_MESSAGE_BYTES accounting from bytes to chars (F34 class).
- **Edge**: empty body → concat of [] = empty Buffer → parse path unchanged
  (proxies currently 200+bad-JSON → F13 handles the crash class).
- **Test point**: CJK multi-byte prompt spanning chunk boundaries round-trips
  (simulate two-part stream).

## F03 — log rotation overwrite (src/log.ts)

- **Change**: `moveSync(src, dest, {overwrite: true})`; widen dest type at :116
  if needed; adjust test/log.test.ts:118 fake to accept options arg.
- **Edge**: first rotation (no existing .1) and N-th rotation (existing .N)
  both succeed; rotation failure must not kill the logger (try/catch exists —
  verify).
- **Test point**: rotate twice; .1/.2 files exist; log still appends.

## F04+M1 — memoized-ready rejection (4 sites)

- **Change**: in `ready()` / `db()` getters: `promise ??= create()` →
  `try { promise = create(); return await promise } catch (e) { promise = undefined; throw e }`
  (precedent store-file.ts:110-113). Sites: store-idb.ts:142,152;
  store-file.ts:42,93; desktopBridge.ts:73-75 (M1, write-through path).
- **Contract**: a rejected open may be retried (e.g. after IndexedDB
  blocked/upgrade error); a successful memo persists.
- **Test point**: force first open to reject, second open succeeds, ops flow.

## F05 — DataScreen memoization

- **Change**: wrap reports + profit derivations in `useMemo(…, [ticker, dataVersion])`
  (:30-33, :43-45). Add `dataVersion` to turnover-capital memo deps too (that's
  F18 — do NOT fix here; leave for mediums, note in commit).
- **Contract**: chart data identity stable across unrelated re-renders
  (FinancialTrendChart no full rebuild).
- **Test point**: render twice with same props → memo identity equal.

## F06 — annual/quarterly pool separation

- **Change**: in deviceYahooCollect.ts:287-294 annual statements are merged
  unconditionally; composeYahooReports.ts:142-163 computes rates across the
  merged pool. Make rates origin-aware: carry statement origin (annual vs
  quarterly) through the pool; YoY/QoQ for annual rows → NaN (or skip), never
  compare annual vs quarterly rows.
- **Contract**: quarterly-vs-quarterly rates unchanged; persisted report rows
  no longer mix bases; existing tests keep passing (fixtures quarterly-only —
  add an annual-row fixture test).
- **Test point**: fixture with mixed annual+quarterly → annual rows have
  NaN/absent rates, quarterly rows unaffected.

## F07/F08 — desktop child lifecycle (child.mjs, main.mjs)

- **F07**: move `ipcMain` listener registration to top-level (before the awaits
  at :123/:138) so early messages aren't lost; null-guard `close()` when
  main window already gone (:92-93).
- **F08**: message handler first line `if (shuttingDown) return;` — ops during
  gracefulShutdown must not be applied-then-dropped (main.mjs:339-341 promise).
  Note: main.mjs:339-341 is shutdown-wiring *evidence*, not a fix site — G8
  edits main.mjs only if a guard turns out to be required there.
- **Test point**: desktop smoke — start child, kill main, no unhandled
  rejection; op after shutdown → ignored, no write.

## F13 — webCollect payload validation

- **Change**: after `resp.ok` JSON parse (webCollect.ts:94-98): validate body
  is a plain object and `Array.isArray(body.bars)`; on violation return typed
  error (`new TypeError`-free, structured `CollectError` per error-handling
  spec), never null-payload crash at :31/:51.
- **Test point**: 200 + `{"bars":"oops"}` → typed error, caller survives.

## F21 — test isolation (3 suites)

- **Change**: query-content.test.ts:71-77, events.test.ts, runner.test.ts:
  set `WEB_SEARCH_DISABLED='1'` and `delete process.env.BILLIONS_API_KEY` in
  beforeEach (pattern agents.test.ts:36-61); events/runner have NO beforeEach
  today — add one. Flake window: FETCH_TIMEOUT_MS=20s vs testTimeout 15s —
  tests must not touch network at all.
- **Test point**: suites pass with network blocked; grep suite for fetch/XMLHttpRequest
  side effects.

## S4 — keystore rotation (process)

- Artifact `research/rotation-checklist.md`: steps to rotate Android keystore +
  passwords, propagate to .env + GitHub Actions secrets, move to keychain;
  verification (assembleDebug signed build) and rollback (restore old
  keystore). No code changes.

## Test/commit conventions

- New tests: deterministic, offline, match repo conventions (`.trellis/spec/testing.md`);
  run targeted file first (`npx vitest run <file>`), full suite at end.
- One commit per item/pass, message `fix(scope): 简述,修 F0x` (repo style).
