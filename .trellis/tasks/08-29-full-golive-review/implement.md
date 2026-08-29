# Implement: Full Pre-Go-Live Code Review (fresh pass)

## Execution order

1. **Curate context manifests** — implement.jsonl / check.jsonl with spec
   + prior-research entries (done at planning; verified before start).
2. **Launch gates (background)** — `npx vitest run`, `npx tsc --noEmit`.
   Chart gate deferred to step 6 (mutates generated assets; F31 mirror
   must run after all other verification to leave tree clean).
3. **Dispatch 5 parallel subagents** per design.md map. Each prompt:
   - starts with `Active task: .trellis/tasks/08-29-full-golive-review`
   - read-only mandate, evidence contract, prior-research context paths,
     false-positive verification rule
4. **Main-session verification pass** — while agents run, main session
   spot-reviews highest-risk surfaces itself (SSRF paths, S6 token wiring,
   store close/drain, runner re-entry, chart mirror sources) so surprising
   claims can be checked against first-hand reading.
5. **Merge + re-verify** — collect agent outputs; re-verify every
   blocker/should-fix claim against code (file:line). Reject
   false positives per guides budget.
6. **Chart gate** — `npm run chart:build && npm run chart:check` (cwd
   app/); then `git status --porcelain` clean check.
7. **Persist** — write `research/findings.md` (dimensioned, evidence,
   next-step; gate results; S4 rotation status note).
8. **Report** — verdict READY/NOT-READY + prioritized go-live checklist
   (blockers first) in final chat output. No code fixes unless user
   approves immediately; findings → follow-up tasks.

## Review gates

- G1: All 5 subagent outputs collected with evidence-backed findings.
- G2: Main-session re-verification complete (no unverified
  blocker/should-fix in final report).
- G3: vitest ≥666 pass / 0 fail; tsc 0 errors; chart gate pass + clean
  tree.
- G4: findings.md persisted; verdict + checklist delivered.

## Rollback

Review-only task: no product code changes, nothing to roll back. If chart
gate leaves dirty generated assets, regenerate/restore before finish.
