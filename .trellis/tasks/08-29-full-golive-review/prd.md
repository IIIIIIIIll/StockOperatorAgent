# PRD: Full Pre-Go-Live Code Review (fresh pass)

## Goal

A **fresh, independent, evidence-backed full-repo review** of the current
working tree before go-live. Unlike `08-27-final-golive-review` (which
verified closure of the 78-item remediation backlog), this pass does **not
rely on prior closure tables**: every dimension scans the tree at HEAD
(d4f869b) from first principles, with prior review research used only as
context/known-areas checklist.

Review-only task. No product code changes; findings that require fixes
become follow-up tasks (or are fixed in a separate pass only if blocking
and user approves).

## Background

- Repo: TS-only (~42.7k LOC): `src/` (48 files, platform-neutral business
  layer: events/agents/committee/pipeline/retry/toolLoop/progress/store×4/
  gates/collector/metaKeys/log/env/switches/lastRun/chartLayout/chartData/
  indicators/tdx/billions/mcp/webSearch/llm/prompt/adjust/overview/reports/
  f10/format/yahoo/finnhub), `app/` (Expo web/RN client + Node server
  server.mjs + CJS proxies), `desktop/` (Electron shell), `tools/` (6
  probes/scripts), `test/` (56 vitest files).
- Tag **v0.1.4** at fc583a0 (fix pass); HEAD d4f869b = tag + archive
  commits only (no product diff). Working tree clean at task start.
- 08-27 final review verdict: READY, 0 blockers; 4 should-fix + 10 notes
  fixed in commit fc583a0 (SSRF mapped-IPv6, S6 X-SOA-Token client wiring,
  M2 502-on-exhaust, CSP frame-ancestors, version bump, docs nits).
  Remaining: **S4 keystore rotation execution** (process-only, on release
  machine).
- This task re-checks all of that from scratch: nothing is assumed fixed
  because a commit message says so.

## Review dimensions

1. **Security pass (full repo)** — server.mjs/proxies.cjs/logs-server.cjs
   SSRF, token gate (S6 wiring correctness), CSP/headers, Electron shell
   invariants (main/preload/child), CI secrets handling (SHA pins, key
   material), .env/EXPO_PUBLIC handling, dependency supply-chain posture,
   stale secrets/keys in tree (release.keystore, .env presence).
2. **Core business layer** (`src/`) — correctness of committee/pipeline/
   retry/toolLoop/events protocol, store×4 persistence contracts
   (sync StoreLike, close/drain), gates/lastRun freshness logic, tdx/
   yahoo/finnhub data chains (qfq/adjust/units), llm/webSearch/mcp/
   billions clients, chartLayout/chartData math, spec pre-checks (log via
   src/log.ts, meta keys via metaKeys.ts, env via src/env.ts, no
   react-native/node imports in src except whitelist).
3. **Client layer** (`app/`) — App.tsx + hooks/components/screens,
   runner/analysisController state machine (re-entry guard, abort,
   progress/streaming), settings store, desktop bridge, RN/web parity
   (polyfill/shim boundaries), collectorSelection, device vs web paths.
4. **Desktop + tools + CI/release** — desktop main/preload/child
   lifecycle (spawn, shutdown, store mirror), packaging layout contract,
   tools/probes output anchors, release.yml/ci.yml health (SHA pins,
   version gates, artifact names), version coherence
   (root/app/desktop/app.json ↔ tag v0.1.4), README/docs claims vs tree.
5. **Tests + hygiene** — test meaningfulness (would they fail on a
   plausible bug? tautology check per guides), architecture.test.ts 7
   assertions intact, TODO/FIXME/stub/debug/dead-code debris, probe-output
   artifacts, gitignore correctness.

## Method

Parallel read-only subagents (one per dimension) + main-session real gate
runs. Main session re-verifies every surprising/blocker/should-fix claim
against code before reporting (~35% AI-review false-positive budget per
`.trellis/spec/guides/index.md`). Chart gate runs in main session (mutates
generated assets).

## Acceptance criteria

1. Findings report persisted under this task's `research/` (findings.md),
   dimensioned, each finding with severity (blocker / should-fix / note),
   concrete evidence (file:line or command output), suggested next step.
2. Every blocker/should-fix claim source-verified by main session.
3. Gate results from real runs on this working tree, not assumptions:
   `npx vitest run` (expect ≥666 pass / 0 fail), `npx tsc --noEmit`
   (0 errors), `npm run chart:build && chart:check` (app/, F31 mirror),
   `git status --porcelain` clean (except task dir).
4. Final chat output: verdict (READY / NOT-READY with reasons) +
   prioritized go-live checklist (blockers first), including the
   process-only S4 rotation status.

## Non-goals

- Fixing anything found (follow-up tasks; main session only fixes if user
  approves immediately after review).
- Re-running the 78-item closure table (08-27 task's job; prior research
  files are context only).
- Style/lint nitpicks below "would embarrass a release".
- Re-litigating intentional design documented in code comments/specs.
