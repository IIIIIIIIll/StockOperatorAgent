# Design: Final Pre-Go-Live Review

## Review architecture

Single parallel wave of read-only subagents + main-session gate runs.
All subagents get: task path, the 78-item bucket scope, fix-backlog.md path,
the commit range under review (bbaa223..HEAD), and the false-positive
verification rule.

### Subagent map

| Agent | Dimension | Output contract |
|-------|-----------|-----------------|
| scout | Closure verification | Per-item table: ID → FIXED/NOT-FIXED/PARTIAL/N/A + file:line evidence. Cross-check each of the 78 bucket items against current tree using fix-backlog.md method. |
| reviewer | Fix-series diff review | Severity-ranked findings (blocker/should-fix/note) on bbaa223..HEAD: regressions, contract breaks, half-done work, missed spec pre-checks (log via src/log.ts, meta keys via metaKeys.ts, env via src/env.ts). |
| security-reviewer | Security pass | Findings with evidence: new code from fix series + residual S2/S3/S4/S5/M2 + CI secrets handling + Electron shell invariants. |
| trellis-check | Release readiness + hygiene + spec conformance | Version coherence table (root/app/desktop/app.json/tag), CI workflow health, README/docs (R2/F48), probe tools (F53/F54), rotation-checklist artifact, TODO/FIXME/dead-code/debug debris scan, architecture.test.ts 7 assertions intact (source-level check; the run is main-session's). |

### Gate runs (main session, real commands)

1. `npx vitest run` — expect ≥627 pass / 0 fail.
2. `npx tsc --noEmit` — expect 0 errors.
3. `npm run chart:build && npm run chart:check` — REQUIRED (F31 touched
   chart assets), expect pass + no dirty diff.
4. `git status --porcelain` after gates — expect clean (except task dir).

Gates fire as background jobs while subagents work; results merged into
findings.

### Contracts

- All subagents READ-ONLY. No edits, no full-suite validation runs
  (gates belong to main session).
- Every claim needs file:line or command-output evidence.
- Cross-layer/cross-file claims verified before reporting; ~35% AI-review
  false-positive budget per guides.
- Findings persisted to `research/findings.md` (+ `research/closure.md`).

## Output shape

- `research/closure.md` — 78-item closure table.
- `research/findings.md` — dimensioned findings + gate results.
- Chat: verdict + prioritized go-live checklist.
