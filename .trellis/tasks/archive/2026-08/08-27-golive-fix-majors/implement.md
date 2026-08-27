# Implement: Go-live Fix — Majors (Bucket A)

Execution order follows shared-root-cause passes (fix-backlog G1/G2/G8/G9/G3),
standalone items slotted first. One implement agent per pass, sequential.

## Ordered checklist

1. **F01** re-entry guard — analysisController.ts + test
   `npx vitest run test/analysis-controller.test.ts test/analysis-controller-hasdone.test.ts`
2. **F03** log rotation overwrite — src/log.ts + test/log.test.ts
   `npx vitest run test/log.test.ts`
3. **G1 · F04+M1** memo-reset — store-idb.ts ×2, store-file.ts ×2,
   desktopBridge.ts ×1 (pattern store-file.ts:110-113)
   `npx vitest run test/store*`
4. **G2 · F02** chunk decode — proxies.cjs ×2, logs-server.cjs ×1
   `npx vitest run test/proxies.test.ts test/log-server.test.ts` + add
   two-chunk CJK round-trip case to proxies.test.ts (AC1) + manual proxy
   smoke with a CJK prompt
5. **G8 · F07+F08** desktop child lifecycle — child.mjs + main.mjs (guard-only)
   verification: `node --check desktop/child.mjs` + desktop smoke (start/stop)
6. **G9 · F06** annual/quarterly rates — deviceYahooCollect.ts +
   composeYahooReports.ts + new annual fixture test
   `npx vitest run test/yahoo.test.ts test/device-*`
7. **G9 · F13** webCollect validation — webCollect.ts + typed-error test
   `npx vitest run test/web-collect*`
8. **F05** DataScreen useMemo — DataScreen.tsx
   verification: web smoke render (or existing component test); chart gate N/A
9. **G3 · F21** test isolation — query-content/events/runner suites
   `npx vitest run test/query-content.test.ts test/events.test.ts test/runner.test.ts`
10. **S4** rotation checklist — write
    `.trellis/tasks/08-27-golive-fix-backlog/research/rotation-checklist.md`
    (no code)
11. **Final gates** (blocking):
    ```bash
    npx vitest run          # ≥627 pass, 0 fail
    npx tsc --noEmit        # 0 errors
    git status --porcelain  # clean
    ```

## Validation per pass

- After each pass: targeted suite green + `npx tsc --noEmit` (cheap, catches
  type fallout early).
- Architecture assertions: `test/architecture.test.ts` must pass after every
  pass touching src/ (F06, F13, F04 especially — meta keys / log calls).
- No cross-bucket fixes: files also owned by mediums (analysisController,
  proxies.cjs, stores, DataScreen) — only the listed hunks.

## Review gate (before check phase)

All 11 items implemented, per-item test evidence named, final gates green.
Then trellis-check (2.2) on the full diff; then finish-work archive.

## Rollback

Per-commit revert; pass order chosen so each pass is independently revertible.
If a pass breaks gates: revert that pass's commit(s), re-implement, re-run its
targeted suite before proceeding.
