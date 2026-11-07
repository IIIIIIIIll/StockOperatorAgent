# PRD: 分析历史归档(保存每次分析 + 按天分组查看/删除)

## Goal

当前只保留**最后一次**成功分析(`src/lastRun.ts` → meta 键 `soa:last-run`,
bootstrap 时恢复展示)。用户要求把**每一次**分析结果都留档,并能随时回看、
按天分组、手动删除。

用户已确认的三个决定(2026-11-04):

1. **入口**:右上角独立按钮,点开一个与左上角设置侧栏对称的抽屉面板。
2. **存什么**:完整报告 + 采集数据快照 —— 即现行 `LastRunRecord` 的全字段
   (`stock_information` / `final_decision` / `opinions`)+ 时间 + 模式 + 市场。
3. **保留策略**:**不设自动上限**,靠手动单条删除 / 批量删除 / 全清。

## Requirements

- R1 每次分析成功(`done` 事件)追加一条历史记录;失败(`error`)不写。
- R2 历史记录与 `soa:last-run` 并存:后者语义不变(启动恢复「上次结果」),
  历史是增量留档。首次升级时把已有 `soa:last-run` 迁移成第一条历史(只迁一次,
  用户清空历史后不得复活)。
- R3 `AnalysisRun` 字段:`id` / `at`(ISO)/ `mode`('real'|'demo')/ `ticker` /
  `market` / `stock_information` / `final_decision` / `opinions[]`。
  摘要 `RunSummary` = `id` / `at` / `mode` / `ticker` / `market` / `decisionPreview`。
- R4 列表按本地日期分组:**今天 / 昨天 / MM-DD 周X**(跨年补年份),
  组内按时间倒序;摘要列表只读小对象,完整正文按需加载(启动零额外开销)。
- R5 点击一条 → 在当前报告 Tab 内打开该次运行(采集数据 + 各角色报告 +
  最终结论),顶部显示「正在查看历史 · 时间 · ticker [返回最新]」;
  `返回最新` 回到点开前的实时状态(不丢正在看的结果)。
- R6 删除:行内单条删除;「编辑」态多选批量删除;「清空全部」。
  删除全部/批量需**行内二次确认**(不弹系统对话框)。
- R7 无自动裁剪;不写入 `StoreLike` → 不阻塞/不变慢既有 store 启动链。
  - **修正(2026-11-07 评审 R-21)**:迁移标记 `soa:runs-migrated` 是唯一的
    `StoreLike` 写,定为有意例外 —— 只在首次升级触发一次,单键、不随历史增长,
    storeReady 已就绪;替代方案要给 RunArchive 加 meta 面。
- R8 存储分层:web/桌面渲染进程用 IndexedDB(`soa-runs` DB:正文 `runs` 表 +
  摘要 `summaries` 表);RN 用 expo-file-system(`soa-runs/` 目录,正文
  `<id>.json` + `index.json` 摘要,写盘走 tmp + 原子替换);测试注入内存/假 fs。
- R9 所有失败静默降级 + `src/log.ts` 记录,不打断分析/UI(与 lastRun 同姿态)。
- R10 不引入新依赖;不违反 `test/architecture.test.ts` 七条断言。

## Out of scope

- 跨设备同步 / 导出 / 重新运行历史参数。
- 历史条目的图表数据快照(日K 图表仍读当前 store;仅文本快照留档)。
- 自动裁剪、按 ticker 过滤、全文搜索。

## Acceptance Criteria

- [ ] done 事件后历史多一条;重启 App 后仍在。
- [ ] 抽屉列表按天分组(今天/昨天/日期),组内倒序,显示 ticker/时间/模式/结论摘要。
- [ ] 点一条 → 报告 Tab 复现该次内容,「返回最新」恢复点开前状态。
- [ ] 单条删除 / 多选批量删除 / 清空全部生效且重启后仍生效;删除当前查看条目自动退出查看态。
- [ ] 首次升级(有 `soa:last-run`、无历史)自动补一条;清空后重启不复活。
- [ ] `npx vitest run` 全绿;`npx tsc --noEmit` 0 error;architecture 断言 7/7。

## Notes

- 历史属于**展示层归档**,不参与采集 freshness 判定,不进 `StoreLike`
  (四族同步契约不动;桌面 IPC 协议不动)。
- 详情按需加载而非启动全量 hydrate:不限制条数时启动成本不随历史增长。
