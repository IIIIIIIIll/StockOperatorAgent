# PRD: 历史查看把实时分片盖在归档正文上(R-01)

来源:`docs/code-review-2026-11-05.md` P0 · R-01。

## 现象

开始分析 → 中途「取消」→ ☰ → 历史 → 点任意一条归档:

- 最终结论 Tab 显示的是刚才那次**被取消的运行**残留的经理分片(半截草稿),
  而不是归档的 `final_decision`;
- 观点 Tab 显示死掉的运行留下的初稿/对抗修订分片;
- `ReportContent.tsx:68` 的 `hasAny` 也把 partial 计入,于是空 Tab 看起来"有内容"。

## 根因

`app/lib/analysisController.ts` `applyReportBody()`(历史正文落地函数)重置了
`events` / `statuses` / `hasDone` / `market`,**唯独没有重置 `s.partials`**。
`ReportContent` 的槽位渲染是 `const text = partial || fallback || ''` —— partial 优先。
`cancel()`(:261)只清 `statuses`,partials 留在 state 里,于是被历史查看误用。

## 修复

`applyReportBody()` 在 `s.statuses = sts;` 旁补 `s.partials = {};`。

安全性:`openRun()` 在第 310 行(applyReportBody 之前)已把实时态(含
`partials: {...s.partials}`)存进 `this.liveStash`,`closeRun()` 逐字段写回 ——
清空不影响返回实时态时恢复用户正在看的分片。

不在本次范围:`cancel()` 是否顺带清 partials。取消后实时视图显示最后进度是
有意行为,且不属于 R-01(历史串内容)的现象。

## 验收

- [x] 新回归测试:start → emit token(经理节点)→ cancel → openRun(归档)
      → `snap().partials` 是 `{}`;`finalDecision` 等于归档正文;closeRun 后
      partials 恢复为取消时的分片。
- [x] `npx vitest run` 全绿;`npx tsc --noEmit` 0 error。
- [x] `docs/code-review-2026-11-05.md` 的 R-01 勾选为已修。
