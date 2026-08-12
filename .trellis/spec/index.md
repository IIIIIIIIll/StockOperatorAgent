---
description: Top-level navigation for StockOperatorAgent coding guidelines
---

# StockOperatorAgent Coding Guidelines

Project-specific guidance for working in this repository: a Streamlit + LangGraph
multi-agent A-share analysis system (akshare data → ZODB persistence → Qwen LLM
agents → Streamlit UI).

## Layers

| Layer | Directory | Guideline | When to read |
|-------|-----------|-----------|--------------|
| Agents | `agents/`, `core/llms/` | [agents/index.md](./agents/index.md) | Adding or editing an LLM agent, prompt, or the LangGraph State |
| Core orchestration | `core/` (except `core/llms/`) | [core/index.md](./core/index.md) | Editing data acquisition, the committee graph, output formatting, or the Streamlit UI |
| Data source | `data_source/` | [data_source/index.md](./data_source/index.md) | Editing akshare wrappers or DataFrame→dataclass construction |
| Data structures | `data_structure/` | [data_structure/index.md](./data_structure/index.md) | Adding persistent dataclasses or editing `ChinaStock` |
| Data storage | `data_storage/`, `database/` | [data_storage/index.md](./data_storage/index.md) | Editing ZODB access or transaction patterns |
| TS 侧移植 | `ts/` | [ts/index.md](./ts/index.md) | Editing the TS port (web/RN): event protocol, streaming, LLM retry, same-origin proxies |

## Cross-Cutting

| Topic | Guideline |
|-------|-----------|
| Architecture overview, data flow, config, utils | [architecture.md](./architecture.md) |
| Logging (loguru) | [logging.md](./logging.md) |
| Error handling | [error-handling.md](./error-handling.md) |
| Testing | [testing.md](./testing.md) |
| Thinking guides | [guides/index.md](./guides/index.md) |

## How Specs Reach You

Layer specs carry `paths:` frontmatter. Touching a matching file (Read/Edit/Write)
injects the governing spec into the session — for example, editing
`agents/chinese_mainland/trend_analysis_expert.py` surfaces `agents/index.md`.
Read this index first when starting any coding task, then the layer spec for the
package you are about to touch.

**Editing a spec file?** Read [spec-system.md](./spec-system.md) first — it
documents the frontmatter routing contract, injection caps, and layer-discovery
rules so spec edits never silently break injection.

**Language note**: UI strings and LLM prompts are written in Chinese
(`core/ui/display.py`, `core/llms/prompt.py`, agent query templates); code
identifiers and comments are English. Specs are written in English.
