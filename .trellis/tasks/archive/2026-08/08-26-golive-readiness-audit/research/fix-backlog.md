# Go-live Fix Backlog — Master Record (2026-08-26)

**The single reference for planning/executing the pre-go-live fixes.** Every item:
severity, evidence (current tree, HEAD=213fe13), fix method (review-corrected), and
review status. Deep mechanism narratives live in the 08-25 archive (§F references)
and this task's research files; this file is the actionable index.

## Provenance & quality assurance

- Sources: `08-25-review-findings-audit/research/00-findings.md` (F01–F60, 54
  CONFIRMED/6 PARTIAL, adversarial-reviewed once) → consolidated with this audit's
  new items in `research/findings.md` → adversarially re-verified partition-by-partition
  by 8 read-only reviewers + 5 main-session spot checks → this record.
- **Result: 0 refuted, 0 evidence drift across all 82 recorded items.** 68 confirmed
  by reviewers, 5 spot-confirmed by main session (F15, F19, #99, #100, #101), 1
  fix-adjusted (F16), 5 severity-adjusted (S2, F27, F37, F46, R2), 3 deduped
  (R1→F52, R3→#99, R4→F51), 2 newly discovered (M1 folded into F04, M2).
- Verdict details: `research/findings-review.md` + agent outputs (`agent://Review*`).

## Status legend

- `[C]` adversarially/spot confirmed as written · `[FA]` fix method corrected ·
  `[SA]` severity recalibrated · `[NEW]` discovered by this review · `[DUP→]` merged
  into survivor (survivor carries the combined fix)

## Verification gates (run after any fix batch)

`npx vitest run` (627 tests, 55 files — must stay green) · `npx tsc --noEmit` ·
`npm run chart:build && npm run chart:check` when chart assets touched (F05, F31) ·
working tree clean. Spec pre-checks for fixers: architecture assertions
(`test/architecture.test.ts`), log calls via `src/log.ts` only, meta keys from
`src/metaKeys.ts` only, env reads via `src/env.ts`.

---

## Bucket A — Fix before go-live (11)

| ID | Sev | Mechanism | Evidence | Fix | Status |
|----|-----|-----------|----------|-----|--------|
| F01 | major | start() wipes running state; no re-entry guard; reachable via `window.__soa.start` | app/lib/analysisController.ts:285-296; App.tsx:92 | `if (s.running) return` at entry | [C] |
| F02 | major | per-chunk `body += chunk` corrupts UTF-8 (CJK prompts) | app/lib/proxies.cjs:103, 286; app/lib/logs-server.cjs:70 | collect Buffers + `Buffer.concat`, decode once (NOT setEncoding — keeps byte-based 1MB cap) | [C] |
| F03 | major | RN log rotation: moveSync without overwrite → dies after first .1 file | src/log.ts:137 (+ type widen :116; test/log.test.ts:118 fake) | `{overwrite:true}` | [C] |
| F04 | major | memoized ready/db promise caches rejection forever → session-long persistence black hole — **4 sites** | src/store-idb.ts:142,152; src/store-file.ts:42,93; app/lib/desktopBridge.ts:73-75 [NEW M1] | clear memo on rejection (pattern precedent store-file.ts:110-113) | [C]+[NEW] |
| F05 | major | reports/profit recomputed per render → FinancialTrendChart full rebuild/flicker | app/screens/DataScreen.tsx:30,33,45 | useMemo([ticker, dataVersion]) for both | [C] |
| F06 | major | annual statements merged into quarterly pool → wrong YoY/QoQ persisted (universal, US+CN) | src/yahoo/deviceYahooCollect.ts:287-294; src/yahoo/composeYahooReports.ts:142-163 | origin-aware rates (NaN for annual rows); test gap: yahoo.test.ts fixtures quarterly-only | [C] |
| F07 | medium | child orphans during startup window: listeners after awaits | desktop/child.mjs:145,188-193 (awaits :123,138); needs null-guards :92-93 | register listeners top-level; null-guard close() | [C] |
| F08 | medium | ops during gracefulShutdown applied-then-dropped | desktop/child.mjs:83-95,145 (main.mjs:339-341 promise) | `if (shuttingDown) return` in message handler | [C] |
| F13 | major | 200+bad-JSON from proxy → null payload → consumer TypeError (first crash: payload.ticker webCollect.ts:31) | src/webCollect.ts:94-98,31,51 | validate body object + Array.isArray(bars); return typed error | [C] |
| F21 | medium | 3 suites run real web searches in CI (events.test/runner.test have NO env isolation at all; flake: 20s fetch vs 15s timeout) | test/query-content.test.ts:71-77; test/events.test.ts; test/runner.test.ts | WEB_SEARCH_DISABLED='1' + delete BILLIONS_API_KEY (pattern: agents.test.ts:36-61) | [C] |
| S4 | medium | real secrets + full Android keystore + password (doubles as CI signing secret) plaintext in .env | .env:1-17 (gitignored, not committed) | rotate keystore + passwords BEFORE first real release; propagate to .env AND GitHub Actions secrets; keychain instead of .env | [C] |

## Bucket B — Should-fix (37)

| ID | Sev | Mechanism | Evidence | Fix | Status |
|----|-----|-----------|----------|-----|--------|
| F09 | minor | packaged app still opens DevTools; comment claims otherwise | desktop/main.mjs:291-296 | devTools:!app.isPackaged or null menu | [C] |
| F10 | medium | FileStore.close drops queue, no closed flag; re-hydrate revival + acked-change loss | src/store-file.ts:174-181 (IdbStore pattern :262-285) | closed flag + drain semantics | [C] |
| F11 | medium | SQLite addDatas dedup baseline (lastDataUpdate) differs; INSERT OR REPLACE breaks "0=all dup" contract | src/store.ts:131-133 (cited :74 drifted), 2,127 | align baseline or contract | [C] |
| F12 | medium | nodeFsAdapter bare catch→null for ALL fs errors; silent skip → near-empty overwrite | src/store-node.ts:27-31; store-file.ts:125-126 | rethrow non-ENOENT; logError | [C] |
| F14 | medium | TDX daily dates +1 day on TZ≤UTC-9 (toISOString roundtrip; lib builds local-time 15:00) | src/tdx/quoteClient.ts:38-39 | format from decoded ints | [C] |
| F15 | medium | ewmAlpha implements ignore_na=True (NaN carry) while header claims pandas adjust=False parity | src/indicators.ts:17-32 | gap-aware pow decay or fix header | [C] (spot) |
| F16 | medium | android-signing properties escape incomplete: non-Latin-1 → ISO-8859-1 mojibake; leading whitespace dropped | tools/configure-android-signing.mjs:139-141 (file is .mjs) | escape `[\u0080-\uFFFF]`→`\uXXXX` AND backslash-escape leading whitespace | [FA] |
| F17 | minor | missing-key notice points to nonexistent 「模型与密钥」 section | app/App.tsx:69-70; analysisController.ts:266 | align to 「LLM(大模型)」/「外部服务密钥(可选)」 | [C] |
| F18 | medium | turnover capital memo deps [ticker] only → stale on re-collect | app/screens/DataScreen.tsx:36-39 | add dataVersion dep | [C] |
| F19 | medium | checkLlmReachability treats passthrough 404 as missing proxy → misdiagnosis + wrong fallback | app/lib/settings.ts:188-191 | only fall back on fetch rejection / proxy-marker | [C] (spot) |
| F20 | medium | analysis "today" uses UTC calendar day, not Beijing date | analysisController.ts:259,391,397; useAnalysis.ts:118; pipeline.ts:214 | asiaToday()/marketToday('cn') | [C] |
| F22 | minor | env restore writes string "undefined" | test/events.test.ts:126-129 | undefined→delete branch | [C] |
| F23 | medium | live.integration bare require() in ESM → ReferenceError; fixture block never runs | test/live.integration.test.ts:71 | top-level import readFileSync | [C] |
| F24 | minor | llm.test name asserts opposite of assertion (tautology) | test/llm.test.ts:45-47 | invert or rename | [C] |
| F25 | low | ddg uddg double percent-decode | src/webSearch.ts:132-134 | return uddg directly | [C] |
| F27 | low | parseSectionBlock stores undefined value_raw into string field | src/f10.ts:72-73 | `cells[1+i] ?? ''` | [SA] nit→low |
| F28 | low | serveStatic unanchored startsWith(DIST); '//../distX/...' passes (latent; no sibling dist* today) | app/server.mjs:44 | path.relative guard or DIST+sep anchor | [C] |
| F29 | low | createReadStream.pipe no error handler; existsSync→statSync race throws synchronously (crash NOT reproducible at runtime — hardening) | app/server.mjs:49-54 | try/catch whole file-serving block (not just s.on('error')) | [C] |
| F30 | low | bare `new URL(req.url)` ×3 throw through async handlers → unhandledRejection → process death | app/lib/proxies.cjs:197,296,343 | try/catch→400 (serveStatic C1 pattern) | [C] |
| F32 | low | punycode shim misses Unicode dots (。．｡) — broken links | app/lib/punycode-shim.ts:133 | normalize \u3002\uFF0E\uFF61 in mapDomain | [C] |
| F33 | low | zlib-shim accepts incomplete Huffman tables; comment wrongly claims zlib parity | app/lib/zlib-shim.ts:65-69 | enforce zlib rule or fix comment+header | [C] |
| F34 | low | MAX_MESSAGE_BYTES counts UTF-16 units (~3× for CJK) | app/lib/logs-server.cjs:99 | Buffer.byteLength or rename MAX_MESSAGE_CHARS | [C] |
| F35 | nit | exhausted US probe throws HK-specific error message | src/yahoo/deviceYahooCollect.ts:355 | market-aware message | [C] |
| F37 | low | console.error bypasses src/log.ts (production write-through path; spec pre-check #2 hard rule) | app/lib/desktopBridge.ts:107,220 (soa-keepalive __DEV__-dead) | route through log.ts | [SA] nit→low |
| F44 | low | .env.example missing TAVILY_API_KEY / TDX_HOST / TDX_MCP_ENABLED (+semantics) | .env.example | add 3 commented rows | [C] |
| F45 | medium | LANGSMITH_TRACING=true in example while comment denies telemetry; @langchain/core auto-traces (verified in node_modules) | .env.example:47-50 | comment out both lines (repo .env=false, safe today) | [C] |
| F46 | low | app/.env.example missing EXPO_PUBLIC_LOG_ENDPOINT (consumed) | app/.env.example; src/log.ts:78 | add row | [SA] nit→low |
| F55 | low | yahoo-collect pagination pinned to real clock; flips ~2034-06-13 | test/yahoo-collect.test.ts:222,325,372 | vi.setSystemTime | [C] |
| F56 | low | device-collect asserts IPv4 host; TDX_HOST hostname breaks (module-load const) | test/device-collect.test.ts:88-90; deviceCollect.ts:32-37 | vi.resetModules+dynamic import or function-ize host | [C] |
| H1 | should-fix | updateOverview StoreLike member: full plumbing, ZERO production callers (blast radius: store-update-overview.test.ts, probe) | src/store.ts:66,174; store-memory.ts:61; store-file.ts:243; store-idb.ts:345; desktopBridge.ts:179; storeOps.ts:86; main.mjs:55 | remove from StoreLike+IPC or document reserved | [C] |
| M2 | low | LLM-proxy SSRF guard bypassed by 3xx redirects (fetch redirect:'follow'; first-hop validation only; 307 preserves method+body) | app/lib/proxies.cjs:133 | redirect:'manual' + per-hop isPrivateAddress (or pin resolved IP) | [NEW] |
| S2 | low | no Origin/CSRF check on proxy endpoints; GETs triggerable cross-site (responses unreadable; PNA/Host mitigate) | app/server.mjs:99-124; metro.config.js:121-140 | Origin allowlist (own origin / null) or per-session token | [SA] med→low |
| S3 | low | SSRF guard: DNS TOCTOU (check resolves, fetch re-resolves) + IPv6 gaps (2002::/16, 2001::/32, 2001:db8::/32, 64:ff9b::/96) | app/lib/proxies.cjs:52-87,133 | pin resolution to checked IP; extend blocklist | [C] |
| S5 | low | static + proxy responses ship no CSP/nosniff/cache headers | app/server.mjs:53-55; proxies.cjs:127-131 | add headers (CSP default-src 'self'; connect-src 'self' https:) | [C] |
| #96 | minor | role chips stay 完成/分析中 on error terminal (statuses never reset) | app/lib/analysisController.ts:458-461 | clear s.statuses in error branch (e2e residual, session 53) | [C] |
| #97 | low | overview amount uses volume field (documented no-standard-source) | src/yahoo/composeYahooOverview.ts:103 | NaN or volume×price | [C] |
| #100 | nit | ≤8-char keys printed unmasked in logs | app/lib/settings.ts:102 | always mask | [C] (spot) |

## Bucket C — Nits batch (30)

| ID | Sev | Mechanism | Evidence | Fix | Status |
|----|-----|-----------|----------|-----|--------|
| F26 | nit | toNum bare 万/亿 → 0 not NaN | src/f10.ts:20-21 | NaN check before multiply | [C] |
| F31 | nit | empty-series early return before legend loop (BOTH chartHtml.ts and mirror mts) | app/lib/chartHtml.ts:86-91,116-120; tools/build-chart-view.mts:163-168,194-196 | hoist legend or show #empty | [C] |
| F36 | nit | `name:${ticker}` meta key literal outside metaKeys.ts (META_PATTERNS is 4, not 5 — none match) | src/tdx/quoteClient.ts:77 | export nameKey | [C] |
| F38 | nit | bootstrap logs 演示数据载入 with real-store counts when demo not loaded | app/lib/analysisController.ts:220-221 | log only on actual insert (return flag) | [C] |
| F39 | nit | setStore doesn't rebind Yahoo store (module-load once) | app/lib/runner.ts:42-45,55 | call setYahooStore inside setStore | [C] |
| F40 | nit | hardcoded #fff/#000 bypass theme tokens | app/App.tsx:351,358,362; SettingsPanel.tsx:209 | promote tokens | [C] |
| F41 | nit | main controls lack a11y roles/aria (pattern exists at App.tsx:138-139) | app/App.tsx:105,147,231,244; ReportContent.tsx:83 | role=button, aria-expanded, tab roles | [C] |
| F42 | nit | clearing 亿信 cap commits 0, field snaps to "0" | app/screens/SettingsPanel.tsx:184-187 | early return on empty trim | [C] |
| F43 | nit | expander state keyed by slot index → leaks across 看涨/看跌 tabs | app/components/ReportContent.tsx:44,79-83; App.tsx:287 | key={activeRole.stateKey!} | [C] |
| F47 | nit | dead dep string_decoder (zero importers) | package.json:19 | remove | [C] |
| F48 | nit | README artifact table lacks .aab row | README.md:117 | add Play bundle row | [C] |
| F49 | nit | release.yml android job lacks npm cache (desktop has it) | .github/workflows/release.yml:110-113 | add cache-dependency-path | [C] |
| F50 | nit | dual TS majors (root ^7.0.2 vs app ~6.0.3) undocumented | package.json:26; app/package.json:25 | record rationale or align | [C] |
| F51 | nit | root package.json dead main + empty metadata [DUP←R4] | package.json:4-5,11 | remove/fill | [C] |
| F52 | nit→minor | app/package.json Expo template identity + version 57.0.13; app.json version 1.0.0 → tagged v0.1.3 AAB would carry versionName 1.0.0 [DUP←R1] | app/package.json:2-5; app/app.json:7 | personalize name/desc/license; align version with release series (or document web/RN channel) | [C] |
| F53 | nit | probe.mts header claims SOA_LIVE usage; never reads it | tools/probe.mts:1-2 | fix header (optionally restore gate) | [C] |
| F54 | nit | probe.mts writes probe-output relative to cwd; siblings anchor ROOT | tools/probe.mts:80,136,167,193 | anchor import.meta.url | [C] |
| F57 | nit | wrong epoch comment (2004-06-22 not 06-16); corrected constant 1_087_344_000 verified | test/yahoo-collect.test.ts:61 | fix comment | [C] |
| F58 | nit | dead `vi` import | test/yahoo.test.ts:4 | remove | [C] |
| F59 | nit | dead makeStore() local | test/pipeline.test.ts:64-66 | delete | [C] |
| F60 | nit | setStore(fake) round-trip lacks try/finally | test/store-node.test.ts:80-86 | wrap | [C] |
| #98 | nit | electron-builder no icon entry; default Electron icon in artifacts | desktop/electron-builder.yml; no build/ dir | add icon + buildResources asset | [C] |
| #99 | nit | CI actions pinned to major tags only [DUP←R3] | ci.yml:24,27; release.yml:27,30,70,91,108,111,130,165,184 | SHA-pin | [C] (via R3) |
| #101 | nit | dark palette dead on native (userInterfaceStyle "light") | app/theme.ts:43-64; app/app.json:8 | remove dark branch or set "automatic" | [C] (spot) |
| H2 | note | proxies.cjs no-op meta storage diverges from deviceCollect real meta (name re-fetch per collect) | app/lib/proxies.cjs:179; src/tdx/deviceCollect.ts:87-88 | comment intent or wire meta | [C] |
| R2 | note | no CHANGELOG.md (release notes live in GitHub Release bodies + README) | root | decide: changelog per release or document decision | [SA] sf→note |
| R5 | note | ci.yml covers root only; app/desktop compile gates deferred (documented) | ci.yml:1-5 | consider app tsc gate | [C] |
| R6 | note | local android release builder not used by CI (no .env on runner) | app/scripts/build-release-clean.sh | keep as local tooling, document | [C] |
| S6 | note | HOST=0.0.0.0 exposes unauthenticated proxy/log endpoints (documented opt-in) | app/server.mjs:141-148 | require token when non-loopback | [C] |
| S7 | info | API keys plaintext in localStorage/soa-settings.json (inherent local-first design) | settingsStore.ts:117-121; child.mjs:73-81 | optional secure-store; keep documented | [C] |

## Informational records (no fix)

- **S1** — NUL-byte + stream-error crash claims REFUTED at runtime (GET /%00 → 200+alive;
  mid-stream abort → alive; Node v22.22.3; existsSync swallows ERR_INVALID_ARG_VALUE).
  Kept as refutation record; residual hardening = F29.
- **H3** — InMemoryStore test-only backend, documented intentional (spec/ts/stores.md:46). Keep.

## Suggested sequencing (shared-root-cause passes)

1. **G1 memo-reset (F04)**: store-idb ×2, store-file ×2, desktopBridge ×1 — one pattern.
2. **G2 chunk-decode (F02)**: proxies.cjs ×2, logs-server.cjs — one pass.
3. **G3 test isolation+hygiene**: F21, F22, F24, F55-F60 — one suite pass.
4. **G4 server/proxy hardening**: F28, F29, F30, S2, S3, M2, S5 — server.mjs + proxies.cjs co-located.
5. **G5 env-example family**: F44, F45, F46.
6. **G6 android signing**: F16 + S4 (adjacent; S4 rotates, F16 fixes encoding).
7. **G7 release metadata**: F48, F49, F50, F51, F52, R2, R5, R6.
8. **G8 desktop lifecycle**: F07, F08, F09, #98.
9. **G9 data correctness**: F06, F13, F14, F20, F25, F35, #96, #97.
10. **G10 UI/UX batch**: F05, F17, F18, F31, F38, F40, F41, F42, F43.
11. **G11 store semantics**: F10, F11, F12, H1.
12. **G12 everything else (C bucket)**: one cleanup task.
