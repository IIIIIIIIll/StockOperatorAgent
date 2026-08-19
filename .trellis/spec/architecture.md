---
description: Architecture — runtime layers, entry points, data flow, config, CI/Android, EXPO_PUBLIC secret handling
paths:
  - app/server.mjs
  - app/App.tsx
  - app/lib/proxies.cjs
  - app/lib/logs-server.cjs
  - app/.env.example
  - desktop/**
  - src/env.ts
  - src/switches.ts
  - .github/workflows/release.yml
  - tools/configure-android-signing.mjs
---

# Architecture

## Runtime Layers

Single repo, pure TypeScript (Python business code deleted 2026-08-14; `main.py` /
`core/` / `agents/` / `data_source/` / `data_storage/` / `data_structure/` /
`utils/` no longer exist). One shared `src/` business layer feeds four runtimes:

```
app/      Expo web + RN client (App.tsx)  +  Node web server (server.mjs)
desktop/  Electron shell (main.mjs) -> self-spawned Node backend (child.mjs)
src/      shared layer: committee, pipeline, events, tools, stores, log, retry, switches
.github/workflows/release.yml   CI: desktop matrix + Android APK+AAB, tag-triggered
```

Per-layer depth lives in [ts/index.md](./ts/index.md) (the live TS contract) and
[index.md](./index.md). This file states the cross-cutting topology only.

## Entry Points

- **`app/server.mjs`** — production web server. Run: `npx expo export --platform web
  && node --experimental-strip-types server.mjs` (default port 8090). `serveStatic`
  serves `app/dist` (decodeURIComponent guarded -> 400, path traversal -> 403, SPA
  fallback to index.html) plus same-origin routes: `POST /llm-proxy/*`,
  `GET /tdx-collect`, `GET /web-search`, `POST /logs`. Listens on `127.0.0.1` by
  default (`HOST` env to expose — SSRF/log-injection surface, keep loopback).
  `createAppServer()` is exported for the desktop main process; `isMain` guard
  keeps import side-effect free (vitest imports it).
- **`app/App.tsx`** — Expo root (web + RN + Android). Pure rendering: `[采集数据]`
  tab + role report tabs, sidebar settings. Analysis orchestration (state, startup
  chain, `runner` subscription, `start`) lives in `app/hooks/useAnalysis.ts`; new
  UI logic goes to `app/hooks/` or `app/components/`, never back into App.tsx.
  LLM 三键 missing -> demo-placeholder banner (`missingLlmKeys`), no crash.
- **`desktop/main.mjs`** — Electron main process: plain JS, zero TS imports.
  Spawns `child.mjs` (`ELECTRON_RUN_AS_NODE=1`, `--experimental-strip-types` via
  argv, not env) which runs `createAppServer()` + `createNodeFileStore` +
  `nodeSettingsFileSystem` + `setLogDir(userData/logs)` on a random loopback port.
  IPC: renderer invoke `store-init` / `store-op` (6-mutator whitelist) /
  `settings-save-async`; `sendSync` `settings-load` is cold-path only (sendSync in
  event handlers deadlocks — proven). Graceful shutdown: main sends shutdown ->
  child flush+close -> quit; SIGTERM/SIGINT route into the same path.

## Data Flow

```
src/env.ts envValue(name)           typeof-process guard, single read point
  -> src/switches.ts setCapabilitySwitches / fromEnv   capability flags (enabled semantics)
  -> src/log.ts                      unified logging (see logging.md)
```

- **Config**: all `process.env` reads in `src/` go through `envValue()`
  (`src/env.ts`); writes are banned (enforced by `test/architecture.test.ts`
  contract 6). `EXPO_PUBLIC_*` must be read by *direct member access*
  (`process.env.EXPO_PUBLIC_X`) — babel-preset-expo inlines only direct access;
  aliasing breaks release builds.
- **Capability switches** (`src/switches.ts`): explicit `setCapabilitySwitches`
  (App settings panel, enabled semantics) or lazy `fromEnv()` fallback (inverse
  polarity: `TDX_MCP_DISABLED` / `WEB_SEARCH_DISABLED` / `BILLIONS_*_DISABLED`;
  unset/empty/'0'/'false'/'no' -> enabled). Consumers read lazily via
  `getCapabilitySwitches()` — never at module level.
- **Same-origin proxies** (`app/lib/proxies.cjs`): one shared implementation for
  the metro dev middleware and the production server (CJS so both `require`/`import`
  it — behavior must not drift). `/llm-proxy` forwards the browser-configured LLM
  base; SSRF guard (C2): scheme http(s) only, no userinfo, DNS-resolved host
  outside private/loopback ranges else 400/403. SSE passthrough must pipe
  `upstream.body` chunk-wise — never `await upstream.text()` (buffering kills
  streaming). Body cap `MAX_BODY_BYTES` = 1MB (raised from 64KB 2026-08-16: real
  terminal-review payload >64KB hit 413). `/tdx-collect`: single-flight mutex +
  45s timeout (504 early, lock held until settle). `/web-search`: DDG, q non-empty
  <=200 chars, no control chars, 20s timeout.
- **Logs**: `POST /logs` handled by `app/lib/logs-server.cjs` (one file, both
  entrances) -> appends `<repo>/logs/soa-ts.log`. See [logging.md](./logging.md).
- **Stores**: one `StoreLike` contract (`src/store.ts` interface; SQLite `Store`
  is Node-only — `better-sqlite3` value-import whitelist). Web = IndexedDB
  (`src/store-idb.ts`); RN = expo-file-system file (`src/store-file.ts`);
  desktop renderer = mirror + write-through queue (`app/lib/desktopBridge.ts`)
  over backend `src/store-node.ts` (the only `node:fs` whitelist in `src/`).
  Mutators are synchronous; persistence runs on a serialized promise chain
  (write-through); failure is logged, never blocks.

## CI / Android

`.github/workflows/release.yml` — `v*` tag push or `workflow_dispatch`:
- **desktop job** (matrix ubuntu/windows/macos, Node 22, bash): root
  `npm ci --omit=dev` -> `app: npm ci && npx expo export --platform web` ->
  `desktop: npm ci && npx electron-builder --publish never`. Tag -> GitHub Release
  upload (exe/AppImage/deb/dmg); dispatch -> Actions artifact.
- **android job** (ubuntu, Node 22 + Java 17 Temurin): `npx expo prebuild
  --platform android --no-install` -> `node tools/configure-android-signing.mjs`
  -> `./gradlew :app:assembleRelease :app:bundleRelease` -> rename
  `soa-<version>.apk` / `.aab` (AAB shares the signing config; APK for sideload,
  AAB for Play). `tools/configure-android-signing.mjs` (pure Node, idempotent):
  secrets `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD` /
  `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` -> release keystore + build.gradle
  patch; missing secrets -> exit 0 no-op (debug-signed fallback); invalid input ->
  non-zero, errors print env names only, never values. `app/android` is prebuild
  output, gitignored.

## EXPO_PUBLIC_* Secrets (compile-time inlined)

`EXPO_PUBLIC_*` values in `app/.env` are **inlined into the JS bundle at build
time** — both `expo export` (web dist) and the Android bundle bake them in, and
the desktop installer ships `app/dist` whole. Treat them as public. Production
builds MUST leave `EXPO_PUBLIC_LLM_*` empty; keys are entered at runtime in the
settings panel (localStorage). If a real key ever lands in a public artifact:
rotate it, then rebuild with `expo export --clear` and delete `/tmp/metro-cache*`
(Metro caches transforms — a hash-identical rebuild reuses the stale bundle).
(`app/.env.example` declares `EXPO_PUBLIC_LLM_API_KEY/MODEL/BASE_URL`,
`EXPO_PUBLIC_TAVILY_API_KEY`, `EXPO_PUBLIC_TDX_HOST`.)

## Known Quirks

- `src/log.ts` must not statically import platform modules — dynamic
  `import('expo-file-system')` only inside the RN branch (see logging.md).
- `app/server.mjs` and `proxies.cjs` / `logs-server.cjs` need Node
  `--experimental-strip-types` for `.ts` requires (node >=23.6 default-on).
- Desktop package layout mirrors the repo root inside `resources/` (see
  ts/index.md) — do not nest `app/` deeper or server/proxies relative
  resolution breaks.

## Anti-Patterns

- Direct `process.env` reads in `src/` outside `envValue()` (EXPO_PUBLIC direct
  access excepted) — architecture.test.ts fails.
- Module-level `getCapabilitySwitches()` evaluation — switches must take effect
  at runtime.
- Two implementations of the same proxy/log endpoint for dev vs prod — always
  one shared CJS file.
- Static `import 'expo-file-system'` / `react-native` / `node:fs` in `src/` —
  pollutes other platforms' bundles (metro/vitest).
