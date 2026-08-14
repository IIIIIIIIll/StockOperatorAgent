---
description: Top-level navigation for StockOperatorAgent coding guidelines
---

# StockOperatorAgent Coding Guidelines

Project-specific guidance for working in this repository: a single TypeScript
implementation — Expo web/RN app + Node server (event protocol, streaming, LLM
retry, same-origin proxies). The old Python layer specs (agents/core/data_source/
data_storage/data_structure) are historical archives from the phased-out Python
implementation.

## Layers

| Layer | Directory | Guideline | When to read |
|-------|-----------|-----------|--------------|
| Historical Python layers (archived) | `agents/`, `core/`, `data_source/`, `data_storage/`, `data_structure/` | [agents](./agents/index.md) · [core](./core/index.md) · [data_source](./data_source/index.md) · [data_storage](./data_storage/index.md) · [data_structure](./data_structure/index.md) | Historical only — Python code deleted in phaseout; read for design lineage, not as a live contract |
| TS implementation | `ts/` | [ts/index.md](./ts/index.md) | Editing the TS implementation (Expo web/RN + Node server): event protocol, streaming, LLM retry, same-origin proxies |

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
`ts/src/agents.ts` surfaces `ts/index.md`.
Read this index first when starting any coding task, then the layer spec for the
package you are about to touch.

**Editing a spec file?** Read [spec-system.md](./spec-system.md) first — it
documents the frontmatter routing contract, injection caps, and layer-discovery
rules so spec edits never silently break injection.

**Language note**: UI strings and LLM prompts are written in Chinese
(`ts/app/screens/DataScreen.tsx`, `ts/src/prompt.ts`, agent query templates);
code identifiers and comments are English. Specs are written in English.
