# Design: Go-live Fix — Mediums (Bucket B)

Grouped design notes. Fix methods authoritative from parent
`research/fix-backlog.md`; this doc flags risky/cross-cutting items only —
mechanical items (F22, F23, F24, F55, F56, F44-F46, F32, F33, F35, #97, #100)
follow the fix-backlog Fix column verbatim with no extra design.

## G11 store semantics (F10, F11, F12, H1) — highest risk

- **F10**: FileStore.close must set a closed flag and drain the pending queue
  (or reject queued ops with a typed closed error). IdbStore :262-285 is the
  precedent. Contract: `close()` idempotent; ops after close fail fast,
  never silently drop. Test: queue ops → close → assert drained-or-error,
  no hanging promise.
- **F11**: SQLite `addDatas` dedup baseline (lastDataUpdate) differs from the
  memory backend; `INSERT OR REPLACE` violates the "0 = all dup" contract.
  Decision required in-code: align the SQLite baseline to the contract that
  callers rely on (check `test/store*.test.ts` for the pinned expectation
  before choosing). Test: duplicate batch → 0 inserted + counts match.
- **F12**: nodeFsAdapter bare `catch → null` swallows ALL fs errors → silent
  skip can produce near-empty overwrite (store-file.ts:125-126 relies on
  ENOENT = absent). Change: rethrow non-ENOENT, log via src/log.ts. Test:
  permission error → surfaces, not null.
- **H1**: `updateOverview` removal — full StoreLike member with ZERO
  production callers. MUST run `lsp references` on the member before deletion;
  expected callers: store-update-overview.test.ts, **tools/desktop-probe.mts**
  (4 sites :69,:80,:123,:138 — IPC op at :123 breaks when the main.mjs:55
  whitelist drops the op; tools/probe.mts has ZERO references), IPC whitelist
  main.mjs:55, storeOps.ts:86, desktopBridge.ts:179, all 4 store impls, plus
  test/desktopBridge.test.ts (:154,:165,:177-180,:283-298),
  test/store-op-validators.test.ts (:63-65,:105-106,:174-182) and
  test/store-node.test.ts:73 (StoreLike stub member — tsc excess-property
  risk). Delete member + IPC op + tests in ONE commit. This is the only item
  whose fix is net-negative lines — reviewer gate.

## G4 server/proxy hardening (F28, F29, F30, S2, S3, M2, S5)

- **S2**: Origin allowlist — ALL 5 proxy endpoints (/llm-proxy, /tdx-collect,
  /web-search, /logs, /yahoo-collect — server.mjs:99-124 + metro middleware
  app/metro.config.js:78-103) accept only requests whose Origin is absent,
  `null`, or the app's own origin (Host check already exists). Keep GET
  simple-request behavior working (no preflight for same-origin).
- **M2**: SSRF 3xx bypass — `fetch(url, {redirect: 'manual'})` then per-hop
  `isPrivateAddress` re-check before following; 307/308 preserve method+body →
  must not be followed to internal targets. (Redirect responses beyond
  blocklist → return error to caller.)
- **S3**: DNS TOCTOU — resolve once, validate, fetch the pinned IP (or
  re-validate per-hop); extend IPv6 blocklist: 2002::/16 (6to4), 2001::/32
  (Teredo), 2001:db8::/32 (docs), 64:ff9b::/96 (NAT64).
- **F28/F29/F30/S5**: server.mjs + proxies.cjs co-located pass; F29 wraps the
  whole file-serving block in try/catch (synchronous existsSync→statSync race
  throws through listener); F30 3× `new URL(req.url)` → try/catch → 400; S5
  headers on static + proxy responses (CSP default-src 'self'; connect-src
  'self' https:; nosniff; no-store for proxy, cache-control for static).
- **Test point**: S2 — cross-origin fetch → 403/400 with no CORS headers;
  M2 — redirect to 127.0.0.1 → blocked; F30 — malformed URL → 400, process
  alive.

## G9 data correctness (F14, F20, F25, F35, #96, #97)

- **F14**: TDX quoteClient builds Date from decoded ints directly (no
  toISOString roundtrip) — fixes +1 day on TZ ≤ UTC-9. Test with
  `TZ=Pacific/Kiritimati`-style env: dates match raw ints.
- **F20**: replace UTC "today" with Beijing calendar day. Verified: pipeline.ts:214
  already uses asiaToday() (the precedent to match, NOT a fix site); change
  sites are analysisController.ts:259/391/397 (`d.isoNow().slice(0,10)`).
  Decision: patch the isoNow provider (useAnalysis.ts:118) so all 3 controller
  sites inherit the Beijing day — but verify other isoNow consumers
  (saveLastRun at analysisController.ts:460) before changing provider
  semantics; if the provider change is unsafe, fix the 3 consumer sites
  individually. Test the helper with fixed clock + assert call sites use it.
- **#96**: error terminal must clear s.statuses (role chips reset) — same file
  as F01/F17/F20 hunks (sequential, disjoint).
- **#97**: composeYahooOverview amount uses volume field — return NaN or
  volume×price per decision recorded in code comment (no-standard-source doc
  exists); test pins the chosen behavior.

## G10 UI/UX (F17, F18)

- F17: missing-key notice must point to the real section titles
  「LLM(大模型)」/「外部服务密钥(可选)」(App.tsx:69-70 + analysisController.ts:266).
- F18: turnover-capital memo deps += dataVersion (adjacent to majors F05
  hunks — same file, sequential).

## G12 leftovers (F15, F19, F27, F32-F34, F37)

- F15: ewmAlpha implements ignore_na=True (NaN carry) but header claims pandas
  adjust=False parity. Prefer gap-aware pow decay (match pandas) over
  comment-only fix unless tests pin current behavior — check indicators tests
  first.
- F19: checkLlmReachability 404 passthrough ≠ missing proxy; fall back only on
  fetch rejection or proxy-marker response.
- F37: desktopBridge console.error → src/log.ts (desktop write-through path;
  soa-keepalive sites are __DEV__-dead — skip unless trivial).
- F34: MAX_MESSAGE_BYTES counts UTF-16 units — use Buffer.byteLength so the
  1MB cap is bytes (aligns with F02's byte-based accounting).

## Test/commit conventions

Same as majors: one commit per item/pass, finding ID in message, targeted
suite per pass, full gates at end, no cross-bucket fixes.
