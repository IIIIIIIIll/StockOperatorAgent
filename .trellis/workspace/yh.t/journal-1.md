# Journal - yh.t (Part 1)

> AI development session journal
> Started: 2026-08-02

---

## 2026-08-02 — Spec bootstrap (task 08-02-spec-bootstrap)

Bootstrapped `.trellis/spec/` from the codebase via the trellis-spec-bootstrap skill:

- **Deleted** `backend/` template layer (5 placeholder files — the project has no backend/frontend split).
- **Created** 5 package layers with `index.md` each: `agents/`, `core/`, `data_source/`, `data_structure/`, `data_storage/` — all carry `paths:` frontmatter for path-scoped injection (verified via `spec_match.match_specs_for_file`).
- **Created** root cross-cutting files: `index.md` (nav), `architecture.md`, `logging.md`, `error-handling.md`, `testing.md`.
- **Rewrote** both guides (`cross-layer-thinking-guide.md`, `code-reuse-thinking-guide.md`) — they were Trellis-internal boilerplate (JSONL events, docs.json, platform templates) with zero project content; now describe real boundaries (akshare DataFrame → positional dataclass → ZODB commit → state string → LLM prompt → UI) and real reuse patterns (agent template, `time_helper`, `constants`).
- **Key non-obvious findings** recorded in specs: positional `*list(row.values())[1:]` column-order coupling; `transaction.commit()` after every ZODB mutation; `bullish_opinions` typed `list` but fed strings (add_messages reducer wraps them — `display.py` reads `[-1].content`); `'%Y%m%d'` report-date string format across the data chain; stale tests `ChinaStock('dummy')`; dead `openpyxl.styles.builtins.output` import; `fetch_stcok_data.py` filename typo (kept).
- Verified: no placeholders, no broken links, layers discovered by `get_context.py --mode packages`, task artifacts validated, product source untouched.

## 2026-08-02 — Spec-system operating knowledge (task 08-02-spec-system-knowledge)

Captured how the spec system itself operates into `.trellis/spec/spec-system.md`:
- Frontmatter contract: first line must be `---`; `name`/`description`/`paths:` keys; malformed `paths:` (scalar where list expected) disables routing for the whole file (warn + skip in `spec_match.py`).
- Glob grammar: repo-relative, `*` per segment, `**` any depth, trailing `/` = `/**`.
- Injection caps from `.trellis/config.yaml`: 9400 chars/file, 9500/event, 2700s refresh; editing a spec re-injects it.
- Discovery: every spec subdir except `guides` is a layer; SessionStart lists `guides/index.md` + each layer's `index.md`; root-level specs need `paths:` + index links (not in SessionStart).
- Code-spec vs guide decision rule; verification commands for spec edits.
- `spec-system.md` self-routes via `paths: .trellis/spec/**` — verified live when the injection hook fired on write. `index.md` now links it from "How Specs Reach You".


