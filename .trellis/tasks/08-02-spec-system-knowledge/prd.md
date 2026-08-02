# Capture spec-system operating knowledge

## Goal

Document how `.trellis/spec/` operates in this repo — frontmatter `paths:` routing, injection caps, layer/index discovery — into the spec tree, so future spec edits don't silently break routing. Lightweight task (PRD-only).

## Scope

- New: `.trellis/spec/spec-system.md` — operating contracts of the spec system itself (self-routing via `paths: .trellis/spec/**`)
- Update: `.trellis/spec/index.md` — "How Specs Reach You" section links to `spec-system.md`
- No product source changes; no other spec files changed

## Knowledge to Capture (source: `.trellis/scripts/common/spec_match.py`, `.claude/hooks/session-start.py`, `.trellis/config.yaml`, `get_context.py --mode packages`)

1. Frontmatter requirements: first line must be `---`; recognized keys `name`, `description`, `paths:` (block list or flow); malformed `paths:` (scalar where list expected) → file skipped with warning; other unknown keys tolerated.
2. Glob grammar (repo-relative): `*` one segment, `**` any depth, trailing `/` = `/**`, no leading `/`, no `..` segments, POSIX separators.
3. Injection behavior: triggers on Read/Edit/Write/MultiEdit; per-file cap ~9400 chars, per-event cap ~9500 (overflow degrades to index lines); refresh window 2700s; more-specific globs first; editing a spec re-injects it.
4. Layer/index discovery: `get_context --mode packages` lists every subdir of `spec/` except `guides` as a layer; SessionStart lists `guides/index.md` + each layer's `index.md`; root-level `.md` files are NOT in SessionStart indexes — they must carry `paths:` and be linked from an index.
5. Code-spec vs guide decision rule (how-to-write → layer spec; what-to-consider → guides/).
6. Verification commands for spec edits (frontmatter parse check, link check, placeholder grep).

## Acceptance Criteria

- [ ] `spec-system.md` captures all six points above with concrete contracts (frontmatter keys, glob grammar, caps).
- [ ] `spec-system.md` has `paths: .trellis/spec/**` frontmatter so editing any spec injects the operating rules (verified via `match_specs_for_file`).
- [ ] `index.md` "How Specs Reach You" links to `spec-system.md`.
- [ ] No placeholders; frontmatter parses cleanly; all files stay under 9400 chars.
- [ ] Product source untouched; only `.trellis/spec/` + task dir changed.
