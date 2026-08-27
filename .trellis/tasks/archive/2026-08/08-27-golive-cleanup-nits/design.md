# Design: Go-live Cleanup — Nits (Bucket C)

Mostly mechanical; only decision-bearing items get design notes. Defaults
chosen conservatively — user may veto at start review.

## F52 — app version identity (only user-visible decision)

- Default: align `app/package.json` (57.0.13 template leftover) + `app/app.json`
  to the release series **0.1.3**, personalize name/description/license.
  Rationale: a tagged v0.1.3 AAB currently carries versionName 1.0.0 — the
  audit's merged R1→F52 flags this as minor.
- Alternative (rejected unless user says so): document web/RN as unreleased
  channel and leave versions. Keep the option open in review.

## R2 — CHANGELOG decision

- Default: **no new CHANGELOG.md**; add a "Releases" note in README pointing to
  GitHub Release bodies (review downgraded R2 sf→note for this reason —
  Release bodies + README already carry notes; a third doc source drifts).
- Document the decision in README so future sessions don't re-litigate.

## F31 — chart mirror (only chart-gate item)

- Both generators (`app/lib/chartHtml.ts` + `tools/build-chart-view.mts`)
  must stay behavior-identical: hoist legend rendering above the
  empty-series early return in BOTH, then `npm run chart:build` regenerates
  the mirror view + `npm run chart:check` diffs. If the mirror is a golden
  file, the build updates it in the same commit.
- Validation: chart:build + chart:check green; visual smoke if a renderer exists.

## S6 — token guard (only code-behavior change)

- server.mjs:141-148: when HOST is non-loopback, require a token (env-read via
  src/env.ts per spec pre-check) on proxy/log endpoints; loopback keeps
  current behavior (documented opt-in unchanged). Token env var name:
  **`SOA_ACCESS_TOKEN`** (added to .env.example commented row if not present).
  At implementation, confirm the existing HOST read also routes through
  src/env.ts (or note why the pre-check doesn't apply to it). Small guard + test.

## #99 — SHA-pinning actions

- Replace `@v4` major-tag references with commit SHAs of the currently
  resolved versions (fetch each action's latest v4 SHA at implementation
  time; pin exact). Include comment `# v4 → <sha>` for auditability.

## #101 — dark palette

- Default: set `app.json` userInterfaceStyle "automatic" is risky (native
  re-render churn) — choose **remove the dead dark branch** in theme.ts
  (smaller, zero behavior change since it never activates on native with
  "light"); keep "light" in app.json. Document in commit.

## Mechanical batch (no design)

F26, F36, F38, F39, F40, F41, F42, F43, F47–F51, F53, F54, F57–F60, H2, R5,
R6, S7 — follow fix-backlog Fix column verbatim.

## Test/commit conventions

Same as siblings: one commit per item/pass with finding ID; targeted suites
per pass; full gates at end; no cross-bucket fixes (F38/F43 touch files owned
by earlier buckets — sequential, disjoint hunks).
