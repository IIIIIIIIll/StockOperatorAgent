# 归一化收尾:桌面后端/配置注入/约定强制(父任务)

## Goal

关闭上一轮审计明确保留的未归一项,达成"所有代码归一且模块化":①纯 Node 桌面方案的 store/设置后端可用;②配置面从 process.env 隐式通道改为显式注入;③隐性架构约定用测试强制。3 个子任务并行。

## In Scope(3 子任务)

| 子任务 | 对应审计项 | 核心交付 |
|---|---|---|
| desktop-node-backend | P3(store/设置 Node 缺口) | `src/store-node.ts`(node fs 适配器,Node-only 不进 app 图);`runner.store` 改 `export let` + `setStore()` 注入点;settingsStore node 分支(注入面,node:fs 动态化规避 metro 解析);桌面接线示范 |
| config-injection | applySwitches 显式化 + B 审计 8 处 process.env 直读 | `src/switches.ts` 显式开关配置(`setCapabilitySwitches` 替代 `applySwitchesToEnv` 的 process.env 写入;默认从 env 读,Node 无 app 层仍可用);消费点(committee/webSearch/mcp/billionsTools)改读 config;env 兜底读取收敛统一守卫 |
| convention-enforcement | B 审计"隐形约定" | `test/architecture.test.ts` 静态断言:src 无 node:/react-native import、better-sqlite3 仅 type、无 declare global DOM 名、meta 键无裸字面量、process.env 直读仅限单点、app 无 lib/log 残留 |

## Out of Scope(不可做/明确不归一的,用户已确认目标但此项架构不可能)

- **图表 WebView 渲染器与 web 分支合并**:独立 JS 上下文,架构上不可能;保持镜像契约文档化(前轮已定)。
- **eslint 引入**:无现成 eslint 配置,引入是独立工程;用 vitest 静态断言测试达成同等强制(零新依赖)。
- iOS 工程 prebuild / ATS:无 macOS 构建环境 / 仅 http:// 端点场景,维持"跨平台前做"。

## 验收准则(父级)

- [ ] AC1 3 子任务完成,每项有验证证据。
- [ ] AC2 `npx vitest run` 全绿(含新增:store-node round-trip、switches 默认等价、architecture 断言、settingsStore node 分支)。
- [ ] AC3 app tsc 0 错;根 tsc 仅 3 个既有基线错误。
- [ ] AC4 Node 桌面路径实证:`tools/desktop-probe.mts`(或 vitest node 环境)跑通 createNodeFileStore + setStore + settingsStore node 读改写。
- [ ] AC5 配置面:process.env **零写入**(全仓 grep 无 `process.env[x] =`);开关判定与 env 默认等价(单测断言)。
- [ ] AC6 约定强制:architecture.test.ts 全绿,断言覆盖 R5 清单。
- [ ] AC7 回归:web 冒烟(demo/恢复/拦截)+ 模拟器重启恢复冒烟;真实分析视用户选择(见 implement.md)。

## 依赖与并行

- 3 子任务并行;文件重叠:runner.ts(desktop: store 注入点;config: 无)、settingsStore(desktop only)。归属表见 design.md。
- config-injection 是唯一 M-L 风险项(改委员会装配面),design 已定契约,验证含默认等价断言。
