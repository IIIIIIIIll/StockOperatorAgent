# TS 本地数据持久化（web IndexedDB / RN 文件存储）

## Goal

补 TS 生产路径的跨会话数据持久化：web 端用 IndexedDB、RN 端用 expo-file-system 文件存储，实现 `StoreLike` 持久化后端，替换 `runner.ts` 的 `InMemoryStore` 生产接线。效果：页面刷新/应用重启不丢采集数据；C8 freshness 门（同日跳过）跨会话生效；每次打开不再全量重采集。

## Background

- 审计（08-14-py-ts-gap-audit）storage 分片 P1「需人工确认」项：web/RN app 无跨会话持久化（生产 InMemoryStore；SQLite Store 仅 Node probe/测试用）。用户 2026-08-14 决策：**补持久化**。
- 现状：
  - `ts/app/lib/runner.ts:20` `export const store = new InMemoryStore()`（web/RN 生产单例）
  - `ts/src/store.ts` `StoreLike` 接口 + `Store`（better-sqlite3，Node-only）
  - `ts/src/store-memory.ts` `InMemoryStore`（语义对齐 Store：addDatas 拒绝 date<=lastDataUpdate、业绩按 report_date 去重、replaceDatas 全量替换）
  - 业务层（pipeline/webCollect/DataScreen/events）只依赖 `StoreLike`，零存储后端感知
  - web 跑浏览器（expo web export + server.mjs）；RN 有 expo-file-system ~57.0.2，无 expo-sqlite
- 交互影响：C8 freshness 门读 `stock.lastDataUpdate`，当前 InMemory 刷新即失 → 同日跳过仅单会话生效。

## Requirements

1. **`IdbStore implements StoreLike`**（`ts/src/store-idb.ts`）：IndexedDB 持久化，表结构与 `Store` SCHEMA 对齐（stocks/daily_bars/performance_reports/meta 四对象存储），语义逐项对齐 `InMemoryStore`/`Store`（addDatas 增量去重、replaceDatas 全量替换、单事务/原子性、getDatas 返回新数组防外部改）。
2. **RN 持久化**：`expo-file-system` 文件后端（JSON 落盘，按 ticker/类别分文件或单文件快照——设计决策见 design.md），实现 `StoreLike`；无 expo-sqlite 依赖。
3. **平台接线**：`runner.ts` 按平台选择 Store——web（`Platform.OS === 'web'`）用 IdbStore；RN 用文件后端；`store` 导出保持 `StoreLike` 类型不变（零消费方改动）。
4. **初始化**：异步存储就绪（IndexedDB 打开/文件读取）与 App 启动顺序兼容——App.tsx 现有 `loadSettings`/`loadDemoData` 加载链需等待 store 就绪；demo 数据仅在空库时载入。
5. **freshness 门跨会话**：同日/同季跳过基于持久化 lastDataUpdate/report_date 判定，刷新后仍生效。
6. **数据兼容**：不要求迁移现有 InMemory 数据（内存本就无持久化）；新库为空 → 首次采集全量。
7. **测试**：IdbStore 单测（fake-indexeddb 或浏览器环境——设计决策）；RN 文件后端单测（临时目录）。

## Acceptance Criteria

- [ ] web 端刷新后：已采集 ticker 数据仍在（浏览器实测：采集 → 刷新 → 不重拉日K/数据可见）
- [ ] freshness 门跨会话：同日二次进入应用跳过日K 重拉（日志「跳过采集:日K(同日已采集)」）
- [ ] RN 后端文件落盘/读回正确（单测）
- [ ] 空库首次采集全量路径不变；demo 数据仅在空库载入
- [ ] `store` 导出类型仍为 `StoreLike`，业务层零改动
- [ ] vitest 全绿 + `tsc --noEmit`

## Out of scope

- Node probe/SQLite 路径改造（已有持久化，不动）
- expo-sqlite 引入（避免新增原生依赖）
- 数据迁移（InMemory 无持久数据可迁）
- 多 ticker 之外的存储面（meta 键已覆盖 name/f10/capital 缓存）

## Notes

- 报告语言：中文。
- 参考：`ts/src/store.ts`（SQLite 语义基准）、`ts/src/store-memory.ts`（内存实现）、`ts/test/store-gates.test.ts`（freshness 门测试）。
