# PRD: Go-live Fix — Mediums (Bucket B, 37 项)

## Goal

Fix all **37 should-fix items** (Bucket B) from the audit backlog. Evidence +
fix method for every item: parent `08-27-golive-fix-backlog/research/fix-backlog.md`
(authoritative). This PRD enumerates scope + acceptance.

## Ordering / wait conditions

- **Waits for**: majors child committed + checked (shared files:
  analysisController.ts, proxies.cjs, logs-server.cjs, store-*.ts,
  desktopBridge.ts, deviceYahooCollect.ts, DataScreen.tsx, events.test.ts —
  majors owns its hunks first).
- **Runs before**: cleanup-nits child (waits for this task).
- Files this task touches that nits also touch: App.tsx (nits F40/F41),
  analysisController.ts (nits F38), app/lib/proxies.cjs (nits H2),
  app/server.mjs (nits S6), src/tdx/quoteClient.ts (nits F36),
  src/f10.ts (nits F26), test/yahoo-collect.test.ts (nits F57).

## Scope (37 items, exhaustive)

| ID | Sev | Fix (from fix-backlog.md) |
|----|-----|---------------------------|
| F09 | minor | desktop/main.mjs:291-296 — devTools: `!app.isPackaged` or null menu |
| F10 | medium | src/store-file.ts:174-181 — closed flag + drain semantics (IdbStore pattern :262-285) |
| F11 | medium | src/store.ts:131-133 — SQLite addDatas dedup baseline align OR contract align |
| F12 | medium | src/store-node.ts:27-31; store-file.ts:125-126 — rethrow non-ENOENT + logError (no bare catch→null) |
| F14 | medium | src/tdx/quoteClient.ts:38-39 — format TDX dates from decoded ints (no toISOString roundtrip) |
| F15 | medium | src/indicators.ts:17-32 — gap-aware pow decay or fix header (NaN-carry ≠ pandas adjust=False) |
| F16 | medium | tools/configure-android-signing.mjs:139-141 — escape `[\u0080-\uFFFF]`→`\uXXXX` AND backslash-escape leading whitespace (file is .mjs) |
| F17 | minor | app/App.tsx:69-70; analysisController.ts:266 — point to existing 「LLM(大模型)」/「外部服务密钥(可选)」section |
| F18 | medium | app/screens/DataScreen.tsx:36-39 — add dataVersion to turnover-capital memo deps |
| F19 | medium | app/lib/settings.ts:188-191 — checkLlmReachability: only fall back on fetch rejection / proxy-marker, not passthrough 404 |
| F20 | medium | analysisController.ts:259,391,397; useAnalysis.ts:118; pipeline.ts:214 — Beijing calendar day (asiaToday()/marketToday('cn')) |
| F22 | minor | test/events.test.ts:126-129 — env restore: undefined→delete branch |
| F23 | medium | test/live.integration.test.ts:71 — top-level import readFileSync (bare require in ESM → ReferenceError) |
| F24 | minor | test/llm.test.ts:45-47 — invert or rename tautological test |
| F25 | low | src/webSearch.ts:132-134 — return uddg directly (double percent-decode) |
| F27 | low | src/f10.ts:72-73 — `cells[1+i] ?? ''` (undefined into string field) |
| F28 | low | app/server.mjs:44 — path.relative guard or DIST+sep anchor (unanchored startsWith) |
| F29 | low | app/server.mjs:49-54 — try/catch whole file-serving block (existsSync→statSync race) |
| F30 | low | app/lib/proxies.cjs:197,296,343 — try/catch→400 around bare `new URL(req.url)` (async handlers → unhandledRejection) |
| F32 | low | app/lib/punycode-shim.ts:133 — normalize \u3002\uFF0E\uFF61 in mapDomain |
| F33 | low | app/lib/zlib-shim.ts:65-69 — enforce zlib incomplete-Huffman rule or fix comment+header |
| F34 | low | app/lib/logs-server.cjs:99 — Buffer.byteLength or rename MAX_MESSAGE_CHARS (UTF-16 units ~3× for CJK) |
| F35 | nit | src/yahoo/deviceYahooCollect.ts:355 — market-aware error message (HK text on US probe) |
| F37 | low | app/lib/desktopBridge.ts:107,220 — route console.error through src/log.ts (spec pre-check #2 hard rule) |
| F44 | low | .env.example — add TAVILY_API_KEY / TDX_HOST / TDX_MCP_ENABLED commented rows (+semantics) |
| F45 | medium | .env.example:47-50 — comment out LANGSMITH_TRACING=true lines (verified auto-trace in node_modules) |
| F46 | low | app/.env.example — add EXPO_PUBLIC_LOG_ENDPOINT row (consumed at src/log.ts:78) |
| F55 | low | test/yahoo-collect.test.ts:222,325,372 — vi.setSystemTime (clock-flip ~2034) |
| F56 | low | test/device-collect.test.ts:88-90; deviceCollect.ts:32-37 — vi.resetModules + dynamic import or function-ize host |
| H1 | should-fix | src/store.ts:66,174; store-memory.ts:61; store-file.ts:243; store-idb.ts:345; desktopBridge.ts:179; storeOps.ts:86; main.mjs:55 — remove updateOverview from StoreLike+IPC (ZERO production callers; incl. store-update-overview.test.ts, probe) |
| M2 | low | app/lib/proxies.cjs:133 — redirect:'manual' + per-hop isPrivateAddress (SSRF 3xx bypass; 307 preserves body) |
| S2 | low | app/server.mjs:99-124; app/metro.config.js:78-103 — Origin allowlist (own origin / null) on proxy endpoints |
| S3 | low | app/lib/proxies.cjs:52-87,133 — pin resolution to checked IP + extend IPv6 blocklist (2002::/16, 2001::/32, 2001:db8::/32, 64:ff9b::/96) |
| S5 | low | app/server.mjs:53-55; proxies.cjs:127-131 — add CSP default-src 'self' / connect-src 'self' https: + nosniff + cache headers |
| #96 | minor | app/lib/analysisController.ts:458-461 — clear s.statuses in error branch (role chips reset) |
| #97 | low | src/yahoo/composeYahooOverview.ts:103 — NaN or volume×price (amount uses volume field) |
| #100 | nit | app/lib/settings.ts:102 — always mask keys (≤8-char printed unmasked) |

## Acceptance criteria

1. Per item: fix per fix-backlog method; observable-contract changes get a
   deterministic offline test (F10 drain, F12 rethrow, F14 dates, F20 Beijing
   day, F25 uddg, F30 400 path, S2 allowlist, #97, #100).
2. Gates on final tree: `npx vitest run` ≥627 pass / 0 fail (net count may
   shift ±: H1 deletes store-update-overview.test.ts + updateOverview cases
   in desktopBridge/store-op-validators suites; incl. architecture.test.ts),
   `npx tsc --noEmit` 0 errors, chart gate if chart assets touched (none
   listed — N/A), `git status --porcelain` clean.
3. Spec pre-checks: log via src/log.ts (F37), meta keys via src/metaKeys.ts,
   env via src/env.ts.
4. H1 removal verified via `lsp references` before deletion (no missed
   callers); store-update-overview.test.ts + probe updated/deleted in same
   commit.
5. Commit per item/pass with finding ID in message (`fix(scope): …,修 F0x/Sx/H1/#9x/M2`).

## Non-goals

- Items outside Bucket B (nits lists them in commit notes, not fixes).
- Re-researching fix methods (fix-backlog.md authoritative).
