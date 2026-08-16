# App.tsx 重构:抽取 useAnalysis hook

## Goal

`app/App.tsx`(503 行)是单体:11+ 个 state/ref + 启动 effect + 订阅 effect + 100 行 `start()` 编排 + 全部渲染焊在一起。目标是抽取 `useAnalysis` hook(分析状态 + 启动链 + 订阅 + start 编排),App.tsx 瘦身为"UI 状态 + 渲染 + 样式"。**纯重构,行为零变化**,不做任何功能改动。

用户价值:新增入口(如独立"仅查看上次结果"页)或换 UI 框架时不再需要重写编排逻辑;App.tsx 可读性/可测性提升。

## Confirmed Facts(代码证据)

- `app/App.tsx` 当前 503 行:`makeStyles` ~80 行,渲染 ~160 行,分析逻辑(状态/启动 effect/订阅 effect/start/onSettingsChange/派生)~250 行。
- 分析状态清单:`events` / `finalDecision` / `stockInformation` / `running` / `error` / `partials` / `statuses` / `dataVersion` / `lastRunTicker` / `modeRef` / `lastRunAt` / `settings`。
- 纯 UI 状态:`activeTab` / `showSettings` / `ticker`(输入框值)。
- 派生(UI 侧可保留):`missing` / `gateNotice` / `tabs` / `activeReports`(依赖 activeTab)/ `activeRole` / `progress`。
- `start()` 读取 `ticker`(state)、`settings.keys/switches/caps`;`__soa` 调试钩子调用 `start()`/`setActiveTab`/读 `finalDecision/events/running/partials/statuses`(`App.tsx:254-262`)。
- 订阅 effect 空依赖数组,闭包内只用 `modeRef`(ref 稳定)与模块级 `enabledRoles()`(新鲜)。
- 无现成 hooks 目录;`app/lib/` 是桥接/基础设施(runner/settings/log/proxies/shim),`app/components/`、`app/screens/` 已存在。

## Requirements

- R1 新建 `app/hooks/useAnalysis.ts`,抽取:全部分析状态(含 settings/modeRef/lastRunAt)、启动 effect(storeReady → 缓存恢复/demo → loadSettings → 提示)、`runner.subscribe` effect、`start()` 编排(校验/采集/情报/双算/keepalive)、`onSettingsChange`。
- R2 `start` 签名参数化:`start(ticker: string)`(ticker 输入框留在 App)。
- R3 App.tsx 保留:`activeTab`/`showSettings`/`ticker` UI 状态、`__soa` 钩子 effect、派生选择器、全部渲染与 `makeStyles`。
- R4 行为逐点等价:启动链顺序、缓存恢复(含经理 chips 修复)、keepalive 启停、采集失败中止、错误展示、`__soa.getState` 数据面。
- R5 不新增依赖(不引入 react-test-renderer 等)。

## Acceptance Criteria

- [ ] AC1 `app/App.tsx` 行数下降(目标 ≤330 行,含样式),`app/hooks/useAnalysis.ts` 承载分析逻辑。
- [ ] AC2 `cd app && npx tsc --noEmit` 全绿。
- [ ] AC3 根 `npx vitest run` 全绿(无业务逻辑变更,不应新增/修改测试)。
- [ ] AC4 web 冒烟:清空缓存 → demo 占位路径;注入种子缓存 → 恢复路径(标记行/7 chips"完成"/报告 Tab 内容)。
- [ ] AC5 模拟器冒烟:重启 App 恢复上次真实分析(标记行 + chips);再跑一次真实分析 `start()` 全链路跑通(采集 → 报告 → done → 缓存覆盖)。
- [ ] AC6 无行为回归:非法代码校验提示、北交所拦截、采集失败错误展示均保留(AC4/AC5 冒烟中抽查)。

## Out of Scope

- 不重构 `start()` 内部逻辑(双算、采集编排保持原样,仅搬家)。
- 不拆分 `agents.ts`、不合并图表三套渲染(见评估,非本任务)。
- 不新增测试设施(react-test-renderer 等)。
- 不改 `src/` 业务层(纯 UI 层重构)。

## Open Questions

无(纯机械重构,契约已由现有行为定义)。
