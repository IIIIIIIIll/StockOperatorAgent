# Implement: Go-live Fix — Mediums (Bucket B)

Order = fix-backlog G-passes, file-conflict aware. One implement agent per
pass, sequential. Runs AFTER majors is committed + checked.

## Ordered checklist (37 items)

1. **G3 test isolation+hygiene**: F22 (events.test.ts), F23
   (live.integration.test.ts), F24 (llm.test.ts), F55 (yahoo-collect.test.ts),
   F56 (device-collect.test.ts + deviceCollect.ts host fix)
   (F23 placement: intentional — master's G3 pass lists F21/F22/F24/F55-F60;
   F23 is unassigned there, G3 is its natural home)
   `npx vitest run test/events.test.ts test/live.integration.test.ts test/llm.test.ts test/yahoo-collect.test.ts test/device-collect.test.ts`
2. **G4 server/proxy hardening**: F28, F29 (server.mjs); F30, S3, M2
   (proxies.cjs); S2 (server.mjs + metro.config.js); S5 (both)
   `npx tsc --noEmit` + targeted: boot server.mjs, probe /llm-proxy with
   cross-origin + malformed-URL + redirect-to-internal cases
3. **G5 env-example family**: F44, F45 (root .env.example), F46
   (app/.env.example) — no tests, `git diff` review
4. **G6 android signing**: F16 (tools/configure-android-signing.mjs escape)
   `node --check tools/configure-android-signing.mjs`
5. **G8 desktop**: F09 (main.mjs devtools gating) — `node --check` + packaged-
   vs-dev smoke
6. **G9 data correctness**: F14 (quoteClient.ts), F20 (analysisController.ts +
   useAnalysis.ts + pipeline.ts), F25 (webSearch.ts), F35 (deviceYahooCollect.ts),
   #96 (analysisController.ts), #97 (composeYahooOverview.ts)
   `npx vitest run test/yahoo* test/web-search* test/qfq* test/analysis-controller.test.ts test/analysis-controller-hasdone.test.ts test/pipeline.test.ts`
7. **G10 UI/UX**: F17 (App.tsx + analysisController.ts), F18 (DataScreen.tsx)
   `npx vitest run` (component suites if any) + web smoke
8. **G11 store semantics** (highest risk, separate review): F10 (store-file.ts),
   F11 (store.ts — pin contract from tests first), F12 (store-node.ts +
   store-file.ts), H1 (updateOverview removal — `lsp references` first;
   store-update-overview.test.ts + probe + IPC whitelist in same commit)
   `npx vitest run test/store*` — run BEFORE the H1 commit (which deletes
   store-update-overview.test.ts), then re-run after
9. **G12 leftovers**: F15 (indicators.ts — check pinned tests first), F19
   (settings.ts), F27 (f10.ts), F32 (punycode-shim.ts), F33 (zlib-shim.ts),
   F34 (logs-server.cjs), F37 (desktopBridge.ts), #100 (settings.ts)
   `npx vitest run test/indicators* test/f10* test/settings*` (find exact)
10. **Final gates** (blocking):
    ```bash
    npx vitest run          # ≥627 pass, 0 fail (net test count may shift ±)
    npx tsc --noEmit        # 0 errors
    git status --porcelain  # clean
    ```

## Validation per pass

- Targeted suite + `npx tsc --noEmit` after each pass.
- architecture.test.ts green after every src/ pass (F12, F20, H1 especially).
- H1: reviewer gate — verify zero missed references before/after removal.

## Review gate (before check phase)

All 37 implemented, per-item evidence named, gates green → trellis-check (2.2)
→ finish-work archive. Nits child waits for this.

## Rollback

Per-commit revert; G11's H1 is the only net-negative-diff commit — if reverted,
probe + test restore cleanly (one commit each way).
