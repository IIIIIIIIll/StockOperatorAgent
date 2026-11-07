# PRD: 两个历史/运行竞态(R-02 / R-03)

来源:`docs/code-review-2026-11-05.md` P1 · R-02、R-03。

## R-02 · `openRun` 在 await 之后不再检查 running

**现象:** 点历史行后立刻点「开始分析」→ `start()` 全量重置并置 `running = true`,
随后挂起的 `load` 返回,`applyReportBody` 把归档正文写进 `events` / `statuses` /
`finalDecision`,盖掉刚启动的运行;之后实时 `done` 又追加在历史 events 上。

**根因:** `if (s.running) return;` 只在 `await load()` **之前**判一次。

**修复:** `load` await 之后补同一检查。`return` 落在 try 内,`finally` 照常
清 `historyLoading` 并广播。

## R-03 · `refreshHistory` 覆盖刷新期间新增的记录

**现象:** 刷新(↻ 或启动链)途中完成一次分析 → 记录已写盘、已 prepend 进
`s.history`,但 `list()` 的陈旧快照随后无条件赋值,把这条从抽屉与 ☰ 徽标里抹掉,
直到下一次刷新。

**根因:** `recordRun`(`:489`)prepend 与 `refreshHistory` 的直接赋值互不知情。

**修复:** 新增纯函数 `mergeRunSummaries(fresh, state)`(`src/runHistory.ts`):
`fresh`(磁盘快照)为权威——同 id 取磁盘版,保留只存在于 `state` 的条目,
最后 `sortSummaries` 统一时间倒序。`refreshHistory` 改用它。

不做:把 `recordRun` 的持久化 await 进 UI 路径(违反写穿异步契约)。

## 验收

- [x] `test/run-history.test.ts`:`mergeRunSummaries` 同 id 取磁盘版 / 保留 state 独有 /
      不改入参 / 空侧;旧行为(直接赋值)下这些断言无关,控制器测试才是回归点。
- [x] `test/analysis-controller-history.test.ts`:
      「读盘期间发起新分析 → 历史正文不得盖到实时运行上」(gated `load` + pending runner);
      「刷新期间完成的运行不被陈旧的 list 快照覆盖」(gated `list()`)。
      两者在去掉对应守卫后均为红(已实测)。
- [x] `npx vitest run` 738 passed / 2 skipped;`npx tsc --noEmit` 0 error。
- [x] `docs/code-review-2026-11-05.md` R-02、R-03 勾选。
