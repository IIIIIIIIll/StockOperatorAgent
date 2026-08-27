# PRD: Go-live Cleanup — Nits (Bucket C, 30 项)

## Goal

Fix all **30 low/nit + note items** (Bucket C) from the audit backlog. Runs
LAST of the three fix children. Evidence + fix method for every item: parent
`08-27-golive-fix-backlog/research/fix-backlog.md` (authoritative).

## Ordering / wait conditions

- **Waits for**: mediums child committed + checked (shared files with earlier
  buckets: App.tsx, SettingsPanel.tsx, ReportContent.tsx, package.json files,
  app/lib/proxies.cjs, app/server.mjs, src/tdx/quoteClient.ts, src/f10.ts,
  test/yahoo-collect.test.ts, test/yahoo.test.ts).
- Runs after all other children; parent integration review follows.

## Scope (30 items, exhaustive)

| ID | Sev | Fix (from fix-backlog.md) |
|----|-----|---------------------------|
| F26 | nit | src/f10.ts:20-21 — toNum('万' bare) NaN check before multiply |
| F31 | nit | app/lib/chartHtml.ts:86-91,116-120; tools/build-chart-view.mts:163-168,194-196 — hoist legend before empty-series early return (**chart mirror gate REQUIRED**) |
| F36 | nit | src/tdx/quoteClient.ts:77 — export nameKey from metaKeys.ts instead of `name:${ticker}` literal |
| F38 | nit | app/lib/analysisController.ts:220-221 — log 演示数据载入 only on actual insert (return flag) |
| F39 | nit | app/lib/runner.ts:42-45,55 — call setYahooStore inside setStore |
| F40 | nit | app/App.tsx:351,358,362; SettingsPanel.tsx:209 — promote hardcoded #fff/#000 to theme tokens |
| F41 | nit | app/App.tsx:105,147,231,244; ReportContent.tsx:83 — role=button, aria-expanded, tab roles (pattern App.tsx:138-139) |
| F42 | nit | app/screens/SettingsPanel.tsx:184-187 — early return on empty trim (no 0 commit) |
| F43 | nit | app/components/ReportContent.tsx:44,79-83; App.tsx:287 — key={activeRole.stateKey!} (expander leak across tabs) |
| F47 | nit | package.json:19 — remove dead dep string_decoder |
| F48 | nit | README.md:117 — add .aab row to artifact table |
| F49 | nit | .github/workflows/release.yml:110-113 — add npm cache (cache-dependency-path) to android job |
| F50 | nit | package.json:26; app/package.json:25 — record dual-TS rationale (or align) |
| F51 | nit | package.json:4-5,11 — remove dead main + empty metadata |
| F52 | nit→minor | app/package.json:2-5; app/app.json:5 — personalize name/desc/license; align version to release series 0.1.3 (AAB versionName) — see design.md decision |
| F53 | nit | tools/probe.mts:1-2 — fix SOA_LIVE header claim |
| F54 | nit | tools/probe.mts:80,136,167,193 — anchor probe-output to import.meta.url (cwd-relative) |
| F57 | nit | test/yahoo-collect.test.ts:61 — fix epoch comment (06-16; constant 1_087_344_000 correct) |
| F58 | nit | test/yahoo.test.ts:4 — remove dead `vi` import |
| F59 | nit | test/pipeline.test.ts:64-66 — delete dead makeStore() |
| F60 | nit | test/store-node.test.ts:80-86 — try/finally around setStore(fake) |
| #98 | nit | desktop/electron-builder.yml — add icon + buildResources asset |
| #99 | nit | ci.yml:24,27; release.yml:27,30,70,91,108,111,130,165,184 — SHA-pin actions (current major tags) |
| #101 | nit | app/theme.ts:43-64; app/app.json:8 — remove dead dark branch or set userInterfaceStyle "automatic" |
| H2 | note | app/lib/proxies.cjs:179 — comment intent for no-op meta storage (or wire meta) |
| R2 | note | root — CHANGELOG decision: document in README release section (default; see design.md) |
| R5 | note | ci.yml — consider app tsc gate; at minimum document deferral (comment exists — keep/extend) |
| R6 | note | app/scripts/build-release-clean.sh — document as local tooling (README or script header) |
| S6 | note | app/server.mjs:141-148 — require token when HOST≠loopback (small guard) |
| S7 | info | settingsStore.ts:117-121; child.mjs:73-81 — document secure-store option as future work (comment) |

## Acceptance criteria

1. Per item: fix per fix-backlog method. Contract-change items get tests where
   sensible (F42 no-0-commit, F43 expander key, S6 token guard); most are
   comment/meta changes — verified by diff + gates.
2. **Chart mirror gate REQUIRED** (F31 touches chart assets):
   `npm run chart:build && npm run chart:check` must pass; chart-view
   verification if visual.
3. Gates on final tree: `npx vitest run` ≥627 pass / 0 fail, `npx tsc --noEmit`
   0 errors, `git status --porcelain` clean.
4. Spec pre-checks: log via src/log.ts, meta keys via metaKeys.ts (F36), env
   via src/env.ts; architecture.test.ts green.
5. Commit per item/pass with finding ID in message.
6. R2 decision documented in README (no new CHANGELOG file unless user opts in
   at review).

## Non-goals

- Items outside Bucket C; re-researching fix methods.
- Refactoring theme system beyond promoting the listed literals (F40 scope).
