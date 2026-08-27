# PRD: Go-live Readiness Audit

## Goal

Answer: **what still needs to be done in this repo before we go live?**
Produce an evidence-backed gap list, prioritized, with file-level references.
Read-only audit — no product code changes in this task; fixes become follow-up tasks.

## Background

- Repo: TS-only implementation (`src/` platform-neutral business layer,
  `app/` Expo web/RN client, `desktop/` Electron shell, Node server
  `server.mjs`, CJS proxies). Python era archived.
- Recent history: desktop version aligned to v0.1.x release series
  (3eda58e), CI TSCONFIG_ERROR fix (688e82d), archived task
  `08-25-review-findings-audit` whose open findings must be re-checked.
- Verification gates per spec: `npx vitest run` (+ architecture assertions),
  `npx tsc --noEmit`; chart mirror gate `npm run chart:build` +
  `npm run chart:check` when chart assets touched.

## Scope (audit dimensions)

1. **Prior-findings recovery** — read archived `08-25-review-findings-audit`
   (and any older audit/journal notes): which findings remain unfixed?
2. **Code hygiene** — TODO/FIXME/HACK/XXX markers, placeholder/stub/no-op
   implementations, debug debris, dead code flagged in source.
3. **Security** — hardcoded secrets/tokens, sensitive values under
   `EXPO_PUBLIC_*` (client-visible env), server bind addresses, Electron
   shell hardening (nodeIntegration/contextIsolation/sandbox), proxy/CORS
   surface of `proxies.cjs` / `logs-server.cjs`.
4. **Quality gates** — actual current state of `vitest`, `tsc --noEmit`,
   chart mirror check; failing/flaky tests named individually.
5. **Release readiness** — version coherence across root/app/desktop
   package.json vs git tags, CI workflow health, build scripts, missing
   changelog/release docs, known-unshipped work declared in specs.

## Non-goals

- Fixing anything found (separate tasks).
- Style/lint nitpicks below "would embarrass a release".
- Re-litigating intentional design documented in code comments/specs
  (false-positive patterns per `.trellis/spec/guides/index.md`).

## Acceptance criteria

- Findings report persisted under this task's `research/` directory.
- Every finding has: dimension, severity (blocker / should-fix / note),
  concrete evidence (file:line or command output), and suggested next step.
- Gate results are from real runs on this working tree, not assumptions.
- Final chat output: prioritized go-live checklist (blockers first).

## Method

Parallel read-only subagents (scout / security-reviewer / trellis-research /
gate-runner), one per scope dimension; main session verifies surprising
claims against code before reporting (~35% AI-review false-positive budget).
