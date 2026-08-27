# Implement: Final Pre-Go-Live Review

Read-only review task. Order:

1. **Plan** (done) — prd.md + design.md; user review gate.
2. **Gate runs** — fire background jobs (main session):
   - `npx vitest run` (long)
   - `npx tsc --noEmit`
   - `npm run chart:build && npm run chart:check` (mutates generated
     assets; confirm `chart:check` passes and tree stays clean)
3. **Dispatch wave** — one `task` batch, 4 read-only subagents per
   design.md table. Shared context: task path, bucket scope (78 items),
   `08-27-golive-fix-backlog/research/fix-backlog.md` authoritative,
   commit range `bbaa223..HEAD`, read-only, evidence required, no
   full-suite validation runs.
4. **Verify** — main session re-checks every blocker/should-fix claim
   against code before reporting; gate results merged.
5. **Persist** — `research/closure.md` + `research/findings.md`.
6. **Report** — verdict (READY / NOT-READY) + prioritized go-live
   checklist (blockers first) in chat; if blockers found, offer immediate
   fix pass (user decides; not auto-scoped).
7. **Finish** — spec update if the review surfaces conventions worth
   codifying (trellis-update-spec), commit research artifacts, archive
   task.

## Validation gates

- Gates are the deliverable: real-run outputs quoted in findings.
- No product code changes → no test additions expected.

## Rollback

N/A (read-only; chart:build regeneration is the only mutation and is
git-verified clean by `chart:check`/`git status`).
