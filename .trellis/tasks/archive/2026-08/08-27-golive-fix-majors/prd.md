# PRD: Go-live Fix — Majors (Bucket A, 11 项)

## Goal

Fix all **11 must-fix-before-go-live** items from the audit backlog. Runs FIRST
of the three fix children. Evidence + fix method for every item:
`research/fix-backlog.md` in the parent task
(`08-27-golive-fix-backlog/research/fix-backlog.md`) — authoritative; this PRD
enumerates scope and acceptance only.

## Ordering / wait conditions

- Runs first; **mediums child waits for this task's commit + check**.
- Files this task touches that later children also touch (must keep hunks
  disjoint — sequential, no conflict):
  analysisController.ts (mediums: F17/F20/#96), proxies.cjs + logs-server.cjs
  (mediums: F30/S3/M2/F34), store-*.ts + desktopBridge.ts (mediums: F10/F11/
  F12/H1/F37), deviceYahooCollect.ts (mediums: F35), DataScreen.tsx (mediums:
  F18), desktop/main.mjs (mediums: F09/H1 — only if G8 needs a guard there),
  test/events.test.ts (mediums: F22).

## Scope (11 items, exhaustive)

| ID | Sev | Files | Fix (from fix-backlog.md) |
|----|-----|-------|---------------------------|
| F01 | major | app/lib/analysisController.ts:285-296 (reachable via `window.__soa.start`, App.tsx:92) | `if (s.running) return` at start() entry |
| F02 | major | app/lib/proxies.cjs:103,286; app/lib/logs-server.cjs:70 | collect `parts.push(chunk)` + `Buffer.concat`, decode once at all 3 sites (NOT setEncoding — keeps byte-based 1MB cap) |
| F03 | major | src/log.ts:137 (+type widen :116; test/log.test.ts:118 fake) | `moveSync(…, {overwrite:true})` |
| F04+M1 | major | src/store-idb.ts:142,152; src/store-file.ts:42,93; app/lib/desktopBridge.ts:73-75 | clear memoized ready/db promise on rejection — 4 sites, pattern precedent store-file.ts:110-113 |
| F05 | major | app/screens/DataScreen.tsx:30,33,45 | `useMemo([ticker, dataVersion])` for reports + profit (chart assets NOT touched — chart gate N/A) |
| F06 | major | src/yahoo/deviceYahooCollect.ts:287-294; src/yahoo/composeYahooReports.ts:142-163 | origin-aware rates: annual rows → NaN YoY/QoQ; add annual-row fixture test (current fixtures quarterly-only) |
| F07 | medium | desktop/child.mjs:145,188-193 (awaits :123,138; null-guards :92-93) | register IPC listeners top-level; null-guard close() |
| F08 | medium | desktop/child.mjs:83-95,145 (main.mjs:339-341 promise) | `if (shuttingDown) return` in message handler |
| F13 | major | src/webCollect.ts:94-98 (first crash payload.ticker :31, bars :51) | validate body is object + `Array.isArray(bars)`; return typed error |
| F21 | medium | test/query-content.test.ts:71-77; test/events.test.ts; test/runner.test.ts (no env isolation) | `WEB_SEARCH_DISABLED='1'` + delete BILLIONS_API_KEY (pattern: agents.test.ts:36-61) |
| S4 | medium·sec | root .env:1-17 (gitignored) + GitHub Actions signing secrets | **process**: rotation checklist artifact — rotate keystore+passwords on release machine, propagate to .env + GH secrets, move to keychain; NO code |

## Acceptance criteria

1. Per item: fix applied per fix-backlog method; observable contract change
   covered by a deterministic offline test where applicable (F01 re-entry,
   F02 two-chunk CJK round-trip in proxies.test.ts, F03 rotation, F06 annual
   rates, F13 typed error, F21 no network).
2. Gates on final tree: `npx vitest run` ≥627 pass / 0 fail (existing suites
   stay green, incl. architecture.test.ts), `npx tsc --noEmit` 0 errors,
   `git status --porcelain` clean. Chart gate only if F05 changes chart
   assets (it should not).
3. Spec pre-checks: log via src/log.ts, meta keys via src/metaKeys.ts, env via
   src/env.ts; no new console.* in shipped code (F37 pattern).
4. S4: rotation checklist artifact committed at
   `.trellis/tasks/08-27-golive-fix-backlog/research/rotation-checklist.md`
   (parent research/, beside fix-backlog.md).
5. Commit per item/pass with finding ID in message (`fix(scope): …,修 F0x`).

## Non-goals

- Items outside Bucket A (even in the same files — list them in commit notes).
- Re-researching fix methods (fix-backlog.md is authoritative; re-verify only
  if evidence contradicts the tree).
