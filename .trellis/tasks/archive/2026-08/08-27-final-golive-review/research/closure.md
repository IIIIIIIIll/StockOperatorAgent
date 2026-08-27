# Closure Verification — 78 backlog items (HEAD 2d9a91b)

Method: source-level verification against fix methods in
`08-27-golive-fix-backlog/research/fix-backlog.md`; current-tree file:line
evidence. Bucket PRDs: 08-27-golive-fix-majors / 08-27-golive-fix-mediums /
08-27-golive-cleanup-nits.

**Totals: 77 FIXED · 1 N/A (S4 process artifact) · 0 PARTIAL · 0 NOT-FIXED.**

## Majors (11) — 10 FIXED + 1 N/A

| ID | Status | Evidence (HEAD) |
|----|--------|-----------------|
| F01 | FIXED | app/lib/analysisController.ts:296-298 `if (this.st.running) return`; test analysis-controller.test.ts:398 |
| F02 | FIXED | Buffer.concat().toString('utf8') ×3: proxies.cjs ~:107, ~:331; logs-server.cjs ~:76; CJK split-chunk tests proxies.test.ts:185, log-server.test.ts:58 |
| F03 | FIXED | src/log.ts:139 moveSync {overwrite:true}; log.test.ts:118-121,350 |
| F04+M1 | FIXED | memo reset on rejection ×5: store-idb.ts ~:144,~:163; store-file.ts ~:98,~:75; desktopBridge.ts ~:116 |
| F05 | FIXED | DataScreen.tsx:38-56 useMemo([ticker, dataVersion]) reports/profit/capital |
| F06 | FIXED | composeYahooReports.ts:142-163 annual rows NaN + skipped in YoY/QoQ; deviceYahooCollect.ts annual module separate; yahoo.test.ts:534 |
| F07 | FIXED | desktop/child.mjs:145-152 listeners top-level, null-guarded shutdown ~:123-127 |
| F08 | FIXED | desktop/child.mjs:152 `if (shuttingDown) return` |
| F13 | FIXED | src/webCollect.ts:100-107 CollectError; shape gate :151-158; webCollect.test.ts:118,135,144 |
| F21 | FIXED | WEB_SEARCH_DISABLED='1' + delete BILLIONS_API_KEY: query-content.test.ts:80-81, events.test.ts:12-13, runner.test.ts:12-13 |
| S4 | N/A | rotation-checklist.md committed (8 sections); rotation itself is a manual pre-release action |

## Mediums (37) — 37 FIXED

| ID | Status | Evidence (HEAD) |
|----|--------|-----------------|
| F09 | FIXED | desktop/main.mjs:291 devTools: !app.isPackaged |
| F10 | FIXED | store-file.ts ~:176-189 closed flag + drain; store-file.test.ts:66 |
| F11 | FIXED | store.ts ~:131-142 dedup baseline = MAX(date) daily_bars |
| F12 | FIXED | store-node.ts:31-37 ENOENT-only null, rethrow others; store-file.ts hydrate tolerant; store-node.test.ts:63 |
| F14 | FIXED | tdx/quoteClient.ts:34-42 local-date parts (no toISOString); qfq.test.ts:99 TZ pinned |
| F15 | FIXED | indicators.ts:17-34 gap-aware decay (pandas adjust=False parity) |
| F16 | FIXED | configure-android-signing.mjs:135-143 \uXXXX + leading-ws escaping |
| F17 | FIXED | App.tsx:71-72 + analysisController.ts:274-276 real section names |
| F18 | FIXED | DataScreen.tsx:51-54 capital memo [ticker, dataVersion] |
| F19 | FIXED | settings.ts:204-213 content-type-gated fallback (404 no longer misdiagnosed) |
| F20 | FIXED | analysisController.ts:263,400,406 asiaToday(); pipeline.ts:214; gates.ts:8-21; tests gates.test.ts:17-51, analysis-controller.test.ts:252 |
| F22 | FIXED | events.test.ts:138-141 undefined→delete restore |
| F23 | FIXED | live.integration.test.ts:4 top-level import |
| F24 | FIXED | llm.test.ts:44-49 meaningful assertion |
| F25 | FIXED | webSearch.ts:130-138 uddg direct; web-search.test.ts:76 |
| F27 | FIXED | f10.ts:84 `cells[1+i] ?? ''` |
| F28 | FIXED | server.mjs:49 DIST+sep anchored startsWith |
| F29 | FIXED | server.mjs:47-81 try/catch + stream error destroy |
| F30 | FIXED | proxies.cjs new URL try/catch→400 ×3 (~:290-297,~:351-358,~:430-437); proxies.test.ts:273-294 |
| F32 | FIXED | punycode-shim.ts:129-135 Unicode-dot split |
| F33 | FIXED | zlib-shim.ts:80-91 incomplete-Huffman reject |
| F34 | FIXED | logs-server.cjs:97-108 byte-truncation (comment figure wrong, see findings.md) |
| F35 | FIXED | deviceYahooCollect.ts:349-351 market-aware message |
| F37 | FIXED | desktopBridge.ts logError via src/log.ts, zero console.* |
| F44 | FIXED | .env.example:8-22,62 TDX_MCP_ENABLED/TDX_HOST/TAVILY_API_KEY |
| F45 | FIXED | .env.example:74-79 LANGSMITH_TRACING commented |
| F46 | FIXED | app/.env.example:15-17 EXPO_PUBLIC_LOG_ENDPOINT |
| F55 | FIXED | yahoo-collect.test.ts:200-201,322-323,375-376,604-605,646-647 setSystemTime + useRealTimers |
| F56 | FIXED | device-collect.test.ts:88-92 constant; :187-208 resetModules+dynamic import |
| H1 | FIXED | zero updateOverview in live code; storeOps.ts:59 validator rejects; store-op-validators.test.ts:69; desktopBridge.test.ts:154; desktop-probe.mts:26-27 |
| M2 | FIXED | proxies.cjs:232 redirect:'manual' + per-hop loop ~:244-275, 5-hop cap; proxies.test.ts:226 |
| S2 | FIXED | isOriginAllowed both surfaces: server.mjs:169-181, metro.config.js:104-116 |
| S3 | FIXED | proxies.cjs:77-92 IPv6 blocklist extended + pinPublicHost resolve-once; residual: TOCTOU documented, hex-mapped bypass (findings.md) |
| S5 | FIXED | SEC_HEADERS both surfaces (proxies.cjs:21-28, server.mjs:30-38); proxies.test.ts:252 |
| #96 | FIXED | analysisController.ts:466-468 statuses={} + hasDone=false on error; analysis-controller.test.ts:354 |
| #97 | FIXED | composeYahooOverview.ts:99-102 amount = volume×price; yahoo.test.ts:394-396 |
| #100 | FIXED | settings.ts:99-101 always mask; settings-store.test.ts:255 |

## Nits (30) — 30 FIXED

| ID | Status | Evidence (HEAD) |
|----|--------|-----------------|
| F26 | FIXED | f10.ts:19-29 NaN guard before 万/亿 multiply |
| F31 | FIXED | legend hoisted before empty-return: build-chart-view.mts ~:163-227, chartHtml.ts:87-154; mirror gate PASS (main session) |
| F36 | FIXED | metaKeys.ts:20 nameKey; quoteClient.ts:6,87; no literal |
| F38 | FIXED | runner.ts:68-83 loadDemoData():boolean; analysisController.ts:223-225 gated log |
| F39 | FIXED | runner.ts:42-48 setYahooStore inside setStore |
| F40 | FIXED | App.tsx:341-378 + SettingsPanel.tsx theme.colors.* only; zero #fff/#000 |
| F41 | FIXED | App.tsx:105,138-139,201,208,231,244 + ReportContent.tsx:84 a11y roles |
| F42 | FIXED | SettingsPanel.tsx:186 empty-trim early return |
| F43 | FIXED | App.tsx:288 key={activeRole.stateKey!} remount |
| F47 | FIXED | package.json no string_decoder, zero importers |
| F48 | FIXED | README.md:125 .aab row |
| F49 | FIXED | release.yml android job cache: npm + cache-dependency-path |
| F50 | FIXED | package.json:28 + app/package.json:31 dual-TS rationale |
| F51 | FIXED | package.json:1-10 no main, no empty metadata |
| F52 | FIXED | app/package.json:2-6 + app/app.json:5 soa-app 0.1.3 UNLICENSED |
| F53 | FIXED | probe.mts:1-3 header corrected |
| F54 | FIXED | probe.mts:28 ROOT from import.meta.url; all output paths anchored |
| F57 | FIXED | yahoo-collect.test.ts:61 comment 2004-06-16 (re-derived from constant) |
| F58 | FIXED | yahoo.test.ts:4 no vi |
| F59 | FIXED | pipeline.test.ts:21 single live makeStore |
| F60 | FIXED | store-node.test.ts:84-91 try/finally |
| #98 | FIXED | electron-builder.yml buildResources build + icon build/icon.png (exists) |
| #99 | FIXED | ci.yml 2/2 + release.yml 9/9 full-SHA pins (11/11 total, no tags) |
| #101 | FIXED | theme.ts light-only + documented; app.json userInterfaceStyle light |
| H2 | FIXED | proxies.cjs:268-271 no-op meta intent comment |
| R2 | FIXED | README.md:96-101 CHANGELOG decision |
| R5 | FIXED | ci.yml:5-9 deferral documented |
| R6 | FIXED | build-release-clean.sh:2-4 local-tooling header |
| S6 | FIXED | server.mjs:173-183 Bearer gate, :213-215 env; wrinkles in findings.md |
| S7 | FIXED | settingsStore.ts:111-114 + child.mjs:79-80 secure-store comments |

## Not statically verifiable (covered by main-session runs)

- F31 mirror byte-equality → `npm run chart:build && chart:check` **PASS**.
- F03/F10/F12/F21 behavioral proofs → vitest **653 passed / 1 skipped**.
- S4 rotation → manual execution on release machine (checklist committed).
