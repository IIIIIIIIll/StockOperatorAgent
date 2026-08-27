# Go-live Readiness Audit — Findings Report (2026-08-26)

Audit task: `.trellis/tasks/08-26-golive-readiness-audit` (PRD). Method: 5 parallel
subagents (prior-findings recovery, code hygiene, security-reviewer, gate runner,
release readiness) + main-session verification of surprising claims (~35%
false-positive budget). Read-only audit; fixes are follow-up tasks.

## Verdict

**No hard blockers found.** All quality gates pass on the current working tree
(`213fe13`), Electron shell is hardened, no secrets are committed, release version
contract (desktop 0.1.3 ↔ tag v0.1.3) holds. **The go-live gap is the unremediated
08-25 audit backlog: 66 findings still open, including 6 majors (F01–F06).**
Recommendation: remediate the majors + selected mediums (see checklist) before
release; the rest as follow-up tasks.

## 1. Quality gates (real runs, working tree at 213fe13)

| Gate | Result | Evidence |
|------|--------|----------|
| `npx vitest run` | PASS | 55 files, 627 passed / 1 skipped (intentional `SOA_LIVE`-gated live probe) |
| `npx tsc --noEmit` | PASS | 0 errors |
| `git status --porcelain` | clean | only untracked audit task dir |
| `npm run chart:build` + `chart:check` | skipped | last 10 commits touch no chart assets (mirror gate N/A) |

## 2. Prior-findings recovery (dim 1) — THE go-live gap

Sources: `08-25-review-findings-audit/research/00-findings.md` (F01–F60, all
CONFIRMED as of 08-25), 08-23/08-22 remediation records, journal sessions 52–54.
Tree delta since audit: journal/archive/version-alignment commits only; no F-item
location touched. All F-items re-verified in current tree.

**Status: 66 STILL OPEN · 46 FIXED · 8 FALSE-POSITIVE · 1 STALE.**

### Majors — 6 open (fix before go-live)

| # | Finding | Evidence | Next step |
|---|---------|----------|-----------|
| F01 | `start()` no re-entry guard; entry unconditionally wipes events/decision/error/statuses/hasDone | app/lib/analysisController.ts:286-297 (verified) | `if (s.running) return` at entry |
| F02 | proxy bodies decoded per-chunk corrupt UTF-8 (`body += chunk`) | app/lib/proxies.cjs:103, 286; logs-server.cjs:70 (verified) | Buffer.concat, decode once (3 sites) |
| F03 | RN log rotation `moveSync` no `overwrite:true` → rotation throws after first .1 file, log dies | src/log.ts:134-142 | `{overwrite:true}` |
| F04 | IdbStore/FileStore memoized ready/db promise caches rejection forever → session-long persistence black hole | src/store-idb.ts:142,152,203-206; store-file.ts:42,93 | clear memo on rejection |
| F05 | DataScreen reports/profit recomputed per render → FinancialTrendChart full rebuild | app/screens/DataScreen.tsx:30-33,43-45 | useMemo([ticker, dataVersion]) |
| F06 | annual statements merged into quarterly pool → YoY/QoQ computed vs annual rows and persisted | src/yahoo/deviceYahooCollect.ts:289-294; composeYahooReports.ts:142-163 | origin-aware rates |

### Medium — 17 open (should-fix soon)

F07 child.mjs startup-window orphan (listeners after awaits, child.mjs:123-188) ·
F08 ops during gracefulShutdown applied-then-dropped (child.mjs:83-93,150-193) ·
F10 FileStore.close drops queue, no closed flag (store-file.ts:174-180) ·
F11 SQLite addDatas dedup baseline mismatch + INSERT OR REPLACE contract break
(store.ts:128-136) · F12 nodeFsAdapter bare catch → null for all fs errors, near-empty
payload overwrite risk (store-node.ts:27-35) · F13 collectViaProxy 200+bad-JSON →
consumer crash (webCollect.ts:94-98,51) · F14 TDX daily dates +1 day on TZ≤UTC-9
(quoteClient.ts:38-39) · F15 ewmAlpha ignore_na≠pandas adjust=False parity
(indicators.ts:17-33) · F16 configure-android-signing escapes only backslash/CR/LF,
non-Latin-1 secrets mojibake (tools/configure-android-signing.mjs:137-140) ·
F18 turnover capital memo deps only [ticker] (DataScreen.tsx:36-39) · F19
checkLlmReachability treats 404 as missing proxy → misdiagnosis (settings.ts:188-191) ·
F20 analysis "today" uses UTC not Beijing date (analysisController.ts:259,391,397) ·
F21 three suites run real external web searches — no offline isolation
(query-content.test.ts:71-77, events.test.ts:65+, runner.test.ts:111-118) · F23
live.integration bare `require` in ESM → ReferenceError, fixture block never runs
(live.integration.test.ts:71) · F28 serveStatic unanchored prefix check (server.mjs:43-48) ·
F29 createReadStream no error handler (server.mjs:52-53) · F45 LANGSMITH_TRACING=true
while comment claims telemetry not wired (env.example:47-50).

### Low/nit — 43 open (batchable)

F09 devtools in packaged app (main.mjs:290-296) · F17 missing-key notice points to
nonexistent section (App.tsx:69-70) · F22 env-restore writes "undefined" (events.test.ts:125-129) ·
F24 llm.test name/assertion contradiction (llm.test.ts:45-47) · F25 double percent-decode
uddg (webSearch.ts:132-134) · F26 toNum('万') bare unit → 0 (f10.ts:17-21) · F27
value_raw undefined on short cells (f10.ts:71-74) · F30 three bare `new URL(req.url)`
can throw through listener (proxies.cjs:197,296,343) · F31 empty-series early return
before legend (chartHtml.ts:86-91, build-chart-view.mts:163-168) · F32 punycode shim no
unicode-dot normalization (punycode-shim.ts:126-133) · F33 zlib-shim incomplete Huffman
tables allowed (zlib-shim.ts:64-70) · F34 MAX_MESSAGE_BYTES counts UTF-16 chars
(logs-server.cjs:96-99) · F35 exhausted US probe throws HK message (deviceYahooCollect.ts:355) ·
F36 `name:${ticker}` meta key outside metaKeys.ts (quoteClient.ts:77) · F37 console.*
bypasses src/log.ts (desktopBridge.ts:106-108,220; soa-keepalive/index.ts:28-34) · F38
bootstrap logs "演示数据载入" when demo not loaded (analysisController.ts:220-221) · F39
setStore doesn't rebind Yahoo store (runner.ts:42-45,55) · F40 hardcoded #fff/#000
(App.tsx:351,358,362; SettingsPanel.tsx:209) · F41 main controls lack a11y roles
(App.tsx:105,147,231,244; ReportContent.tsx:83) · F42 empty 亿信 cap commits 0
(SettingsPanel.tsx:184-187) · F43 expander state leaks across tabs (ReportContent.tsx:44,79-83) ·
F44 .env.example missing TAVILY/TDX_HOST/TDX_MCP_ENABLED · F46 app/.env.example missing
EXPO_PUBLIC_LOG_ENDPOINT · F47 dead dep string_decoder (package.json:19) · F48 README
artifact table lacks .aab · F49 release.yml android job no npm cache · F50 dual TS majors
undocumented (root ^7 vs app ~6) · F51 root package.json dead main + empty metadata ·
F52 app/package.json Expo template identity · F53 probe.mts header claims SOA_LIVE
never read · F54 probe.mts writes probe-output relative to cwd · F55 yahoo-collect
pagination pinned to real clock, flips ~2034 · F56 device-collect asserts IPv4 host,
TDX_HOST override breaks · F57 wrong epoch constant comment (2004-06-22 vs 06-16) ·
F58 dead `vi` import yahoo.test · F59 dead makeStore() pipeline.test · F60
store-node.test setStore(fake) lacks try/finally · #96 e2e residual: role chips stay
"完成" on error terminal (analysisController.ts:458-462) · #97 composeYahooOverview
amount uses volume field (composeYahooOverview.ts:103) · #98 electron-builder no icon
entry · #99 third-party actions @v4 not SHA-pinned · #100 ≤8-char keys printed unmasked
(settings.ts:102) · #101 dark palette dead on native (theme.ts:43-64 vs app.json
userInterfaceStyle "light").

## 3. Code hygiene (dim 2) — clean overall

Verified clean: no TODO/FIXME/HACK/XXX in shipped code, no stub throws, no empty
bodies, no if(false) blocks, no debugger, no console.* debris (all console.* are
documented operational logging). Demo LLM stubs are documented intentional.
Corrected paths: server/proxies/logs-server live under `app/` (not root).

| # | Sev | Finding | Evidence | Next |
|---|-----|---------|----------|------|
| H1 | should-fix | `updateOverview` StoreLike member: full plumbing, ZERO production callers | src/store.ts:66,174-178; store-memory.ts:61-66; store-file.ts:243-248; store-idb.ts:345-351; desktopBridge.ts:179-184; whitelisted main.mjs:55 | remove from StoreLike+IPC or document reserved |
| H2 | note | proxies.cjs:179 no-op meta storage diverges from deviceCollect real meta; web proxy re-fetches stock names every request | proxies.cjs:179 vs src/tdx/deviceCollect.ts:87-88 | comment intent or wire meta |
| H3 | note | InMemoryStore test-only (documented intentional) | spec/ts/stores.md:46 | keep |

## 4. Security (dim 3) — hardened core, 1 medium + hardening items

Verified clean: Electron hardened (contextIsolation+sandbox+nodeIntegration:false,
navigation/window-open blocked, no shell.openExternal, preload = 4 IPC methods,
store-op whitelist + arg validation, random loopback port); no eval/exec; no
committed secrets; no permissive CORS; DNS-rebinding Host check; log injection
sanitized; EXPO_PUBLIC_* all empty in app/.env.

| # | Sev | Finding | Evidence | Verdict |
|---|-----|---------|----------|---------|
| S1 | ~~high~~ → note | NUL-byte path crash (SEC-01) + unhandled stream error | app/server.mjs:34-56 | **REFUTED at runtime**: `GET /%00` → 200, server alive; mid-stream socket abort → server alive (Node v22.22.3 probes). existsSync swallows ERR_INVALID_ARG_VALUE → SPA fallback. Remains as hardening (F28/F29/F30 already track) |
| S2 | medium | no Origin/CSRF check on /llm-proxy,/tdx-collect,/web-search,/logs; GETs are simple requests; PNA only gates browsers | server.mjs:99-124; metro.config.js:121-141 | real, low exploitability (no CORS headers → responses unreadable cross-origin); fix = Origin allowlist |
| S3 | low | SSRF guard: DNS TOCTOU (check resolves, fetch re-resolves); IPv6 blocklist misses 2002::/16, 2001::/32, 2001:db8::/32, 64:ff9b::/96 | proxies.cjs:52-87,118-126 (verified) | pin resolution + extend blocklist |
| S4 | medium | real secrets + full Android keystore & password (doubles as CI secret) in plaintext root .env; gitignored but high-value at rest | .env:1-17 (verified gitignored) | rotate keystore password + fresh keystore before any real release; keychain instead of .env |
| S5 | low | no CSP/nosniff/cache headers on static responses | server.mjs:53-55; proxies.cjs:127-131 | add headers |
| S6 | note | HOST=0.0.0.0 mode exposes unauthenticated proxy/log endpoints (documented opt-in) | server.mjs:141-147 | require token when non-loopback |
| S7 | info | API keys plaintext in localStorage/soa-settings.json (inherent local-first design) | settingsStore.ts:117-121; child.mjs:73-81 | optional secure-store |

## 5. Release readiness (dim 5) — no blockers

| # | Sev | Finding | Evidence | Next |
|---|-----|---------|----------|------|
| R1 | should-fix | app-layer version incoherence: app/package.json 57.0.13 (Expo template leftover), app.json 1.0.0; only desktop 0.1.3 ↔ tag v0.1.3 enforced | app/package.json:2-4; app/app.json; desktop/package.json (verified) | align app version or document web/RN as unreleased channel |
| R2 | should-fix | no CHANGELOG.md; release notes only in GitHub Release bodies + README | root | add changelog per release |
| R3 | note | CI actions pinned to @v4 major tags only (overlaps #99) | ci.yml:24-27; release.yml:27-30,108-111,130 | SHA-pin |
| R4 | note | root package.json stale `main:index.js` (file absent) + empty metadata (overlaps F51) | package.json:4-5 | remove/fill |
| R5 | note | ci.yml covers root typecheck+vitest only; app/desktop compile gates deferred (documented) | ci.yml comments | consider app tsc gate |
| R6 | note | tracked local android release builder not used by CI (no .env on runner) | app/scripts/build-release-clean.sh | keep as local tooling, document |

## Consolidated pre-go-live checklist (blockers first)

**A. Must fix before go-live (6 majors + 4 high-value):**
1. F01 re-entry guard · 2. F02 UTF-8 chunk decode · 3. F03 RN log rotation · 4. F04
persistence black hole · 5. F05 chart rebuild · 6. F06 annual/QoQ data corruption ·
7. S4 rotate keystore + password before first release build · 8. F21 test isolation
(live web calls in CI) · 9. F07/F08 child lifecycle · 10. F13 webCollect crash.

**B. Should-fix soon (mediums):** F10-F12, F14-F16, F18-F20, F23, F28-F30, F45,
S2 (Origin allowlist), S3 (SSRF pin), H1 (updateOverview), R1/R2.

**C. Batchable notes/nits (43 low/nit + S5-S7 + R3-R6):** F09,F17,F22,F24-F27,
F31-F44,F46-F60,#96-#101 — one cleanup task.

Suggested follow-up split (fixes are out of scope here): child tasks
`golive-fix-majors` (A), `golive-fix-mediums` (B), `golive-cleanup-nits` (C).
