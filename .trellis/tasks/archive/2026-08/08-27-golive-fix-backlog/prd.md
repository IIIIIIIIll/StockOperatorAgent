# PRD: Go-live Fix Backlog（父任务）

## Goal

Remediate the full 08-26 go-live audit backlog: **78 fixable items** (66 open
findings re-verified + 12 new/adjusted records), organized as a three-child
task tree executed in priority order. End state: every item fixed and verified,
all gates green on master, repo go-live ready.

## Background

- Source: audit task `08-26-golive-readiness-audit` — verdict: *no hard
  blockers in the tree; the go-live gap is the unremediated backlog* (6 majors
  + 17 mediums + 43 lows/nits + security/release items).
- Master record copied into this task: `research/fix-backlog.md` — 80 recorded
  rows (78 fixable items + S1/H3 informational; 3 further records deduped into
  survivors), 0 refuted, evidence pinned at HEAD=213fe13, fix methods
  adversarial-review-corrected (findings-review.md in the audit task carries
  the review verdict; two evidence cites corrected in this copy 2026-08-27 —
  see note at record top). **This parent owns the requirement set; children
  consume the record, never re-research.**
- 2 informational records intentionally NOT scheduled: **S1** (NUL-byte/stream
  crash claims refuted at runtime under Node v22.22.3; residual hardening =
  F29 in child mediums) and **H3** (InMemoryStore test-only, documented
  intentional).

## Task tree

| Child | Priority | Items | Scope |
|-------|----------|-------|-------|
| `golive-fix-majors` | P0 | 11 | F01–F08, F13, F21, S4 — must fix before go-live |
| `golive-fix-mediums` | P1 | 37 | Bucket B — should-fix (waits for majors) |
| `golive-cleanup-nits` | P2 | 30 | Bucket C — notes/nits batch (waits for mediums) |

Total 78 fixable items; item lists are exhaustive in each child PRD (nothing
from `fix-backlog.md` buckets A/B/C is left out).

## Cross-child contracts

1. **Strict sequential ordering — no parallel fixes.** Children share files
   (analysisController.ts, proxies.cjs, logs-server.cjs, store-*.ts,
   desktopBridge.ts, deviceYahooCollect.ts, DataScreen.tsx, desktop/child.mjs,
   test/events.test.ts, …; see parent design.md conflict matrix). Buckets run
   in order majors → mediums → nits; each child's PRD states the wait condition.
2. **Shared gates** — every child MUST end with, on the merged tree:
   `npx vitest run` (627 tests / 55 files today; count may grow with new
   tests — must stay green, 0 fail), `npx tsc --noEmit` (0 errors),
   `npm run chart:build && npm run chart:check` when chart assets touched
   (F05, F31), `git status --porcelain` clean.
3. **Spec pre-checks for every fixer** (from `.trellis/spec/ts/`): architecture
   assertions `test/architecture.test.ts` must pass; log calls via `src/log.ts`
   only; meta keys from `src/metaKeys.ts` only; env reads via `src/env.ts` only.
4. **No cross-bucket scope creep.** A fixer editing a shared file for its own
   item does NOT fix other items in that file; outstanding items in the same
   file are listed in the commit message/notes for the next child.
5. **S4 is a process item, not code**: Android keystore + password rotation
   happens on the release machine and GitHub Actions secrets; the child ships
   the rotation checklist as an artifact, no code.
6. Each child is archived (via its own finish-work) once its check passes;
   the parent only archives after the final integration review (below).

## Acceptance criteria

1. All 78 items closed (fixed + verified) across the three children; each
   child's per-item acceptance met (evidence = test/diff per item).
2. Full gates green on master after the last child (re-run by parent
   integration review, not assumed).
3. Parent integration review performed: gates re-run, per-item evidence
   spot-checked, no regression in `src/log.ts` / meta-keys / env pre-checks.
4. Journal records the backlog closure; archived tasks reference
   `research/fix-backlog.md` as the audit trail.

## Non-goals

- New features or refactors beyond the fix methods in `fix-backlog.md`.
- Re-auditing the backlog (record is authoritative; re-verify only on
  suspicious evidence).
- Style/lint nitpicks not listed in the backlog.
