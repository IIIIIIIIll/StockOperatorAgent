# Code Review — 2026-11-05 (`HEAD~3..HEAD`)

Review of the three commits landed after the v0.1.8 review cycle. No code was changed.

**Range:** `HEAD~3..HEAD` (24 files, ~2277 insertions, 33 deletions)

| commit | subject | spec |
|---|---|---|
| `9340c77` | feat(app): 分析历史归档——每次分析留档,按天分组查看/删除 | `.trellis/tasks/archive/2026-11/11-04-analysis-run-history/prd.md` |
| `b02971e` | fix(llm): fake-IP 代理环境恒 403 与 Base URL 控制字符 404 | `.trellis/tasks/archive/2026-11/11-04-fakeip-proxy-fix/prd.md` |
| `6638d15` | feat(app): 左上角 ☰ 改为抽屉二级菜单(设置/历史) | **none** |

## Method

Five parallel review agents, one axis each:

1. **Standards** — `.trellis/spec/**` contract + Fowler smell baseline
2. **Spec** — `11-04-analysis-run-history` PRD vs `9340c77`
3. **Spec** — `11-04-fakeip-proxy-fix` PRD vs `b02971e`, plus the unspecced `6638d15`
4. **Correctness** — races, leaks, error paths, proxy sanitisation
5. **Test quality** — coverage holes in the four new test files

The agents ran without shell access, so they reviewed HEAD file state rather than
diff hunks (identical content to the range tip; the three commits are the last three
on the branch). **Every P0 and P1 below was then re-read and confirmed by the parent
against the working tree** — the `verified` column records which.

## Baseline (green before and after this review)

| check | result |
|---|---|
| `npx vitest run` | 733 passed, 2 skipped, 59 files |
| `npx tsc --noEmit` | exit 0 |
| `test/architecture.test.ts` 7 assertions | hold (new `src/runHistory.ts` is platform-neutral; no `node:`/`react-native`/`better-sqlite3` leak; no bare demo-ticker literals) |

Status legend: `[ ]` open · `[x]` done · `[~]` intentional (user decision — will not implement)

---

## P0 — data shown wrong

### [ ] R-01 · 历史详情把实时分片盖在归档正文上

- **Where:** `app/lib/analysisController.ts:437-463` (`applyReportBody`), `app/lib/analysisController.ts:255-264` (`cancel`), `app/components/ReportContent.tsx:40`, `:68`
- **Verified:** yes
- **Axis:** Correctness

`applyReportBody` sets `events` / `statuses` / `hasDone` but never resets `s.partials`.
`ReportContent` renders `const text = partial || fallback || ''` — the partial wins.
`hasAny` (`ReportContent.tsx:68`) also counts partials, so a stale partial can make an
empty tab look populated.

**Trigger:** 开始分析 → 取消 mid-stream (leaves `partials` populated) → ☰ → 历史 → tap any
archived run. 最终结论 shows the cancelled live run's manager partial over the archived
`final_decision`; opinion tabs show 初稿/对抗修订 from the dead run.

**Fix:** `s.partials = {};` inside `applyReportBody`, next to `s.statuses = sts`.
Also consider clearing `partials` in `cancel()` (`:261` clears `statuses` only).

---

## P1 — real bugs on reachable paths / documented-standard breaches / data-loss test holes

### [ ] R-02 · `openRun` 在 await 之后不再检查 running

- **Where:** `app/lib/analysisController.ts:299-303`
- **Verified:** yes · **Axis:** Correctness

`if (s.running) return;` runs **before** `await this.deps.runArchive.load(id)`; nothing
re-checks afterwards.

**Trigger:** tap a history row, then immediately 开始分析. `start()` performs its full reset
and sets `running = true`; the pending `load` then resolves and `applyReportBody` overwrites
`events` / `statuses` / `finalDecision` mid-run, and the live `done` content is appended onto
history-injected events.

**Fix:** re-check `if (s.running) return;` immediately after the `load` await.

### [ ] R-03 · `refreshHistory` 覆盖刷新期间新增的记录

- **Where:** `app/lib/analysisController.ts:285`
- **Verified:** yes · **Axis:** Correctness

`recordRun` prepends at `:483` (`s.history = sortSummaries([toSummary(run), ...s.history])`),
but `refreshHistory` assigns whatever `list()` returned unconditionally, so anything written
after `list()` started is discarded from state.

**Trigger:** press ↻ in the drawer (or the bootstrap refresh) while an analysis completes →
the run is persisted but disappears from the drawer and the ☰ badge until the next refresh.

**Fix:** merge by id (`list` wins for shared ids, keep `s.history` entries absent from `list`).

### [ ] R-04 · LLM 可达性检测绕过 `sanitizeLlmValue`

- **Where:** `app/lib/settings.ts:214`, `:233` (and `:196` logs the raw model)
- **Verified:** yes · **Axis:** Standards + Spec

The file imports and uses `sanitizeLlmValue` at `:156-158`, `:184-185`, but the two
`Authorization` header sites only `.trim()`. A key carrying a NUL — the exact defect class
`b02971e` fixes — survives into the header, `undici`/OkHttp reject it, `:227` logs
「LLM 代理不可达——回退浏览器直连」, `:233` throws again and the user sees a raw TypeError.

Breaks `.trellis/spec/ts/env-switches.md:57` (四净化入口 must include `checkLlmReachability`).

**Fix:** `const key = sanitizeLlmValue(keys.llmApiKey);` at both header sites; sanitise the model in the log.

### [ ] R-05 · 历史行缺少行内单条删除(PRD R6 未实现)

- **Where:** `app/screens/HistoryPanel.tsx:119-150`
- **Verified:** yes · **Axis:** Spec

PRD R6 verbatim: 「删除:**行内单条删除**;「编辑」态多选批量删除;「清空全部」。删除全部/批量需**行内二次确认**」.
Rows render only `›` (or a checkbox in 编辑 mode); `onDelete` is reachable only through
`selected` at `:196`. Single deletion therefore requires 编辑→选中→删除→二次确认 — both
missing the specified affordance and over-guarding the case that needs no confirm.

**Fix:** row-level `✕` in non-select mode → `onDelete([r.id])` directly.

### [ ] R-06 · IDB `remove()` 返回值不是实际删除数

- **Where:** `app/lib/runArchive.ts:169` (contract at `:44`)
- **Verified:** yes · **Axis:** Standards + Tests

`return ids.length` is unconditional. The file/memory backends return real counts, and the
caller logs `删除历史分析:${removed} 条` — so the IDB path reports deletions that never happened.
`test/run-archive.test.ts:60` only removes an existing id, so the contract break is invisible.

**Fix:** read each id's presence before delete, return the real count, and add
`expect(await archive.remove(['missing'])).toBe(0)`.

### [ ] R-07 · 「再次 bootstrap 不重复」测试用了一个全新空 store

- **Where:** `test/analysis-controller-history.test.ts:158`
- **Verified:** no (agent) · **Axis:** Test

`const h2 = makeHarness({ archive: h.archive })` builds a **fresh, empty** `InMemoryStore`.
The test therefore passes even if the `RUN_HISTORY_MIGRATED_KEY` check is deleted entirely —
it cannot detect double migration.

**Fix:** thread the same `store` into the second harness.

### [ ] R-08 · 迁移失败分支零覆盖

- **Where:** `app/lib/analysisController.ts:418-425`
- **Verified:** no (agent) · **Axis:** Test

`put` throws → warn + marker **not** set + retry next boot. Nothing asserts
`store.getMeta(RUN_HISTORY_MIGRATED_KEY) === null` after a throwing `put`. A regression here
silently drops the user's `lastRun` forever.

**Fix:** harness with an archive whose `put` throws + `saveLastRun` + `bootstrap()`.

### [ ] R-09 · 无并发写入测试

- **Where:** `app/lib/runArchive.ts:268-276` (`enqueue`), `:288` (same-id dedupe)
- **Verified:** no (agent) · **Axis:** Test

The read-modify-write of the summaries index and `writeIndex` are only exercised sequentially.
`await Promise.all([put(a), put(b)])` then `list()` → 2 entries would catch index loss; the
same test can cover the dedupe filter.

### [ ] R-10 · 空索引不触发重建,磁盘上的记录会永久消失

- **Where:** `app/lib/runArchive.ts:235-238`, `test/run-archive.test.ts:156`
- **Verified:** no (agent) · **Axis:** Correctness + Test

`parseRunSummaries` on a parseable-but-empty index (`'{}'` / `'[]'`) returns `[]` **without**
rebuilding from body files, so a truncated/corrupted index silently hides every stored run.
Only the `{oops`-throw path is tested.

**Fix:** treat a non-array/empty result as needing rebuild; test with a valid `r1.json` +
`index.json='{}'` → expect `list()` = `['r1']`.

---

## P2 — judgement calls, spec drift, duplication, polish

### Structure & standards

- [ ] **R-11** `app/App.tsx:281-347` — drawer state machine, menu rows and sub-page routing live in `App.tsx`. `.trellis/spec/ts/chart-ui.md:89-90`: 「后续 UI 逻辑(新页面/新入口)一律进 hooks/ 或 components/,不回流 App.tsx」. Extract to `app/components/DrawerMenu.tsx`; keep only `☰` + `{open ? <DrawerMenu/> : null}`. *(verified)*
- [ ] **R-12** `app/lib/runArchive.ts:85-113` — `requestResult` / `txDone` / `openRunDb` are near-verbatim copies of `src/store-idb.ts:83-110` (Duplicated Code; two IDB conventions will drift). Export from `store-idb.ts` and import.
- [ ] **R-13** `app/lib/analysisController.ts:737-738` — `${globalThis.location.origin}` is the only unguarded `location` read in `app/`; `app/lib/runner.ts:220-222` documents the guard house rule. Use `globalThis.location?.origin ?? ''` and return `undefined` when empty. *(verified)*
- [ ] **R-14** `app/hooks/useAnalysis.ts:80` — `Platform.OS === 'web'` is a second platform-detection source alongside `detectPlatform()` (`ts/index.md:41` rule 5). *(verified)*
- [ ] **R-15** `app/lib/analysisController.ts:66` — `ControllerPlatform = 'web' | 'native'` invents a third vocabulary next to `src/log.ts:17` `Platform = 'web' | 'rn' | 'node'`. *(verified)*
- [ ] **R-16** `.trellis/spec/ts/index.md:25-30` — the layer map omits `runArchive.ts`, `analysisController.ts`, `runHistory.ts`, all added by this change.
- [ ] **R-17** `app/hooks/useAnalysis.ts:78-82` — comment claims 「模块级单例」 but the archive is built in `React.useMemo` = per mount. *(verified)*
- [ ] **R-18** `app/lib/runArchive.ts:42` — `createMemoryRunArchive` (test-only backend) ships in a production module; `testing.md` lists test-only branches as an anti-pattern.
- [ ] **R-19** `app/lib/settings.ts:327` — `export { createLlm };` has no consumer (dead re-export, Middle Man). *(verified)*

### Spec alignment (analysis history)

- [ ] **R-20** `app/lib/analysisController.ts:608-612` — `await refreshHistory(true)` sits on the startup critical path **before** the `loadLastRun` restore (`:640`). PRD R4: 「完整正文按需加载(**启动零额外开销**)」, Notes: 「启动成本不随历史增长」. Fire-and-forget after the restore. *(verified)*
- [ ] **R-21** `app/lib/analysisController.ts:430` — `store.setMeta(RUN_HISTORY_MIGRATED_KEY, '1')` is a `StoreLike` write. PRD R7: 「**不写入 `StoreLike`** → 不阻塞/不变慢既有 store 启动链」. Move the flag into the archive, or record it as a deliberate exception in the PRD. *(verified)*
- [ ] **R-22** `app/lib/analysisController.ts:287` + `app/App.tsx:321-324` — scope creep: `openRun` also calls `setTicker(row.ticker)` and `setActiveTab('final_decision')`. PRD R5 only says 「点击一条 → 在当前报告 Tab 内打开该次运行」. The ticker mutation silently rewrites form state.
- [ ] **R-23** `src/runHistory.ts:144` vs `:154-155` — doc comment says 「preview 缺失按空串补齐」 but the code drops the whole summary (`return null`) when `decisionPreview` is not a string. Violates PRD R9 「所有失败静默降级」. *(verified)*

### File backend (native path)

- [ ] **R-24** `app/lib/runArchive.ts` — three related defects:
  `list()` (`:281-284`) runs `ensureLoaded()` **outside** `queue`, so a cold-start scan concurrent with a queued `put` clobbers `summaries` and rewrites `index.json` without the new entry. *(verified)*
  `remove()` (`:296-306`) only deletes body files present in the in-memory index, so a body written before a failed `writeIndex` becomes an undeletable orphan that resurrects on the next rebuild. *(verified)*
  A throw in `write`/`moveSync` leaves `<name>.tmp.*` behind; only `clear()` sweeps them.

### Proxy / fake-IP

- [ ] **R-25** `app/lib/proxies.cjs:164` — `isFakeIpAddress` returns false for anything that is not dotted-quad IPv4, but `isPrivateAddress` also decodes hex. `::ffff:c612:1232` (=198.18.18.50) is therefore judged private-and-not-fake → still 403, while `::ffff:198.18.18.50` passes. `.trellis/spec/ts/events-streaming.md:98-101` records this exact hex-vs-dotted lesson as mandatory. Share one normaliser. *(verified)*
- [ ] **R-26** `app/lib/proxies.cjs` `pinPublicHost` — no injection seam (`dns.promises.lookup` is called off a module-level require), so the PRD's 「混合应答按最严」 and `events-streaming.md:113` have **no test**. Add `pinPublicHost(u, _lookup = dns.promises.lookup)` + one mixed-answer case.
- [ ] **R-27** `proxyRejection` is shape-only, so an upstream `401 {"error": …}` is mislabelled 「代理拒绝」 and loses the 检查 API Key hint.

### Unspecced commit `6638d15` (☰ drawer)

- [ ] **R-28** Drops the 右上角「历史」 entry point, contradicting archived PRD 「**入口**:右上角独立按钮」 with no amendment note. No automated coverage of drawer navigation. *(verified: entry removed)*
- [ ] **R-29** Dead style `sidebarTab` at `app/App.tsx:504` (zero usages) and stale copy: `App.tsx:92` 「在侧边栏「LLM(大模型)」填写后保存」, `:2-3`, `:474-475` 「右侧历史按钮」. *(verified)*

### Task artifacts

- [ ] **R-30** `.trellis/spec/ts/env-switches.md:55` cites task `11-04-llm-url-nul`, which does not exist under `.trellis/tasks/archive/2026-11/` — the NUL-sanitise half of `b02971e` ships with no PRD.
- [ ] **R-31** `.trellis/tasks/archive/2026-11/11-04-fakeip-proxy-fix/` — `implement.jsonl` and `check.jsonl` are still the `{"_example": …}` template; `task.json` has `"commit": null`, `"relatedFiles": []`. A `completed` task with no implement/check record, so the PRD's 「731 passed / tsc 0 error」 has no artifact.

### Remaining test gaps (lower priority)

- [ ] **R-32** `test/analysis-controller-history.test.ts:128` — the case titled 「error 事件不落档」 never emits an `error` event; it only makes `put` throw. Emit `{type:'error'}` and assert the archive stayed empty.
- [ ] **R-33** Zero coverage: `formatRunClock` / `formatRunTime` (`src/runHistory.ts:191,199`, incl. NaN→`''`), and the catch branches of `deleteRuns` / `clearHistory` / `openRun` (`analysisController.ts:319,373,393`).
- [ ] **R-34** `src/metaKeys.ts:24` `'soa:runs-migrated'` is not pinned in `test/metaKeys.test.ts` despite that file's 「跨会话键名不可漂移」 convention — a rename would re-migrate an already-cleared history.
- [ ] **R-35** `app/hooks/useAnalysis.ts:105-113` — `graceTimerRef` is never cleared on unmount, so a 90 s timer can fire after teardown. *(verified)*

---

## Verified clean

Checked and found compliant — recorded so a future review does not redo the work:

- Single logging exit: `analysisController` takes an injected `{info,warn,error}` wired from `src/log.ts`; `runArchive` imports `error as logError`. Zero new `console.*` in `app/lib|hooks|screens`.
- `metaKeys` single source: `RUN_HISTORY_MIGRATED_KEY` at `src/metaKeys.ts:24`; no `600036` / `f10:${` / `demo:f10` literals outside it.
- Env reads via `envValue` (`analysisController.ts:656`); `EXPO_PUBLIC_*` only via documented direct member access.
- `src/runHistory.ts` is platform-neutral (type-only imports: `./events.ts`, `./market.ts`).
- `analysisController.ts:20` uses `import type { StoreLike }` — architecture assertion 3 holds.
- Test house style: injection over mocks everywhere (`IDBFactory`, `nodeRunFs`, `createMemoryRunArchive`, fake runner + `InMemoryStore`). Zero `jest.mock` / `vi.mock`.
- `app/lib/runArchive.ts` is fully drivable from the root vitest config via injected `factory` / `getFs`; only `createExpoRunFs` (`:279-306`) is unreachable, guarded by the hand-written `src/expo-file-system.d.ts`.
- PRD requirements R1, R2, R3, R4 (loading contract), R5 (stash/restore), R8 (IDB `soa-runs`; file backend tmp+atomic), R9 (logging), R10 (no new deps) are implemented as specified.
- `test/proxies.test.ts:134,151,164` and `test/settings-llm-classify.test.ts:36-87` cover every case listed in the fake-IP PRD.

## Limitations of this review

- The five agents had no shell, so hunks were not read as diffs — everything was judged from
  HEAD file state plus the commit table. Content is identical (these are the last three
  commits), but per-commit attribution for P2s is inferred rather than proven.
- No run against a real device or a real fake-IP network. R-25's hex form was reasoned from
  `net.isIPv4` semantics, not observed as a live 403.
- Reviewers did not run `npm test`; the parent did (green). Nothing here is blocked by a red build.

## Suggested order of work

1. **R-01** — user-visible wrong content, one-line fix + one regression test.
2. **R-02**, **R-03** — mid-run state corruption, both small guards.
3. **R-04** — the sanitise fix the commit intended, 3 lines.
4. **R-05**, **R-06** — finish the PRD's delete story.
5. **R-07…R-10** — coverage over branches that are already suspect.

Raw per-axis reports: `~/.pi/agent/sessions/--home-tan-StockOperatorAgent--/subagent-artifacts/*_reviewer_output.md`
