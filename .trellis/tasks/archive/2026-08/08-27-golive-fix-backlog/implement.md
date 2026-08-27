# Implement: Go-live Fix Backlog — Parent Execution Plan

## Ordered steps

1. ~~Create tree~~ (done: 3 children linked, master record copied to
   `research/fix-backlog.md`).
2. **Start review** (Phase 1.4): user reviews parent prd/design + the three
   child PRDs/designs/implement.md → `task.py start` parent after confirmation.
3. **Child activation, in order** (each child starts only after the previous
   child's commit is on master and its check passed):
   1. `08-27-golive-fix-majors` (P0) — gate: 11 items, all gates green.
   2. `08-27-golive-fix-mediums` (P1) — wait: majors committed + checked.
   3. `08-27-golive-cleanup-nits` (P2) — wait: mediums committed + checked.
4. **Parent integration review** (procedure in design.md): full gates re-run,
   item-closure audit against child PRD lists, spot-check top diffs.
5. **Wrap-up**: journal record; archive each child as it completes (finish-work
   per task), archive parent after integration review.

## Validation commands (parent-level, run at step 4)

```bash
npx vitest run          # ≥627 pass, 0 fail
npx tsc --noEmit        # 0 errors
git status --porcelain  # clean
git log --oneline -i -E --grep='F[0-6][0-9]|S[0-9]|H[0-9]|M[0-9]|R[0-9]|#9[6-9]|#10[01]'
                        # every child-PRD item ID must appear in fix commits
```

## Review gates

- Child start gate: prd/design/implement complete + jsonl curated before
  `task.py start` (per workflow 1.4).
- Child finish gate: its own check (2.2) passed → archive.
- Parent finish gate: step 4 all green → archive.

## Rollback points

- Per-commit `git revert` (each item = independent commit, disjoint hunks).
- If a child's batch breaks gates: revert its commits, fix in same child, re-run
  its check before the next child starts.
