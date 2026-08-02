---
description: Operating contracts of the spec system itself — frontmatter routing, injection caps, layer discovery
paths:
  - .trellis/spec/**
---

# Spec System Operating Guide

How `.trellis/spec/` is parsed, routed, and injected in this repo. Read this
before editing any spec file — a malformed frontmatter block silently disables
path routing for that file.

## 1. Frontmatter

A spec file is considered for routing only if its **first line is exactly
`---`** (tolerant parser, 16 KiB / 200-line head bound — see
`.trellis/scripts/common/spec_match.py`).

Recognized keys:

| Key | Value | Effect |
|-----|-------|--------|
| `name` | single-line string | label |
| `description` | single-line string | reused as the index line when injection degrades |
| `paths:` | block list (`- <glob>`) or flow (`paths: [a, b]`) | the routing globs (repo-relative) |

Unknown keys and stray `- item` lines are ignored. A `---` block with no
recognized key is treated as a horizontal rule, not frontmatter.

**Errors that disable the whole file** (warn + skip):
- `paths:` given as a scalar where a list belongs (e.g. `paths: agents/**`)
- frontmatter block still open when the head bound is reached

## 2. Glob Grammar (repo-relative)

- `*` matches within one path segment (never crosses `/`)
- `**` as a whole segment matches zero or more segments
- trailing `/` is sugar for `/**` (e.g. `agents/` ≡ `agents/**`)
- `**` embedded in a segment degrades to `*`
- invalid globs (leading `/`, `..` segments, backslashes, control chars) are
  skipped with a warning; the rest of the file's globs still apply

Examples:

```yaml
paths:
  - agents/**              # everything under agents/
  - core/data_acquisition.py   # that exact file
  - utils/state.py
```

## 3. Injection Behavior

Touching a file (Read/Edit/Write/MultiEdit) surfaces every spec whose globs
match, **most specific globs first** (path tie-break).

- Per-file cap: `max_spec_chars: 9400` — longer specs inject truncated with a
  notice; keep specs under ~9.4k chars to inject in full.
- Per-event cap: `max_total_chars: 9500` — overflow degrades remaining specs
  to index lines (path + description), so don't pile overlapping globs on one
  file.
- Refresh window `2700s`: unchanged spec stays silent; after the window a
  `<spec-ticket>` reminder re-emits. **Editing the spec itself re-injects it**
  immediately.
- Overlapping matches (e.g. a file covered by a layer spec and `logging.md`)
  are normal — the caps handle it.

## 4. Layer and Index Discovery

- `python3 .trellis/scripts/get_context.py --mode packages` lists every
  subdirectory of `.trellis/spec/` **except `guides`** as a spec layer.
- SessionStart lists `guides/index.md` plus each layer's `index.md` ("Spec
  indexes: N available"). A layer without `index.md` is invisible at startup.
- **Root-level `.md` files are NOT in the SessionStart index** — they surface
  only via `paths:` routing or links from an index. Every root spec
  (`architecture.md`, `logging.md`, `error-handling.md`, `testing.md`,
  `spec-system.md`) therefore carries `paths:` and is linked from
  `index.md`.
- `guides/` holds thinking checklists only — it is never a coding-spec layer.

## 5. Code-Spec vs Guide Decision Rule

- "**How to write** the code" (signatures, contracts, patterns) → layer spec
  (`agents/index.md`, `data_storage/index.md`, ...).
- "**What to consider** before writing" (checklists, questions) →
  `guides/*.md`.
- A learning that spans layers but is a concrete convention (logging,
  errors, testing) → root-level spec with `paths:`.

## 6. Verification for Spec Edits

```bash
# Placeholders must not exist
grep -rni "to be filled\|tbd\|placeholder" .trellis/spec

# Frontmatter parses and routing matches (run from repo root)
python3 - <<'EOF'
import sys; sys.path.insert(0, '.trellis/scripts')
from common.spec_match import parse_spec_frontmatter, match_specs_for_file
from pathlib import Path
for f in sorted(Path('.trellis/spec').rglob('*.md')):
    parse_spec_frontmatter(f.read_text(errors='replace')[:16384])
print([str(m.spec_path) for m in match_specs_for_file('.', 'agents/chinese_mainland/trend_analysis_expert.py')])
EOF

# Layers discovered
python3 .trellis/scripts/get_context.py --mode packages

# Internal links resolve
grep -rhoE '\]\([^)#]+\)' .trellis/spec | sort -u
```

## Anti-Patterns

- Writing `paths:` with a scalar value — it disables routing for the whole file.
- Adding a spec file without `paths:` and without an index link — it becomes
  unreachable except by manual navigation.
- Renaming a layer directory without updating its `index.md` — SessionStart
  index count and `--mode packages` output go stale.
- Leaving a spec above ~9.4k chars — it injects truncated, and future edits
  run against a partial spec.
