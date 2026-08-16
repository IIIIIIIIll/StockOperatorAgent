# 模块化与跨平台就绪度审计

## Goal

对全仓库(TS 侧:`src/` 业务层 + `app/` UI 层 + `tools/` + 构建配置)做一次以**未来跨平台**为验收标准的模块化/复用性审计。当前平台:web(Expo web)、Android(RN)、Node(server/tools)。未来可能:iOS、桌面(Tauri/Electron)、更多 UI 入口。审计产出:证据化问题清单(带 file:line 锚点)、平台耦合矩阵、重复实现清单、修复优先级排序。**纯审计,不改产品代码**。

用户价值:在跨平台成本翻倍前暴露耦合泄漏与重复实现,明确"哪些抽象值得现在建、哪些是过度设计"。

## Confirmed Facts(代码证据,本会话已见)

- `app/hooks/useAnalysis.ts` `start()` 内 `Platform.OS === 'web'` 分支:`collectForWeb`(server 代理)vs `collectForDevice`(TDX TCP 直连)—— 两套采集入口,调用方 switch。
- `app/lib/runner.ts`:`const store = isWeb ? new IdbStore() : new FileStore()`(`typeof location` 探针)—— 平台二元选择。
- `src/store.ts` 顶层 `import Database from 'better-sqlite3'`(Node 原生模块)—— 需验证 web/RN bundle 是否经传递 import 拉入。
- 图表三套:`app/components/IndicatorChart.tsx`(RN lightweight-charts)+ `app/lib/chartHtml.ts`(web 内联 HTML)+ `tools/build-chart-view.mts`(独立调试工具),共享 `src/chartData.ts`。
- 报告渲染疑似重叠:`app/components/ReportContent.tsx` 与 `app/screens/ReportScreen.tsx` 并存(用途未核)。
- Hermes 兼容层:`app/lib/polyfill.ts` + `*-shim.*`(Buffer/timer/crypto/zlib/punycode/net/async-hooks),metro resolveRequest 重定向。
- 日志:统一 `src/log.ts`(web/RN/Node 探针),`app/lib/log.ts` 疑为历史残留(注释称"上移自 app/lib/log.ts")。
- 设置持久化:web=localStorage(`app/lib/settingsStore.ts` / runner `CFG_KEY`),RN=expo-file-system 文件。
- 事件协议 `src/events.ts` 是 App↔业务唯一契约。

## Requirements

- R1 审计四切片:平台耦合、业务层纯净度、重复实现、跨平台就绪度。
- R2 每个发现必须带证据:file:line 锚点 + 具体代码/import 链 + 跨平台影响说明。
- R3 产出平台耦合矩阵(平台 × 模块:web/Android/Node/未来 iOS/桌面 可达性)。
- R4 产出重复实现清单(严重度分级 + 合并建议)。
- R5 产出修复优先级排序(现在做 vs 跨平台前做 vs 不做),每个带理由与工作量粗估。
- R6 审计结论必须区分:真问题(会挡跨平台)/ 卫生问题(死代码残留)/ 非问题(当前设计合理)。

## Acceptance Criteria

- [ ] AC1 四个切片各产出结构化发现清单(severity/location/evidence/cross_platform_impact/recommendation),落盘 `research/<slice>.md`。
- [ ] AC2 平台耦合矩阵覆盖全部平台相关代码点(探针/Platform.OS/原生依赖/shims/采集入口/store 选择/日志/设置)。
- [ ] AC3 业务层纯净度切片给出 `src/` 平台杂质 import 链(含 better-sqlite3 是否入 web/RN bundle 的实证结论)。
- [ ] AC4 重复实现清单覆盖图表/报告/常量/日志/存储键等已知嫌疑点。
- [ ] AC5 主会话综合报告:问题清单 + 优先级排序 + 明确的"现在做/跨平台前做/不做"三档结论。
- [ ] AC6 审计过程零产品代码改动(git 干净,除任务目录)。

## Out of Scope

- 不改代码(审计结果可能催生后续重构任务,另立)。
- 不评估测试覆盖率本身(仅关注模块化/复用)。
- 不评估 Python 历史代码(`data_source/` 冻结 vendor、`.streamlit` 残留仅列入卫生清单)。

## Open Questions

无(审计方法由证据驱动,结论待 scout 实证)。
