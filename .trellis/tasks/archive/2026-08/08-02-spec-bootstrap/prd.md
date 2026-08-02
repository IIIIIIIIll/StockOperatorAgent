# Bootstrap .trellis/spec/ guidelines from codebase

## Goal

Replace all template placeholders in `.trellis/spec/` with source-backed coding guidelines that describe this repository as it exists now: a Streamlit + LangGraph multi-agent A-share analysis system (akshare data → ZODB persistence → Qwen LLM agents → Streamlit UI).

## Scope

- Spec directory: `.trellis/spec/` (existing `backend/` + `guides/` tree)
- Source to inspect: `main.py`, `core/`, `agents/`, `data_source/`, `data_structure/`, `data_storage/`, `database/`, `utils/`, `test/`
- Out of scope: modifying product source code, `.trellis/` scripts/workflow, docs/

## Architecture Context (from repository analysis)

Single Python repo, ~2000 LOC, no packages configured. Runtime flow: `streamlit run main.py` → `core/ui/display.py` (Streamlit) → `core/investment_committee.py` (LangGraph StateGraph, linear: fundamental → trend → bullish → bearish → investment_manager) → agents call Qwen via `core/llms/qwen/qwen_api.py` (DashScope compatible-mode) → `core/llms/tools/get_company_info.py` → `core/data_acquisition.py` (DataAcquisition) → `data_source/chinese_mainland/akshare/` (AKShareSource DataFrames) → positional construction into persistent dataclasses in `data_structure/chinese_mainland/` → persisted via `data_storage/chinese_mainland/ZODBStorage.py` (ZODB FileStorage at `database/china_stock_data.fs`).

Key conventions found:
- All 5 agents follow one uniform class pattern (`__init__(llm, config, progress_updater)` + prompt | llm + node method returning state updates) — see `agents/chinese_mainland/*.py`
- Data classes are `@dataclass` + `persistent.Persistent` with numpy float64/int64 field types — `data_structure/chinese_mainland/`
- DataFrame rows → dataclasses by positional args, `StockOverview(*list(row.values())[1:])` (first column dropped) — `core/data_acquisition.py`, `test/data_source/test_akshare.py`
- `transaction.commit()` after every ZODB mutation — `ChinaStock.py`, `ZODBStorage.py`
- loguru with `{}` placeholders everywhere; rotating handler in `main.py`
- No custom exceptions; `return False` + `logger.error` failure pattern in data layer; single `raise Exception('Stock not found')` in `core/llms/tools/get_company_info.py`
- Chinese UI strings and LLM prompts; English code identifiers; business-day helper `utils/time_helper.py` (weekends only, no holidays)
- Tests: pytest `testpaths = test`, class-based `TestXxx` with smoke/integration style against live APIs and the real ZODB file

## Files To Create Or Update

- Delete `.trellis/spec/backend/` (5 template files — "backend" is not this project's vocabulary)
- `.trellis/spec/index.md` — top-level navigation (new)
- `.trellis/spec/architecture.md` — runtime layers, data flow, entry points, config/.env, utils conventions, known quirks (new)
- `.trellis/spec/agents/index.md` — uniform agent class pattern, prompt conventions, QwenApi, State contract (new)
- `.trellis/spec/core/index.md` — DataAcquisition, InvestmentCommittee, StockOutputFormatter, UI (new)
- `.trellis/spec/data_source/index.md` — AKShareSource wrappers, DataFrame→dataclass positional mapping (new)
- `.trellis/spec/data_structure/index.md` — persistent dataclass conventions, numpy types, ChinaStock behavior (new)
- `.trellis/spec/data_storage/index.md` — ZODB storage + transaction + freshness-gate patterns (new; replaces `backend/database-guidelines.md`)
- `.trellis/spec/testing.md` — test conventions (new)
- `.trellis/spec/logging.md` — loguru conventions (replaces `backend/logging-guidelines.md`)
- `.trellis/spec/error-handling.md` — error propagation conventions (replaces `backend/error-handling.md`)
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — tailor generic boundaries to real layers
- `.trellis/spec/guides/code-reuse-thinking-guide.md` — tailor triggers to real repeated patterns
- Every spec file carries `paths:` frontmatter so path-scoped spec injection routes it to the right files

## Rules

- Adapt the spec file set to the real codebase; delete template-only files that do not apply.
- Use real source examples with file paths; no placeholder text, no generic framework advice.
- Do not modify product source code.
- Specs stay under ~9.4k chars so path-scoped injection can surface them in full.

## Acceptance Criteria

- [ ] `.trellis/spec/` describes the project as it exists now, with real file paths and examples.
- [ ] No placeholder text remains (`grep -R "To be filled\|TBD\|placeholder" .trellis/spec` is clean).
- [ ] `index.md` files match the final spec file set; `get_context.py --mode packages` lists the new layers.
- [ ] Each layer spec has `paths:` frontmatter matching its package directory; `spec_match.py` validation passes.
- [ ] Product source code is untouched (git diff shows only `.trellis/` changes).
