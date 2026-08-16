# constants-single-source:常量单源(D3 + 键名/常量)

## Target
`src/billionsTools.ts`(导出默认常量)、`app/lib/settings.ts:48`(DEFAULT_CAPS)、新 `src/metaKeys.ts`、`app/lib/runner.ts:41,50`、`app/hooks/useAnalysis.ts:71,94,122,124`、`app/screens/DataScreen.tsx:26,34`、`src/webCollect.ts:55,65`、`app/App.tsx:25,84`。

## Change
按父 design.md「跨子契约 2/3」:caps 默认值单源(billionsTools 导出,settings import);metaKeys.ts 新增 DEMO_F10_KEY/f10Key/capitalKey/DEMO_TICKER;替换全部裸字面量与 '600036' 硬编码。LAST_RUN_KEY 不重复导出(已在 lastRun.ts)。

## Acceptance
- 全仓 demo:f10 / f10:${ticker} / capital:${ticker} / '600036' 裸字面量清零(经 metaKeys 引用)
- caps 三处默认值单一来源;单测验证一致性
- skip 验证/commit(父统一)
