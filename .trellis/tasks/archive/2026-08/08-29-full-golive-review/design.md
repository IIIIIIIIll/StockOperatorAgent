# Design: Full Pre-Go-Live Code Review (fresh pass)

## Review architecture

Single parallel wave of read-only subagents (5) + main-session gate runs.
Every subagent gets: task path, repo map, spec list, prior-research context
paths (context only — NOT acceptance), evidence contract, and the
false-positive verification rule. All subagents READ-ONLY: no edits, no
full-suite validation runs (gates belong to main session).

### Subagent map

| # | Agent | Dimension | Scope | Output contract |
|---|-------|-----------|-------|-----------------|
| 1 | security-reviewer | Security (full repo) | server.mjs, proxies.cjs, logs-server.cjs, Electron main/preload/child, CI workflows, .env.example, env.ts, dependency manifests, release.keystore/.env presence | Severity-ranked findings: blocker/should-fix/note + file:line + next step |
| 2 | reviewer | Core business layer | src/** (48 files): events, agents, committee, pipeline, retry, toolLoop, progress, store×4, gates, lastRun, collector, tdx/**, yahoo/**, finnhub, market, chartLayout/chartData/indicators, llm, webSearch, mcp, billions, overview, reports, f10, adjust, format, env, metaKeys, log, switches | Same + spec pre-check violations (architecture.test.ts 7 assertions, log/metaKeys/env conventions) |
| 3 | reviewer | Client layer | app/** (App.tsx, hooks, components, screens, lib/* except CJS servers): runner, analysisController, settings/settingsStore, desktopBridge, deviceBridge, collectorSelection, polyfill/shim family | Same + RN/web parity risks, state-machine re-entry/abort correctness |
| 4 | trellis-check | Desktop + tools + CI/release | desktop/**, tools/**, .github/workflows/**, root+app+desktop package.json/app.json version coherence, README/docs claims vs tree, probes output anchors | Version coherence table, CI health, docs-vs-tree drift, packaging layout contract check |
| 5 | trellis-check | Tests + hygiene + spec conformance | test/** (56 files), TODO/FIXME/stub/debug/dead-code scan, probe-output/, .gitignore, spec conformance of reviewed changes | Test meaningfulness (tautology check), debris list, architecture.test.ts assertion source check |

### Gate runs (main session, real commands)

1. `npx vitest run` — expect ≥666 pass / 0 fail.
2. `npx tsc --noEmit` — expect 0 errors.
3. `npm run chart:build && npm run chart:check` (cwd app/) — expect pass +
   no dirty diff (F31 mirror).
4. `git status --porcelain` after gates — expect clean (except task dir).

Gates fire as background jobs while subagents work; results merged into
findings.

### Context contract

- Every claim needs file:line or command-output evidence. Cross-layer /
  cross-file claims verified before reporting.
- Prior research (08-27 findings.md/closure.md, fix-backlog.md) is
  **context**: tells reviewers where known bugs were and what fix shapes
  look like — but every area is re-examined at HEAD independently.
- ~35% AI-review false-positive budget per guides; main session re-checks
  all blocker/should-fix claims against actual code.
- No "user input is malicious" false alarms for trusted internal data; no
  flagging intentional design documented in comments/specs.

## Output shape

- `research/findings.md` — dimensioned findings + gate results + S4 status.
- Chat: verdict (READY/NOT-READY) + prioritized go-live checklist.
