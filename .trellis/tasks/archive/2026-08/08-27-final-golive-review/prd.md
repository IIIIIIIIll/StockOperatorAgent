# PRD: Final Pre-Go-Live Review

## Goal

One final thorough, evidence-backed review of the working tree **before go
live**, after the 08-27 remediation series (majors + mediums + nits buckets,
all committed and archived). Answer: **is this repo ready to ship?**

Review-only task. No product code changes; findings that require fixes become
follow-up tasks (or are fixed in a separate pass if blocking).

## Background

- Repo: TS-only (src/ platform-neutral business layer, app/ Expo web/RN
  client, desktop/ Electron shell, Node server server.mjs, CJS proxies).
- 2026-08-26 readiness audit (archived `08-26-golive-readiness-audit`):
  verdict "no hard blockers", but 66 findings open at that time. Backlog
  split into three fix buckets (evidence + fix method authoritative in
  `08-27-golive-fix-backlog/research/fix-backlog.md`):
  - majors (11): F01–F08, F13, F21, S4
  - mediums (37): F09–F12, F14–F20, F22–F25, F27–F30, F32–F35, F37,
    F44–F46, F55–F56, H1, M2, S2, S3, S5, #96, #97, #100
  - nits (30): F26, F31, F36, F38–F43, F47–F54, F57–F60, #98, #99, #101,
    H2, R2, R5, R6, S6, S7
- Current tree: all three buckets committed (bbaa223..2d9a91b), tag v0.1.3,
  `git status --porcelain` clean as of task start.

## Review dimensions

1. **Closure verification** — every bucket item (78 total) is genuinely
   fixed in the current tree per the fix-backlog method, verified against
   code, NOT commit messages. Residual open items identified individually.
2. **Fix-series code review** — the 08-27 commit range reviewed as a diff
   for regressions, contract breaks, and half-done work (F01 re-entry,
   F02 UTF-8 decode, F04 memo rejection, F06 annual rates, F10 drain,
   F42 no-0-commit, F43 expander key, S6 token guard, F31 legend hoist).
3. **Quality gates (real runs)** — `npx vitest run` (≥627 pass / 0 fail),
   `npx tsc --noEmit` 0 errors, chart mirror gate
   `npm run chart:build && npm run chart:check` (REQUIRED: F31 touched
   chart assets), `git status --porcelain` clean.
4. **Security pass** — full-repo security-reviewer pass, including the new
   code from the fix series (server token guard S6, SHA-pinned CI actions,
   configure-android-signing escaping F16, SSRF fixes S3/M2) and residual
   items (S2 origin allowlist status, S5 headers, S4 keystore rotation
   checklist artifact existence).
5. **Release readiness + hygiene** — version coherence (root/app/desktop
   package.json ↔ app.json ↔ tag v0.1.3), CI workflow health (SHA pins,
   npm cache, app tsc deferral documented), README release section (R2),
   artifact table (.aab, F48), probe tooling (F53/F54), rotation-checklist
   artifact, dead code/TODO/FIXME/stub/debug debris, test hygiene.

## Method

Parallel read-only subagents, one per dimension (scout / reviewer /
security-reviewer / trellis-check), plus main-session real gate runs.
Main session re-verifies every surprising claim against code before
reporting (~35% AI-review false-positive budget per
`.trellis/spec/guides/index.md`). Chart gate runs in the main session
because it mutates generated assets.

## Acceptance criteria

1. Findings report persisted under this task's `research/` (findings.md +
   closure table).
2. Every bucket item has a closure status: FIXED (with file:line evidence) /
   NOT-FIXED / PARTIAL / N/A.
3. Every review finding has: dimension, severity (blocker / should-fix /
   note), concrete evidence (file:line or command output), suggested next
   step.
4. Gate results are from real runs on this working tree, not assumptions.
5. Final chat output: prioritized go-live checklist (blockers first) +
   verdict (READY / NOT-READY with reasons).

## Non-goals

- Fixing anything found (follow-up tasks; main session only fixes if user
  approves immediately after review).
- Re-researching fix methods (fix-backlog.md is authoritative).
- Style/lint nitpicks below "would embarrass a release".
- Re-litigating intentional design documented in code comments/specs.
