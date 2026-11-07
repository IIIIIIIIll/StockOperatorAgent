# PRD: 11-05 评审剩余项修复(P1 余 + P2 全量)

来源:`docs/code-review-2026-11-05.md`(1 P0 / 9 P1 / 25 P2)。R-01…R-03 已单独
归档(`11-07-review-r01-stale-partials`、`11-07-review-r02-r03-races`)。本任务
收掉其余 32 项。

## 批次与落点

| 批次 | 项 | 关键改动 |
|---|---|---|
| A | R-04 | `checkLlmReachability` 的 key/model 经 `sanitizeLlmValue` 后再进 header/日志/payload |
| B | R-05 | 历史行非多选态 `✕` 单条删除(Pressable 兄弟节点,避开 RN-web 冒泡) |
| C | R-06 | IDB `remove()` 同事务 `getKey` 探存在性 → 返回真实删除数 |
| D | R-07…R-10、R-24 | 共享 store 的迁移测试、迁移失败分支、并发写、空索引重建;文件后端 list 进队列 / 孤儿正文可删 / tmp 残留清理 |
| E | R-13、14、15、17、18、19、23、29、32、33、34、35 | location 守卫、平台判定单源、内存后端移出生产模块、preview 降级、死样式/死导出、测试可信度 |
| F | R-20、21、22、25、26、27 | 启动链不再 await 历史载入、迁移标记定为有意例外、历史行不改表单、`ipv4Of` 归一(hex mapped)、`pinPublicHost` 注入面、代理拒绝标记头 |
| G | R-11、12、16、28、30、31 | 抽屉状态机进 `hooks/useDrawer.ts`、IDB 包装单源 `src/idbUtil.ts`、spec 层映射、归档 PRD 备注、任务产物补齐 |

## 验收

- [x] `npx vitest run`:755 passed / 2 skipped(评审基线 733)
- [x] `npx tsc --noEmit`:exit 0
- [x] 每条 bug 类修复都做过反向验证:R-01、R-02、R-03、R-04、R-06、R-10 去掉
      修复后对应新测试为红(逐条实测)。
- [x] `docs/code-review-2026-11-05.md` 全部 35 项勾选,并附 Done 说明。

## 已知未覆盖(如实记录)

- R-05 / R-11 / R-28 是 UI 层:`HistoryPanel`、`App.tsx`、抽屉导航都没有组件/e2e
  自动化(仓库无 RTL 基建)。只有 `tsc` 与架构断言兜底。
- 抽屉视觉未实机回归(纯状态机迁移,样式与 JSX 结构未动)。
