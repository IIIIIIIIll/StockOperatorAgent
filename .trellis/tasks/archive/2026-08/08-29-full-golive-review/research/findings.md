# Full Pre-Go-Live Code Review — Findings (2026-08-29)

Task: `.trellis/tasks/08-29-full-golive-review`. Method: 5 parallel
read-only subagents (security-reviewer ×1, reviewer ×2, trellis-check ×2)
+ main-session real gate runs + main-session spot verification of
highest-risk surfaces and re-verification of every surprising claim
(~35% AI-review false-positive budget per `.trellis/spec/guides/index.md`).
Fresh pass: prior 08-27 closure tables used as context only; every area
re-examined at HEAD (d4f869b) from first principles.

## Verdict

**READY for go-live — 0 blockers.** All quality gates green, security pass
clean (no new vulnerability), client/core layers correct, release
coherence holds. 2 should-fix items (docs/UI-copy, non-blocking) + 1
process prerequisite (S4 keystore rotation, unchanged from 08-27) + 13
notes.

## Quality gates (real runs, HEAD d4f869b)

| Gate | Result | Evidence |
|------|--------|----------|
| `npx vitest run` | PASS | 56 files: 55 passed / 1 skipped; **666 passed / 1 skipped** (baseline ≥666) |
| `npx tsc --noEmit` | PASS | 0 errors |
| `npm run chart:build && chart:check` (app/) | PASS | `chart:check:OK —— 生成物与源模板一致`; F31 mirror intact, no dirty diff |
| `git status --porcelain` | clean | only untracked review task dir |

## Dimension verdicts

### 1. Security (security-reviewer, SecReview)

**0 new vulnerabilities.** All 8 surfaces examined from first principles:

- **SSRF**: `isPrivateAddress` (proxies.cjs:59-124) re-audited line-by-line —
  IPv4 blocklist (0/8, 10/8, 127/8, 100.64/10 CGNAT, 169.254/16 incl.
  metadata, 172.16-31/12, 192.168/16, 198.18/15) complete; IPv6 covers
  ::/::1, fe80::/10, fc00::/7 ULA, IPv4-mapped both dotted AND hex forms
  (std `::ffff:0:0/96` + tolerant `::ffff:0:X:Y` + full-form
  `0:0:0:0:0:ffff:X` incl. dotted-quad tail), tunnels 2002::/16,
  2001::/32, 2001:db8::/32, 64:ff9b::/96, without over-blocking public
  2001:4860::. **No bypass in the mapped/tunnel family**; regression tests
  proxies.test.ts:458-509 cover every fixed form + public forms.
- **M2 redirects**: `redirect:'manual'`, per-hop location re-resolution +
  `pinPublicHost` on hostname change, ≤5 hops, all break paths → uniform
  502 JSON (proxies.cjs:213-247). Verified by main session too.
- **S6 token gate**: requireToken derived from effective bind
  (`createAppServer({host})`, server.mjs:180-201); 401 JSON with
  SEC_HEADERS; Authorization slot NOT consumed (stays LLM-key). All 6
  client call sites wire X-SOA-Token conditionally on
  `EXPO_PUBLIC_SOA_ACCESS_TOKEN` (webCollect.ts:107-114,
  webYahooCollect.ts:67-78, webSearch.ts:78-85, log.ts:90-104,
  llm.ts:61-76, settings.ts:184-194), each with dedicated tests;
  X-SOA-Token provably stripped before upstream (forwardOpts whitelist
  proxies.cjs:200-207, test proxies.test.ts:299-318). Verified by main
  session.
- **CSP/headers**: identical SEC_HEADERS both surfaces incl.
  frame-ancestors 'self', nosniff, cache control. Verified by main
  session.
- **Electron**: contextIsolation+sandbox, nodeIntegration off, devTools
  off packaged, will-navigate preventDefault, window-open deny, IPC = 4
  channels with store-op whitelist + arg gate, child spawn argv-not-env,
  explicit loopback host override immune to ambient HOST. Verified by main
  session (child.mjs:193-198).
- **CI**: all 5 SHA pins verified equal to upstream v-tag commits; signing
  tool error paths emit env names/lengths only; keystore/properties 0600;
  least-scope permissions.
- **Key material**: release.keystore + .env (root AND app) untracked +
  gitignored; .env.example all-empty/commented (verified by main session);
  probe-output/ gitignored; skills-lock.json hashes only; no hardcoded
  secrets in tracked code.

Findings: 1 medium (process) + 4 informational (below).

### 2. Core business layer (reviewer, CoreReview)

**0 findings.** Store family close/drain matches comments exactly (F10
drain, post-close fail-fast; verified by main session store-file.ts:190-201
vs IdbStore), SQLite F11 dedup baseline consistent across all four
families, storeOps IPC arg gates, store-node type-only (assertion 3). Event
protocol C2 synchronous-set guard with reset on done/catch; F01 re-entry
guard + finally-reset (main-session verified). Data chains: qfq cumulative
factor, xdxr/F10 protocol, Yahoo F06 annual-rates first-wins dedup,
prevClose derivation, crumb 401 self-heal, market/unit/currency per specs.
LLM/agent layer: no API-key leakage to logs; retry/timeout/abort;
provider-agnostic single construction point. Chart math: paneTops mirrors
embedded HTML renderer. All 7 architecture assertions source-verified.
3 near-misses assessed non-qualifying (retry regex over-match on
status-400-with-timeout-message; empty bars on error-shell window; busy
banner not cleared by later done) — Python-port parity / degenerate-only /
unreachable.

### 3. Client layer (reviewer, ClientReview)

**0 blockers / 0 should-fix / 3 notes.** F01 guard, S7/#100 masking, S6
wiring, D9/D15/#96, desktop write-through queue, sendSync cold-path
discipline — all verified intact.

### 4. Desktop + tools + CI/release (trellis-check, ReleaseCheck)

**READY — 1 should-fix (docs) / 7 notes.** Version coherence: app/
desktop/app.json all 0.1.4 = tag v0.1.4 (fc583a0); tag..HEAD = task
archive + journal only, zero product diff (main-session verified: root
package.json 1.0.0 is benign/unconsumed). Packaging contract HOLDS
(electron-builder.yml mirrors repo root; all relative resolutions
verified; zero native modules in packaged graph; asar:false +
npmRebuild:false). CI healthy (5 SHA pins verified, expo export before
builder, version gates, android signing injection clean). Note F-8: root
version 1.0.0 ≠ 0.1.x, benign but undocumented.

### 5. Tests + hygiene (trellis-check, TestHygiene)

**0 blockers / 0 should-fix / 6 notes.** All 7 architecture assertions
present + source-verified (table in agent output). NO tautological tests in
~25-file sample; all would fail if feature deleted. Default suite fully
offline (fetch injected, fake timers with pinned dates); live suite behind
skipIf(!LIVE). No it.only/skip/todo committed. Recent-fix boundary
coverage COMPLETE: SSRF mapped-IPv6 (proxies.test.ts:492-508), X-SOA-Token
wiring (all 6 sites + server gate matrix server-static.test.ts:137-240 +
strip test), M2 502 paths (proxies.test.ts:252-296), CSP frame-ancestors
(both surfaces pinned). Debris scan clean; gitignore hygiene correct.

## Findings (post-review residual)

### should-fix

| # | Finding | Evidence | Next step |
|---|---------|----------|-----------|
| SF-1 | **README omits shipped HK/US (Yahoo) feature family; TODO stale** — README 数据源 covers only TDX/亿信/联网搜索, zero mentions of yahoo/港股/美股 (grep = NONE); yet src/yahoo/* are live, market.ts:12-13 exposes labels, probe.mts dispatches hk/us, SettingsPanel references them. TODO (3 lines) lists HK/US as future work — both implemented. [Main-session correction: TODO is gitignored (line 15, LIVE entry — agent's "tracked/dead entry" claim wrong); file content still stale.] | README.md; TODO; src/market.ts:12-13 | Update README 数据源/功能 with Yahoo HK/US chain; delete or rewrite TODO |
| SF-2 | **SettingsPanel copy-vs-persistence contradiction** — 能力开关/调用上限 labeled 会话级 "重新加载后恢复默认" (SettingsPanel.tsx:156-159,173-176), but every toggle persists the FULL SettingsState (switches+caps) via saveSettings → reload restores them. One of the two is unintended. | app/screens/SettingsPanel.tsx:156-176; app/lib/settings.ts | Pick semantics; make copy+behavior agree (one-line either side) |

### medium (process, unchanged from 08-27)

| # | Finding | Evidence | Next step |
|---|---------|----------|-----------|
| SEC-S4-001 | **S4 keystore rotation unexecuted** — root .env (untracked/gitignored, correct hygiene) holds live secrets incl. full keystore with `ANDROID_KEYSTORE_PASSWORD == ANDROID_KEY_PASSWORD` (88c283...; main-session verified). rotation-checklist.md requires distinct ≥32-char passwords + propagation (.env + ~/.soa-android-env.sh + 4 GH secrets) before first signed build. Tooling consuming them verified clean; no code change needed. | .env; .trellis/tasks/archive/2026-08/08-27-golive-fix-backlog/research/rotation-checklist.md | Execute rotation on release machine before first signed release; verify fingerprint of first signed APK |

### notes

| # | Finding | Evidence | Next step |
|---|---------|----------|-----------|
| N-1 | **Stale console-message listener breaks renderer console relay on Electron 43** — main.mjs:296-298 uses positional (event, level, message); Electron 43.4.0 typings emit (event, messageDetails) (electron.d.ts:12267-12271, main-session verified). Packaged builds disable DevTools → this relay is the only diagnostics channel in the field. | desktop/main.mjs:296-298 | `win.webContents.on('console-message', (_e, { level, message }) => ...)` |
| N-2 | **Bootstrap-vs-start interleave** — F01 guard (analysisController.ts:294) covers start-vs-start only; bootstrap() awaits storeReady() then unconditionally restores lastRun cache into shared state (events/statuses/hasDone, :228-252). start() while storeReady pending → bootstrap's restore pollutes the in-flight run's events with previous session's reports (widest on warm desktop stores). Main-session verified: UI start button disabled only by a.running, no bootstrap gate. Carried-over pre-extraction behavior; contradicts F01's no-interleave claim for this dimension. | app/lib/analysisController.ts:210,228-252,294,337 | Skip restore block when s.running (start precedence), or start() awaits bootstrap promise |
| N-3 | **No ErrorBoundary anywhere in app/** — render throw in ReportContent (LLM markdown) / charts unmounts whole tree (blank web / crash native), no recovery affordance. | app/App.tsx:285-295 | Add small ErrorBoundary around content area (error text via src/log.ts + retry) |
| N-4 | **Desktop job version gate checks only desktop/package.json** — full 3-file check lives in android job; tag with desktop=0.1.5/app=0.1.4 would publish desktop installers embedding stale web bundle while android job fails. | .github/workflows/release.yml (desktop job ~:40-55 vs android ~:96-118) | Mirror 3-file check into desktop job |
| N-5 | **macOS window-close quits whole app** — 'window-all-closed' → shutdownChild → app.quit(); no 'activate' handler; deviates from platform convention (undocumented). | desktop/main.mjs:329-330,169-183 | Gate on platform !== 'darwin' + add activate re-create, or document |
| N-6 | **README Node-version guidance imprecise** — says ≥22 and runs `node server.mjs` flagless; server.mjs:13 imports TS (strip-types flagless only on ≥23.6; Node 22 needs --experimental-strip-types). | README.md; app/server.mjs:13 | Say Node ≥23.6 or flag the command |
| N-7 | **privacy-policy.md §5 claims permissions app doesn't request** — POST_NOTIFICATIONS + FOREGROUND_SERVICE_DATA_SYNC; app.json has no android.permissions, no expo-notifications dep, zero notification code. | docs/privacy-policy.md §5; app/app.json | Align before Play submission (implement or trim §5) |
| N-8 | **.env.example missing SOA_LOG_DIR** — logs-server.cjs:31 consumes it; every other server knob documented. | app/lib/logs-server.cjs:31; .env.example | Add commented entry |
| N-9 | **Root package.json version 1.0.0 ≠ 0.1.x** — benign (not in gates, not consumed), undocumented. | package.json:3 | Add comment or align |
| N-10 | **allowScripts {"**": true} + floating ^ ranges** — permissive supply-chain posture; no known-risky dep; lockfiles committed (pre-existing, documented 08-27). | app/package.json:37-38; root/desktop package.json | Narrow allowScripts; consider pinning electron-builder |
| N-11 | **DNS TOCTOU residual (documented-accepted)** — pinPublicHost validates then fetch re-resolves; flip window needs attacker-controlled DNS through Origin/A6/SSRF gates; undici global fetch ignores lookup injection (proxies.cjs:127-136 comment). Informational. | app/lib/proxies.cjs:127-136 | Keep documenting; optional undici Agent with lookup when local dep exists |
| N-12 | **IPv4-compatible ::/96 (RFC 4291 deprecated) not blocklisted** — ::7f00:1 expands to 0000:...:7f00:0001, classified public (main-session verified); modern stacks don't route it → non-exploitable today; theoretical. | app/lib/proxies.cjs:59-124 | If a platform ever routes ::/96 as embedded IPv4, extend mappedLoose check |
| N-13 | **Stale/historical .gitignore entries** — Python/ZODB-era patterns + 'developing-with-streamlit' + (per SF-1) TODO is LIVE not dead. Harmless. | .gitignore | Optional cleanup |

## S4 rotation status

Unchanged from 08-27: checklist artifact exists and is substantive
(8 sections); **execution on the release machine is the single open
pre-go-live prerequisite**. Keystore + passwords live only in local
gitignored .env today; rotation must happen before the first signed build,
with GH secrets propagation, then fingerprint verification of the first
signed APK/AAB.

## Pre-go-live checklist (blockers first)

1. **(process)** Execute S4 keystore rotation per rotation-checklist.md on
   the release machine before first signed build (distinct ≥32-char
   passwords; propagate to .env + ~/.soa-android-env.sh + 4 GH secrets;
   verify fingerprint).
2. (should-fix, docs) SF-1: README Yahoo HK/US feature family + stale TODO
   rewrite.
3. (should-fix, UI copy) SF-2: SettingsPanel 会话级 copy vs persistence
   contradiction — pick one semantics.
4. (notes, optional) N-1 Electron console-message one-liner (worth doing:
   only field diagnostics channel) · N-2 bootstrap/start precedence ·
   N-3 ErrorBoundary · N-4 desktop job version gate · N-5 macOS dock
   persistence · N-6 README Node version · N-7 privacy-policy permissions ·
   N-8 SOA_LOG_DIR doc · N-9/N-10/N-11/N-12/N-13 optional hygiene.
