# Design: Spec Tree Layout

## Decisions

1. **Replace `backend/` layer with package-scoped layers.** The codebase has no frontend/backend split; it has real ownership boundaries (agents, core, data_source, data_structure, data_storage). `_scan_spec_layers` (`.trellis/scripts/common/packages_context.py:30`) treats each subdirectory of `.trellis/spec/` (except `guides`) as a layer, and the session-start hook lists each layer's `index.md` — so layers are free-form directory names.

2. **Cross-cutting topics are root-level files with `paths:` frontmatter**, not layers: `architecture.md` (layers + data flow + utils + config), `logging.md` (loguru), `error-handling.md`, `testing.md`. Path-scoped injection (`spec_match.py`, `match_specs_for_file` scans `.trellis/spec/**/*.md`) routes them to the files they govern; they don't need to be browsable layers.

3. **Spec files carry `paths:` frontmatter** (block-list form) so editing e.g. `agents/chinese_mainland/trend_analysis_expert.py` auto-injects `agents/index.md`. Keep each spec under ~9400 chars (`spec_injection.max_spec_chars` in `.trellis/config.yaml`) so it injects in full.

## Final Spec Tree

```
.trellis/spec/
  index.md                      # top-level navigation
  architecture.md               # layers, data flow, entry points, config/.env, utils, known quirks
  logging.md                    # loguru conventions (cross-cutting)
  error-handling.md             # error propagation conventions (cross-cutting)
  testing.md                    # pytest conventions
  agents/index.md               # LangGraph agent pattern, prompts, QwenApi, State contract
  core/index.md                 # DataAcquisition, InvestmentCommittee, StockOutputFormatter, Streamlit UI
  data_source/index.md          # AKShareSource wrappers, DataFrame→dataclass positional mapping
  data_structure/index.md       # persistent dataclasses, numpy types, ChinaStock behavior
  data_storage/index.md         # ZODB FileStorage, transaction.commit, freshness gate
  guides/cross-layer-thinking-guide.md   # tailored to real boundaries
  guides/code-reuse-thinking-guide.md    # tailored to real repeated patterns
  guides/index.md               # kept, table stays valid
  backend/                      # DELETED (5 template files)
```

## Paths Routing Map

| Spec | `paths:` globs | Rationale |
|------|----------------|-----------|
| architecture.md | `main.py`, `utils/**`, `.env.example`, `README.md` | entry point, shared utils, config |
| logging.md | `main.py`, `core/**`, `agents/**` | loguru handler + dominant call sites |
| error-handling.md | `core/data_acquisition.py`, `core/llms/tools/**`, `data_source/**`, `data_storage/**` | where failure patterns live |
| testing.md | `test/**`, `pytest.ini` | test conventions |
| agents/index.md | `agents/**`, `core/llms/**`, `utils/state.py` | agent pattern + its LLM/State deps |
| core/index.md | `core/data_acquisition.py`, `core/investment_committee.py`, `core/stock_output_formatter.py`, `core/ui/**` | exact files, avoids overlap with `core/llms/**` |
| data_source/index.md | `data_source/**` | akshare wrappers |
| data_structure/index.md | `data_structure/**` | persistent dataclasses |
| data_storage/index.md | `data_storage/**`, `database/**` | ZODB + its file |

Overlapping globs (e.g. `main.py` in architecture + logging) are handled by the injection system (specificity ordering + per-event char cap).

## Source Evidence Per Spec

- **agents**: `agents/chinese_mainland/*.py` (5 near-identical classes), `core/llms/prompt.py`, `core/llms/qwen/qwen_api.py`, `utils/state.py`, `test/integration/test_basic_graph.py`
- **core**: `core/data_acquisition.py`, `core/investment_committee.py`, `core/stock_output_formatter.py`, `core/ui/display.py`, `core/llms/tools/get_company_info.py`
- **data_source**: `data_source/chinese_mainland/akshare/fetch_stcok_data.py`, `test/data_source/test_akshare.py`
- **data_structure**: `data_structure/chinese_mainland/*.py`
- **data_storage**: `data_storage/chinese_mainland/ZODBStorage.py`, `utils/constants.py`, `test/data_storage/test_ZODBStorage.py`
- **testing**: `pytest.ini`, all of `test/`
- **logging**: `main.py`, every module (`logger.info/debug/error("{}", ...)`)
- **error-handling**: `core/data_acquisition.py` (return-False pattern), `core/llms/tools/get_company_info.py` (raise Exception), `test/core/llms/qwen/test_qwen_api.py` (try/except around LLM)

## Documented Quirks (spec content, not fixes)

- Filename typo `fetch_stcok_data.py` (keep — renaming breaks imports)
- Dead import `from openpyxl.styles.builtins import output` in `core/stock_output_formatter.py:1` (name shadowed by local var)
- Stale tests: `ChinaStock('dummy')` in `test/data_structure/test_ChinaStock.py` and `test/data_storage/test_ZODBStorage.py` (constructor requires 3 args)
- `bullish_opinions`/`bearish_opinions` are declared `Annotated[list, add_messages]` in State but agents return strings; `add_messages` wraps them — `display.py` reads `[-1].content`
- Literal `${state[...]}` in some agent query templates (copy-paste artifact, renders literally)
