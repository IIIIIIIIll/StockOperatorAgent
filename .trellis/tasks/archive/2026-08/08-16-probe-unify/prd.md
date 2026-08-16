# probe-unify:平台探针收敛(P6)

## Target
`src/log.ts`(detectPlatform 导出复用面)、`app/lib/runner.ts:30`(store 选择)、`src/webSearch.ts:79`(探针)。

## Change
按父 design.md「跨子契约 4」:runner store 选择与 webSearch 探针改复用 `detectPlatform()`;删除本地自写探针;webSearch 语义等价验证(`detectPlatform()==='web'` ⇔ 原 `window.location?.origin` 非空)。

## Acceptance
- 平台判定单面:全仓探针统一收敛(除 log.ts 内部)
- detectPlatform 复用单测(web/node/rn 三分)
- skip 验证/commit(父统一)
