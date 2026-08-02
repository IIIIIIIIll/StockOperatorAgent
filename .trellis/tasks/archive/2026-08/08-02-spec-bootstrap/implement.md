# Implement: Spec Bootstrap Execution Plan

## Steps

1. **Write `.trellis/spec/index.md`** — top-level navigation listing all layers + cross-cutting files.
2. **Write `.trellis/spec/architecture.md`** — runtime layers, data flow chain, entry points (`main.py`, `streamlit run`), config (`.env` DASHSCOPE_API_KEY, `utils/constants.py`), utils conventions (State/time_helper/constants), known quirks.
3. **Write `.trellis/spec/agents/index.md`** — uniform agent class pattern (constructor signature, prompt | llm, node method, state update contract), prompt conventions in `core/llms/prompt.py`, QwenApi config, State TypedDict contract.
4. **Write `.trellis/spec/core/index.md`** — DataAcquisition lifecycle (overview/historical/performance), InvestmentCommittee graph wiring, StockOutputFormatter, Streamlit UI + progress_updater protocol.
5. **Write `.trellis/spec/data_source/index.md`** — AKShareSource method wrappers, DataFrame→dataclass positional mapping (`*list(row.values())[1:]`), column-order coupling.
6. **Write `.trellis/spec/data_structure/index.md`** — `@dataclass` + `persistent.Persistent` + numpy field types, ChinaStock behavior (PersistentList, dedupe, `transaction.commit()`).
7. **Write `.trellis/spec/data_storage/index.md`** — ZODBStorageInstance (FileStorage, OOBTree keyed by ticker, overview freshness gate, commit on write).
8. **Write `.trellis/spec/testing.md`** — pytest layout (`testpaths = test`), class-based naming, smoke/integration style, live-API caveats, stale-test warning.
9. **Write `.trellis/spec/logging.md`** — loguru conventions: `{}` placeholders (never f-strings), level usage, handler config in `main.py`.
10. **Write `.trellis/spec/error-handling.md`** — return-False + logger.error pattern, `raise Exception` for missing stock, no custom exceptions, LLM error surfacing.
11. **Tailor guides** — `cross-layer-thinking-guide.md` boundaries to real layers (akshare→dataclass positional mapping, ZODB commit, LangGraph state keys, Streamlit); `code-reuse-thinking-guide.md` triggers to real repeated patterns (agent class template, positional construction, business-day logic).
12. **Delete `.trellis/spec/backend/`** (5 template files).

## Validation

- `grep -R "To be filled\|TBD\|placeholder\|To fill" .trellis/spec` → no matches
- `python3 .trellis/scripts/get_context.py --mode packages` → lists new layers (agents, core, data_source, data_storage, data_structure)
- `python3 .trellis/scripts/task.py validate .trellis/tasks/08-02-spec-bootstrap` → clean
- Check all internal links in `index.md` files resolve to existing files
- `git status` — only `.trellis/` (and task artifacts) changed; product source untouched

## Rollback Points

- After each spec file: content is standalone; delete it to revert.
- Before step 12: `backend/` files still exist; restore by moving them back.
