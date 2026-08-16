# dead-code-cleanup:死代码清理(H1-H4)

## Target
`app/screens/ReportScreen.tsx`(删)、`app/lib/runner.ts:98-125`(删 CFG_KEY 三函数)、`app/assets/chart-view.html`(删或 .gitignore)、`app/lib/log.ts`(删 shim)、`app/lib/settings.ts:7`(log import 直连 src/log.ts)。

## Change
按父 design.md 归属表。**不动 useAnalysis.ts**(其 log import 由 collect-refactor 处理)。删除后全仓 grep 无悬空引用。

## Acceptance
- 四类死代码清除,引用方已迁移/无引用
- 全仓 grep(ReportScreen/readSavedConfig/saveConfig/clearConfig/CFG_KEY/chart-view.html)仅剩文档命中
- skip 验证/commit(父统一)
