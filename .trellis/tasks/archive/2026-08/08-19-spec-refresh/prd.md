# Refresh Trellis Specs

## Goal

Refresh `.trellis/spec/` so it describes the repository as it exists today.
The spec tree is already project-specific and mature (TS layer is the live
contract; Python layers are archived history). This pass verifies accuracy
against the current codebase, fixes drift, and closes coverage gaps.

## Scope

- Spec directory: `.trellis/spec/` (all files)
- Source to verify against: `src/`, `app/`, `desktop/`, `test/`, `tools/`,
  `.github/workflows/`, root configs (`package.json`, `tsconfig.json`)
- Cross-cutting: `architecture.md`, `logging.md`, `error-handling.md`,
  `testing.md`, `spec-system.md`, `guides/`
- Archived layers: `agents/`, `core/`, `data_source/`, `data_storage/`,
  `data_structure/` (annotate as historical; verify remaining Python code
  matches the "deleted in phaseout" claim — e.g. `data_source/chinese_mainland/`)
- Out of scope: modifying product source code; rewriting specs from scratch

## Architecture Context

Single-repo, two runtimes:

- Root TS package `soa-ts-prototype` — Node server: LLM agents (langchain),
  event protocol, streaming, proxies (same-origin), TDX market data
  (`node-tdx-market`), sqlite/file/IDB storage, committee, switches, tools.
  Tested with vitest (`test/*.test.ts`, incl. `architecture.test.ts`).
- `app/` — Expo web/RN client (`App.tsx`, `lib/`, `server.mjs`, `android/`)
  with EXPO_PUBLIC_* compile-time env vars (secret-rotation note in recent
  commits).
- `desktop/` — Electron wrapper (`main.mjs`, `preload.cjs`, `child.mjs`).
- `tools/` — probes/build scripts; `.github/workflows/` — CI incl. android
  APK+AAB jobs; `docs/` — privacy policy etc.
- Recent commits touch CI (android bundling), data ignore patterns, spec
  notes on EXPO_PUBLIC_* keys, desktop deb metadata.

## Files To Create Or Update

- `.trellis/spec/ts/index.md` — refresh against current `src/`/`test/`/`tools/`
- Root specs (`architecture.md`, `logging.md`, `error-handling.md`,
  `testing.md`) — verify claims still hold (loguru vs TS log, electron, CI)
- `.trellis/spec/spec-system.md` + `index.md` — consistency of file set,
  frontmatter `paths:` routing, internal links
- Archived layer specs — only if the archive annotation is factually wrong
- `guides/*` — verify still accurate, no placeholder

## Rules

- Back every rule with a real file path or repeated local pattern.
- Use source-backed evidence, not template boilerplate.
- Do not change product source code.
- Keep each spec under ~9.4k chars so injection is not truncated
  (see `spec-system.md`).
- Index files must match the final spec file set.

## Acceptance Criteria

- [ ] `.trellis/spec/` describes the repo as it exists now (verified against
      current source; drift fixed)
- [ ] Each live layer has practical coding guidance with real examples
- [ ] Archived Python layers correctly marked historical; no stale claims
- [ ] No placeholder text: `grep -rni "to be filled\|tbd\|placeholder" .trellis/spec` clean
- [ ] Frontmatter parses; `paths:` routing works; `get_context.py --mode packages`
      lists exactly the intended layers
- [ ] Internal links resolve; `index.md` files match final spec file set
