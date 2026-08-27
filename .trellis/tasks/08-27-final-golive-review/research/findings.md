# Final Pre-Go-Live Review — Findings (2026-08-27)

Task: `.trellis/tasks/08-27-final-golive-review`. Method: 5 parallel read-only
subagents (closure majors+mediums, closure nits, fix-diff review,
security-reviewer, release/hygiene trellis-check) + main-session real gate
runs. Surprising claims re-verified against code (~35% false-positive budget).

## Verdict

**READY for go-live — 0 blockers.** All 78 backlog items from the 08-27
remediation series verified FIXED in-tree (77 code + 1 process artifact S4),
all quality gates green, fixes reviewed as a diff with no introduced bugs.
4 should-fix items (none block the default loopback deployment) and a
release-process prerequisite (tag position + S4 rotation execution).

## Quality gates (real runs, HEAD 2d9a91b)

| Gate | Result | Evidence |
|------|--------|----------|
| `npx vitest run` | PASS | 56 files: 55 passed/1 skipped; **653 passed / 1 skipped** (baseline ≥627) |
| `npx tsc --noEmit` | PASS | 0 errors |
| `npm run chart:build && chart:check` (app/) | PASS | `chart:check:OK —— 生成物与源模板一致` (F31 mirror; chart scripts live in app/package.json, not root) |
| `git status --porcelain` | clean | only untracked review task dir; 36 commits in 213fe13..HEAD |

## Closure verification (78 items, per-item evidence in closure.md)

- Majors + mediums (48): **47 FIXED / 1 N/A / 0 open**. S4 = manual
  pre-release rotation, checklist artifact committed and substantive
  (`08-27-golive-fix-backlog/research/rotation-checklist.md`).
- Nits (30): **30 FIXED / 0 open**.
- Every item source-verified at HEAD (not commit messages); contract changes
  carry deterministic offline tests (F01 re-entry, F02 CJK chunk round-trip,
  F03 rotation, F06 annual rates, F10 drain, F13 typed error, F14 TZ, F20
  Beijing day, F21 offline isolation, F30 400 path, S2 allowlist, #97, #100).

## Findings (post-fix residual)

| Sev | Finding | Evidence | Next step |
|-----|---------|----------|-----------|
| should-fix | **SSRF blocklist bypass: hex-form IPv4-mapped IPv6** — `::ffff:7f00:1` (=127.0.0.1) classified public; dotted-quad regex only (proxies.cjs:64), IPv6 prefix branch no mapped-embedded-quad handling (:76-89); `::ffff:a00:1` (10.0.0.1) etc. likewise. **Verified by main session.** | app/lib/proxies.cjs:64,76-89,115-124,199-207 | Extract embedded IPv4 from any `::ffff:0:0/96` (dotted AND hex), re-run IPv4 blocklist; tests for `::ffff:7f00:1`, `::ffff:0:7f00:1`, `::ffff:a00:1`, `::ffff:c0a8:101` |
| should-fix | **S6 token gate unsatisfiable by shipped client** — non-loopback HOST requires `Authorization: Bearer <SOA_ACCESS_TOKEN>` (server.mjs:176-182) but zero client wiring exists (grep: token only in server.mjs/.env.example/tests); `/llm-proxy` uses the same header slot for the LLM provider key forwarded upstream (proxies.cjs:178) → documented HOST=0.0.0.0 mode 401s every proxy call; token would also leak to LLM provider if a client could send it. **Verified by main session.** | app/server.mjs:173-183,213-215; app/lib/proxies.cjs:147,178 | Either wire token client-side on a dedicated header (X-SOA-Token) stripped before forwarding, or re-document HOST=0.0.0.0 as reverse-proxy-only (nginx → 127.0.0.1, loopback → no token). Loopback/desktop unaffected |
| should-fix | README still advertises 暗色主题, removed by #101 | README.md:61 vs app/theme.ts, app/app.json:8 | One-line feature-list edit |
| note | Tag v0.1.3 sits **38 commits behind HEAD** (3eda58e, pre-fix series); release.yml runs on the tag → would build the pre-08-27 tree | `git rev-parse v0.1.3`; `git rev-list --count 3eda58e..HEAD` = 38 | Re-point tag at HEAD or bump v0.1.4 (+desktop/package.json) before pushing release |
| note | Desktop child: ambient `HOST=0.0.0.0` env forces requireToken on a loopback-only listener → all proxy calls 401, desktop broken (functional edge, not a hole) | server.mjs:213-215; desktop/child.mjs:193-198 | Derive requireToken from effective bind or pass explicit option |
| note | CSP lacks frame-ancestors / X-Frame-Options → local SPA iframeable (low clickjacking surface) | server.mjs:32-37; proxies.cjs:31-36 | Add `frame-ancestors 'self'` or X-Frame-Options: DENY |
| note | M2 redirect exhaustion breaks (`!location`/`hops>=5`) forward Location-less 3xx, then cancelled-body for-await throws → `res.destroy()` mid-response instead of the 502 JSON promised; fail-closed, no security impact. **Verified by main session.** | app/lib/proxies.cjs:188-193,220-223 | Return 502 JSON in break paths |
| note | F34 comment misstates limit: "1MB 上限" vs actual `MAX_MESSAGE_BYTES = 4KB` (body cap 64KB). **Verified by main session.** | app/lib/logs-server.cjs:102 vs :15-16 | Fix comment figure to 4KB |
| note | FileStore.close() drain task clears maps after close; post-close mutator's memory update erased, contradicting its own comment (no production caller mutates after close — latent) | src/store-file.ts:190-201 | Clear maps synchronously in close() or correct comment |
| note | Android job tag gate validates desktop/package.json only, not app/app.json versionName (aligned today at 0.1.3) | release.yml | Optionally extend gate to app/app.json |
| note | Root package.json lacks `private: true` / license (dev workspace, no publish path) | package.json:1-3 | Cosmetic; add `"private": true` |
| note | Supply chain: `allowScripts {"**": true}` + floating ^ ranges (pre-existing W7); no new/risky deps in range; lockfiles committed | app/package.json:36-38 | Consider narrowing allowScripts; pin node-tdx-market |
| info | S4 rotation (keystore + distinct passwords → .env + ~/.soa-android-env.sh + 4 GH secrets → fingerprint verify) must be EXECUTED on the release machine before first signed release; store==key password noted today | rotation-checklist.md (8 sections) | Pre-release process step, not code |

## Residual security-item status (S1–S7, M2)

| # | Status | Evidence |
|---|--------|----------|
| S1 | MITIGATED | serveStatic try/catch + stream error destroy (server.mjs:41-82); tests |
| S2 | MITIGATED | Origin allowlist both surfaces (server.mjs:150-171, metro.config.js:84-103); zero CORS |
| S3 | PARTIAL | Blocklist extended (2002::/16, 2001::/32, 2001:db8::/32, 64:ff9b::/96, 100.64/10, 198.18/15); TOCTOU documented infeasible; **hex-form mapped-IPv6 bypass** (finding above) |
| S4 | MITIGATED (execution pending) | .env gitignored + absent from index; .env.example all-empty; rotation checklist committed |
| S5 | MITIGATED | CSP/nosniff/cache headers both surfaces + tests (missing frame-ancestors, note above) |
| S6 | MITIGATED (2 wrinkles) | Bearer gate + safe 401 on 5 endpoints (server.mjs:173-183); wrinkles: client can't satisfy it, token forwarded upstream |
| S7 | DOCUMENTED DESIGN | Plaintext local storage, keys masked in logs (#100) |
| M2 | MITIGATED | redirect:'manual' + per-hop re-pin + ≤5 hops (proxies.cjs:181-214); same hex-mapped gap as S3 finding; 3xx-tail UX note |

## Fix-series diff review (213fe13..HEAD, per-file verdicts)

All major-touch files judged correct: analysisController.ts (F01/F20/#96/F38 —
guard no interleave window, finally resets), proxies.cjs (F02/F30/S2/S3/M2 —
byte cap per-chunk, SSRF complete at resolved-address level), server.mjs
(S2/S5/A6/F28/F29 — CSP verified against built dist: single external script),
store-*.ts (F04 safe — awaiters resume in one microtask drain; F10 matches
IdbStore; F11 MAX(date) baseline consistent; F12 rethrow; H1 fully removed),
yahoo compose/collect (F06 sound — first-wins dedup keeps quarterly row),
desktop child/main (F07/F08/F09 correct), chart mirror (F31 pure relocation),
CI (all 5 pinned SHAs verified against upstream commits; lockfiles exist),
tests (still meaningful offline). No spec pre-check violated, no second bug
found. 0 blocker / 1 should-fix (S6, above) / 3 notes (above).

## Pre-go-live checklist (blockers first)

1. **(process)** Re-point tag v0.1.3 at HEAD or tag v0.1.4 before pushing the
   release — current tag builds the pre-fix tree.
2. **(process)** Execute S4 rotation checklist on the release machine before
   the first signed build (keystore + passwords; GH secrets propagation).
3. (should-fix, cheap) README.md:61 remove stale 暗色主题 claim.
4. (should-fix, security) Close hex-form mapped-IPv6 SSRF bypass in
   proxies.cjs isPrivateAddress + tests. Recommended before enabling
   HOST=0.0.0.0 or shipping; defense-in-depth for default loopback.
5. (should-fix, functional) Decide S6: wire client token on X-SOA-Token
   (stripped before upstream) or document HOST=0.0.0.0 as reverse-proxy-only.
6. (notes, optional) CSP frame-ancestors · M2 502-on-exhaust · F34 comment
   4KB · FileStore drain comment · HOST-env contamination guard · android
   version gate · root private:true.
