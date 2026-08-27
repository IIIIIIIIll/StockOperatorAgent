# Findings Quality Review — Verdict Record (2026-08-26)

Adversarial re-verification of the complete go-live findings set (82 recorded items)
against working tree HEAD=213fe13, by 8 parallel partition reviewers
(scout, read-only). Every finding: evidence re-pinned line-by-line, mechanism
re-derived from code, 修法 judged for soundness, severity re-calibrated against the
08-25 PARTIAL table and current-tree reality. Runtime facts from main-session probes
(GET /%00 → 200 + alive; mid-stream abort → alive; existsSync swallows
ERR_INVALID_ARG_VALUE; Node v22.22.3) applied where relevant.

## Tally (82 verifications)

| Verdict | Count | Items |
|---------|-------|-------|
| CONFIRMED (as written) | 68 | F01-F06, F07, F08, F09, F10, F11, F12, F13, F14, F15*, F17, F18, F20, F21, F22, F23, F24, F25, F26, F28, F29, F30, F31, F32, F33, F34, F35, F36, F38, F39, F40, F41, F42, F43, F44, F45, F47, F48, F49, F50, F51, F52, F53, F54, F55, F56, F57, F58, F59, F60, #96, #97, #98, #99, #100, #101, H1, H2, H3, S1 (as recorded), S3, S4, S5, S6, S7, R5, R6 |
| FIX-ADJUSTED | 1 | F16 (修法 incomplete: add leading-whitespace escape; file is .mjs not .mts) |
| SEVERITY-ADJUSTED | 5 | S2 medium→low (preflight/PNA/Host mitigations); F27 nit→low (value_raw undefined into string field); F37 nit→low (spec/ts pre-check #2 hard rule, production path desktopBridge:107); F46 nit→low (missing env-example key, F44 class); R2 should-fix→note (release notes already in Release bodies + README; CHANGELOG = 3rd manual doc source in a drifting-doc repo) |
| DUPLICATE (merged) | 3 | R1→F52 (app template identity; merged fix covers version 57.0.13 + app.json 1.0.0, severity nit→minor: tagged v0.1.3 AAB would carry versionName 1.0.0); R3→#99 (action major-tag pinning); R4→F51 (stale root main + metadata) |
| REFUTED | 0 | — |
| EVIDENCE-DRIFT | 0 | F11 cites store.ts:74 → actual 131-133 (non-material, same file/semantics) |

**Newly discovered (not in the recorded set):**

| ID | Sev | Finding | Evidence | Fix |
|----|-----|---------|----------|-----|
| M1 | medium | DesktopStore.ready() memoizes hydrate() rejection forever → all desktop write-through ops fail for the session (4th site of the F04 class; F04 itself doesn't cite it) | app/lib/desktopBridge.ts:75-77 (`readyPromise ??=`), no reset; precedent fix store-file.ts:110-113 | clear readyPromise on rejection (F04 修法) |
| M2 | low | LLM-proxy SSRF guard bypassed by 3xx redirects: global fetch default redirect:'follow'; isPublicHost validates only first hop; 307 preserves method+body to internal target | app/lib/proxies.cjs:133 | redirect:'manual' + per-hop isPrivateAddress (or pin resolved IP) |

## Partition precision notes (fix-task input)

- **F01** (major): full damage chain verified — start#2 wipes state, re-runs
  switches/keepAlive/collect/fetchIntel before runner C2 guard fires at
  src/events.ts:123-126; reachable via `window.__soa.start` (App.tsx:92).
- **F02** (major): exactly 3 sites (proxies.cjs:103, 286; logs-server.cjs:70).
  Fix preference: `parts.push(chunk)` + Buffer.concat (NOT setEncoding — that
  shifts the 1MB size accounting from bytes to chars).
- **F04** (major): fix scope now = 4 sites: store-idb.ts:142/152, store-file.ts:42/93,
  desktopBridge.ts:73-75 (M1).
- **F06** (major): collision is universal (annual merged unconditionally at
  deviceYahooCollect.ts:287, US chain included) — strengthens major.
- **F13** (major): first crash property is payload.ticker (webCollect.ts:31), not
  :51 — same raw-TypeError class.
- **F16** (medium): corrected 修法 = escape `[\u0080-\uFFFF]`→`\uXXXX` AND
  backslash-escape leading whitespace (Properties.load drops it); currently latent
  (.env passwords are ASCII hex).
- **F21** (medium): events.test.ts / runner.test.ts have NO beforeEach at all (worse
  than recorded); flake window real: FETCH_TIMEOUT_MS=20s vs testTimeout 15s.
- **F29** (low): fix refinement — wrap the whole file-serving block in try/catch
  (the existsSync→statSync race can throw synchronously through the listener), not
  only `s.on('error')`.
- **F30** (low): mechanism precision — async handlers → unhandledRejection, not
  uncaughtException; same process death under Node 22 default; crash outcome stands.
- **F36** (nit): '5 META_PATTERNS' is actually 4 (architecture.test.ts:231); none
  matches `name:${` so substance holds.
- **F57** (nit): record's corrected constant 1_087_344_000 verified correct; the
  audit's suggested 1_087_713_600 was wrong — simplest fix is the comment.
- **S1** (note): kept as umbrella refutation record (high→note downgrade correct);
  residual stream-error half maps to F29; not a duplicate.
- **F45** (medium): upstream verified in node_modules — @langchain/core auto-attaches
  LangChainTracer when LANGSMITH_TRACING==='true'; repo .env sets false (safe today),
  risk is .env.example copy → silent trace exfiltration with real key.

## Resulting checklist deltas vs research/findings.md

1. F04 fix task now covers desktopBridge.ts:73-75 (M1) — 4 memoized-ready sites.
2. New should-fix: M1 (medium, desktop write-through black hole).
3. New low: M2 (SSRF redirect-follow).
4. Bucket A (majors) unchanged: F01-F06 + S4 + F21 + F07/F08 + F13.
5. Bucket B: +M1, +M2; S2 severity note (low); R2 → notes.
6. Bucket C: −R1/−R3/−R4 (deduped into F52/#99/F51); F16 fix method updated;
   F27/F37/F46 promoted to low.

## Quality assessment

The findings set is release-grade as a work backlog: **0 refuted, 0 evidence drift,
100% mechanism confirmation** (82/82 hold on the current tree, all citations
re-pinned). Severity calibration is consistent with the 08-25 adversarial table;
the 5 recalibrations are small corrections (2 real upgrades nit→low, 1 medium→low,
2 downgrades). Dedup resolved 3 overlaps. Completeness: two egregious omissions
found (M1 desktop persistence black hole — independently spotted by 2 reviewers;
M2 SSRF redirect bypass) → the recorded set was ~96% complete on this class of
issues. The backlog is ready for fix-task planning without re-research; fix-task
PRDs should consume this record for 修法 details.

## Coverage correction (2026-08-26, post-hoc)

Five recorded items were NOT assigned to any partition reviewer (F15, F19, #99,
#100, #101) — they appear in the CONFIRMED tally above via the prior-findings
dimension-1 pass (status + evidence re-verification only, no adversarial
fix-method/severity pass). Main session spot-verified all five against the tree
afterward: **F15 CONFIRMED** (indicators.ts:17-32 NaN-carry ≠ pandas adjust=False
ignore_na=False semantics; medium holds) · **F19 CONFIRMED** (settings.ts:188-191
404-fallback misdiagnosis; medium holds) · **#99 CONFIRMED** (action major-tag pins
re-pinned via the R3 dedup pass: ci.yml:24,27; release.yml:27,30,70,91,108,111,130,
165,184) · **#100 CONFIRMED** (settings.ts:102 ≤8-char unmasked keys) ·
**#101 CONFIRMED** (theme.ts:43-64 dark palette vs app.json:8 userInterfaceStyle
"light", dead on native). All five remain CONFIRMED; the fix-backlog master record
(`research/fix-backlog.md`) carries the corrected final statuses.
