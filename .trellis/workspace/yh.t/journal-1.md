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


