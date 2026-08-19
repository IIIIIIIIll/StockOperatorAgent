# Implementation Plan — Spec Refresh

Subagent-heavy execution. Main session owns decomposition, contracts,
integration review, and commit. No `design.md`: no new architecture is being
introduced — boundaries already exist in the spec tree; this pass verifies and
refreshes.

## Phase A — Research (parallel scouts, read-only)

Three scouts run concurrently; each returns a drift report (facts with file
paths, no edits).

1. **Scout TS-layer**: verify `ts/index.md` against `src/` (all ~30 files:
   agents, committee, store-*, billionsClient/Tools, mcp, webSearch, switches,
   env, log, adjust, proxies, llm), `test/` (30+ tests incl.
   architecture.test.ts), `tools/`. Report: stale claims, missing files/symbols,
   wrong paths, new conventions not covered.
2. **Scout cross-cutting**: verify `architecture.md`, `logging.md`,
   `error-handling.md`, `testing.md` against repo reality: `app/` (Expo,
   server.mjs, android, EXPO_PUBLIC_*), `desktop/` (Electron), `.github/workflows/`
   (android CI), `docs/`, root configs. Report: drift, gaps, wrong claims
   (e.g. loguru is Python-era — check what TS `src/log.ts` actually does).
3. **Scout integrity + archives**: spec-system contract vs actual tree —
   frontmatter `paths:` on every root spec, index files vs file set, internal
   links, layer discovery; archived Python layers (`agents/`, `core/`,
   `data_source/`, `data_storage/`, `data_structure/`) vs remaining Python
   code (`data_source/chinese_mainland/`): is the "deleted in phaseout" claim
   accurate? Guides: placeholder scan, accuracy.

## Phase B — Write (parallel workers, disjoint ownership)

Three workers, each owns disjoint files, edits directly, skips validation.

1. **Worker TS**: refresh `ts/index.md` per scout-1 report. Keep under ~9.4k
   chars (injection cap). Real file paths + symbols.
2. **Worker root**: refresh `architecture.md`, `logging.md`,
   `error-handling.md`, `testing.md` per scout-2 report. Keep `paths:`
   frontmatter valid.
3. **Worker integrity**: fix `spec-system.md` (only if contract changed),
   root `index.md`, `guides/*`, archived-layer annotations per scout-3 report.

Contract: files are disjoint per worker; scouts' reports are shared via
`local://` files written by scouts into the task `research/` dir.

## Phase C — Verify (one subagent)

Run verification, fix what it finds (spec files only):

```bash
grep -rni "to be filled\|tbd\|placeholder" .trellis/spec
python3 .trellis/scripts/get_context.py --mode packages
# frontmatter parse + routing check (spec-system.md §6)
# internal-link resolution
```

Report: layers discovered, link check result, placeholder scan result.

## Phase D — Main session

- Review diffs, confirm acceptance criteria from prd.md.
- Commit (message per repo convention: `docs(spec): ...`).
- `task.py archive` + journal entry.

## Rollback

- All changes confined to `.trellis/spec/` — `git checkout .trellis/spec`
  reverts fully.
- Do not touch `AGENTS.md` managed block or `.trellis/workflow.md`.
