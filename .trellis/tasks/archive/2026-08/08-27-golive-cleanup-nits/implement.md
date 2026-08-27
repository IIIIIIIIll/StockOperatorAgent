# Implement: Go-live Cleanup — Nits (Bucket C)

Order = mechanical first, decision items at end (so review of F52/R2/#101
defaults doesn't block the batch). Runs AFTER mediums is committed + checked.

## Ordered checklist (30 items)

1. **Test hygiene**: F57 (yahoo-collect.test.ts comment), F58 (yahoo.test.ts
   dead import), F59 (pipeline.test.ts dead makeStore), F60
   (store-node.test.ts try/finally)
   `npx vitest run test/yahoo.test.ts test/yahoo-collect.test.ts test/pipeline.test.ts test/store-node.test.ts`
2. **package.json/README/docs metadata**: F47 (drop string_decoder), F50
   (dual-TS rationale comment), F51 (dead main + metadata), F48 (README .aab
   row), R6 (local builder doc header)
   `node -e "JSON.parse(require('fs').readFileSync('package.json'))"` +
   same for app/package.json (F47/F50/F51) + `npx tsc --noEmit` + diff review
   of README/script docs
3. **CI**: #99 (SHA-pin ci.yml + release.yml), F49 (android npm cache), R5
   (extend deferral comment)
   `npx vitest run test/architecture.test.ts` (spec pre-check); CI items
   #99/F49/R5 are diff-review only — no local CI run, note in commit
4. **tools**: F53 (probe.mts header), F54 (probe.mts output anchor)
   `node --check tools/probe.mts` (build only; no run)
5. **src/ data fixes**: F26 (f10.ts NaN), F36 (quoteClient meta key), F39
   (runner setYahooStore)
   `npx vitest run test/f10.test.ts test/runner.test.ts` (+ architecture.test.ts
   for the F36 meta-key move; no dedicated quoteClient suite exists)
6. **app/ UI**: F40 (theme tokens), F41 (a11y roles), F42 (cap no-0-commit),
   F43 (expander key), F38 (demo-log flag)
   `npx vitest run` (component suites) + web smoke (settings panel, report
   tabs, caps clear)
7. **chart mirror**: F31 (legend hoist in BOTH generators)
   `npm run chart:build && npm run chart:check` — REQUIRED gate
8. **app/ misc + desktop packaging**: H2 (proxies.cjs meta comment), S6
   (token guard `SOA_ACCESS_TOKEN` when non-loopback — env via src/env.ts),
   S7 (secure-store doc comment), #98 (electron-builder icon + buildResources
   asset)
   `npx vitest run` (server/proxy suites) + boot smoke: loopback OK, remote
   without token 401; #98: verify electron-builder.yml references the icon
   path and the buildResources asset exists (no CI run)
9. **Decision items** (review defaults first): F52 (app version align 0.1.3 +
   personalize), #101 (remove dead dark branch), R2 (README decision doc)
   `npx tsc --noEmit` + `npx vitest run` full
10. **Final gates** (blocking):
    ```bash
    npx vitest run          # ≥627 pass, 0 fail
    npx tsc --noEmit        # 0 errors
    npm run chart:build && npm run chart:check
    git status --porcelain  # clean
    ```

## Validation per pass

- Targeted suite + tsc after each pass; architecture.test.ts after src/app
  passes (F36, S6).
- CI items (#99, F49, R5): diff review only — no local CI run; note in commit.

## Review gate (before check phase)

All 30 implemented, gates green → trellis-check (2.2) → finish-work archive.
Parent integration review then runs.

## Rollback

Per-commit revert. F31: if chart:check regresses, revert legend commit (build
regenerates mirror in same commit — revert both files together).
