# Design: Go-live Fix Backlog — Task Tree

## Tree rationale

The audit's master record (`research/fix-backlog.md`) already groups items by
severity (buckets A/B/C) and by shared-root-cause execution passes (G1–G12).
We chose **bucket children, not G-pass children**:

- Priority semantics stay visible in the tree (P0 majors / P1 mediums / P2 nits),
  matching the go-live ordering the user approved.
- G-passes remain the *internal* execution order inside each child's
  implement.md (G-passes span buckets; splitting by them would blur priority).
- 3 children keeps start/review/archive overhead low.

## Shared-file conflict matrix (why strict ordering)

Same-file edits across children would conflict if run in parallel; ordering
resolves this (each bucket edits the file after the previous bucket finished).
Rows verified against fix-backlog.md Evidence columns (2026-08-27 review).

| File | Bucket A | Bucket B | Bucket C |
|------|----------|----------|----------|
| app/lib/analysisController.ts | F01 | F17, F20, #96 | F38 |
| app/lib/proxies.cjs | F02 | F30, S3, M2 | H2 |
| app/lib/logs-server.cjs | F02 | F34 | — |
| src/log.ts | F03 | — | — |
| src/store-idb.ts | F04 | — | — |
| src/store-file.ts | F04 | F10, F12 | — |
| src/store-node.ts | — | F12 | — |
| src/store.ts / src/store-memory.ts / src/storeOps.ts | — | F11, H1 | — |
| app/lib/desktopBridge.ts | F04(M1) | F37, H1 | — |
| src/yahoo/deviceYahooCollect.ts | F06 | F35 | — |
| src/yahoo/composeYahooReports.ts | F06 | — | — |
| src/yahoo/composeYahooOverview.ts | — | #97 | — |
| src/yahoo/webSearch.ts / quoteClient.ts / f10.ts | — | F25 / F14 / F27 | — / F36 / F26 |
| src/tdx/deviceCollect.ts | — | F56 | — |
| src/indicators.ts | — | F15 | — |
| src/webCollect.ts | F13 | — | — |
| app/screens/DataScreen.tsx | F05 | F18 | — |
| desktop/child.mjs | F07, F08 | — | — |
| desktop/main.mjs | — | F09, H1 | — |
| app/server.mjs | — | F28, F29, S2, S5 | S6 |
| app/metro.config.js | — | S2 | — |
| app/App.tsx / SettingsPanel.tsx / ReportContent.tsx | — | F17(App.tsx:69) | F40, F41, F42, F43 |
| app/lib/punycode-shim.ts / zlib-shim.ts / settings.ts | — | F32 / F33 / F19 | — / — / #100 |
| app/lib/chartHtml.ts + tools/build-chart-view.mts | — | — | F31 |
| src/theme.ts / app/app.json (native theme) | — | — | #101 |
| .env.example / app/.env.example | — | F44, F45, F46 | — |
| package.json files / README / ci.yml / release.yml / electron-builder.yml | — | — | F47–F52, #98, #99, R5, R6 |
| tools/configure-android-signing.mjs | — | F16 | — |
| tools/probe.mts | — | — | F53, F54 |
| tools/desktop-probe.mts | — | H1 | — |
| test/events.test.ts | F21 | F22 | — |
| test/query-content.test.ts / test/runner.test.ts | F21 | — | — |
| test/yahoo.test.ts | F06 (annual fixtures) | — | F58 |
| test/yahoo-collect.test.ts | — | F55 | F57 |
| test/pipeline.test.ts | — | — | F59 |
| test/store-node.test.ts | — | — | F60 |
| test/device-collect.test.ts | — | F56 | — |
| test/live.integration.test.ts / test/llm.test.ts | — | F23 / F24 | — |
| test/desktopBridge.test.ts / test/store-op-validators.test.ts | — | H1 | — |
| test/log.test.ts | F03 | — | — |

Contract 4 of the parent PRD guards the residual risk of same-file co-edits
within a bucket pass: one fixer at a time per file, adjacent-line edits
serialized in implement.md.

## Contract details for children

1. **Fix methods**: take the `Fix` column of `research/fix-backlog.md`
   verbatim; where it says "pattern precedent <file>" (e.g. F04 →
   store-file.ts:110-113), copy the precedent shape.
2. **New tests**: only where the fix changes observable contract (F06 annual
   fixtures, F13 typed error, F03 rotation, F01 re-entry, F21 isolation).
   Test style per `.trellis/spec/testing.md`; suites must be deterministic and
   offline (F21 rule applies to all new tests).
3. **Commits**: one commit per item or per coherent pass (G-pass), messages in
   repo style (`fix(scope): 简述,修 <finding>` — see `git log` for examples);
   each commit references its finding ID (F0x / Sx / Hx / #xx / Mx / Rx).
4. **Do not** touch the chart mirror (`tools/build-chart-view.mts` +
   `app/lib/chartHtml.ts`) except F05/F31 — if touched, chart:build+check runs.

## Integration review procedure (parent's own gate, after last child)

1. `git status --porcelain` clean; all three children archived.
2. Re-run gates: `npx vitest run`, `npx tsc --noEmit`, chart gate if F05/F31
   changed chart assets.
3. Verify closure: every item ID from the three child PRDs appears in a fix
   commit (`git log --oneline -i -E --grep='F[0-6][0-9]|S[0-9]|H[0-9]|M[0-9]|R[0-9]|#9[6-9]|#10[01]'`),
   no item left.
4. Spot-check 3–5 highest-severity diffs against the fix methods.
5. Record closure in journal; report to user.

## Rollback shape

Each child's fixes are independent commits → `git revert` per commit is the
rollback unit; no child depends on another's code at runtime (shared-file
edits are disjoint hunks). Worst case (gate regression after a child): revert
that child's commits, fix, re-land.
