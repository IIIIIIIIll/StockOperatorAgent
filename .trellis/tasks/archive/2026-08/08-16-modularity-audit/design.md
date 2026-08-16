# 设计:审计方法论

## 切片划分与执行方式

4 个并行 read-only scout(agent=scout),每个写 `research/<slice>.md`(结构化发现清单)+ 返回压缩结论。主会话综合。

| Slice | 文件 | 核心问题 |
|---|---|---|
| A 平台耦合 | `research/01-platform-coupling.md` | 平台相关代码点全量盘点 + 耦合矩阵 |
| B 业务纯净度 | `research/02-business-purity.md` | `src/` 平台杂质 import 链实证 |
| C 重复实现 | `research/03-duplication.md` | 图表/报告/常量/存储键重复 |
| D 跨平台就绪 | `research/04-cross-platform-readiness.md` | 新平台接线点清单 + 抽象建议 |

## 每个切片的审计问题

### A 平台耦合(scout)
1. 枚举全部 `Platform.OS` 用法(app/ + src/),标注所在文件与分支内容。
2. 枚举全部运行时探针:`typeof location` / `typeof window` / `typeof navigator` / `typeof process` / `isWebEnv`/`isRnEnv`/`isNodeEnv`(src/log.ts 等),列"探针 → 选型"映射。
3. `app/lib/*-shim.*` + `polyfill.ts` 逐个说明修补什么 Hermes 缺口;metro.config.js resolveRequest 如何重定向。
4. 原生模块依赖盘点:react-native-tcp-socket、expo-file-system、lightweight-charts(动态 import)、react-native-webview、better-sqlite3 —— 各自在哪些平台 bundle 可达。
5. **产出**:平台 × 模块耦合矩阵(行=模块,列=web/Android/Node/iOS*/桌面*);"新平台会在这里断"清单。

### B 业务纯净度(scout)
1. 遍历 `src/**/*.ts`,标注平台杂质:`node:` 内置 import、better-sqlite3、react-native import、DOM 全局(window/document/localStorage/indexedDB/TextDecoder)、`process.env` 直读。
2. **实证 import 闭包**:从 `app/lib/runner.ts` 与 `app/App.tsx` 出发,追踪传递 import,判定 `src/store.ts`(better-sqlite3)是否进入 web/RN bundle(webpack/metro 会因 `node:` 或 native 而失败或 polyfill);同时从 `tools/*.mts` 出发确认 Node 侧。
3. 检查 `src/store.ts` 顶层 better-sqlite3 import 是否有动态/惰性保护(对比 store-file/idb 的惰性模式)。
4. tsconfig 双配置(根 node-only ES2024 vs app DOM lib):哪些文件被两侧同时编译,是否依赖环境全局声明(declare global 冲突风险)。
5. **产出**:src 平台杂质表(文件/import/影响平台/风险等级)+ 关键结论:web/RN bundle 是否已含 native 依赖。

### C 重复实现(scout)
1. 图表:比对 `chartHtml.ts` / `IndicatorChart.tsx` / `tools/build-chart-view.mts` 的数据准备与指标计算(是否都走 `chartData.ts`/`indicators.ts`),渲染面重叠度,哪个是活路径。
2. 报告:`components/ReportContent.tsx` vs `screens/ReportScreen.tsx` 的职责/引用方(谁 import 谁,App 用哪个),是否可合并。
3. 常量/配置漂移:meta 键(`soa:*`/`demo:*`/`f10:*`/`capital:*`)、localStorage 键、存储路径(`soa-store`/`soa-settings.json`/`soa-logs.log`)、env 名(EXPO_PUBLIC_* vs 普通)、端点路径(`/llm-proxy`/`/tdx-collect`/`/web-search`/`/logs`)—— 是否单点定义。
4. 日志:`app/lib/log.ts` 是否仅 re-export `src/log.ts` 或死文件;`src/log.ts` 与旧文件的历史关系。
5. 主题/颜色:theme.ts 与图表系列色是否同源(已知 chart 有单点定义,验证图表以外)。
6. **产出**:重复表(位置/重复内容/影响/合并建议)+ 死代码清单。

### D 跨平台就绪(scout)
1. 采集:useAnalysis 的 web/device 分支 → 是否值得抽 `collector` 接口(collectForWeb vs collectForDevice 签名差异);iOS 用哪条路径(react-native-tcp-socket 支持 iOS?);桌面走 web 代理还是直连?
2. store 选择:`runner.ts` 三元 → store 工厂的必要性;FileStore 在 iOS 的可达性(expo-file-system)。
3. 设置持久化:settingsStore 平台分支(web localStorage vs RN 文件)是否单点抽象;runner `CFG_KEY` 与 settingsStore 是否两套并存。
4. LLM:llm.ts `createLlm` 的 proxyBase 平台分支;密钥注入(web localStorage vs RN env)差异。
5. 事件协议 `src/events.ts`:是否已是稳定契约;UI 层(hook)对事件的消费是否可被第二入口复用(useAnalysis 已抽,验证其独立性)。
6. **产出**:新平台(iOS/桌面)接线点清单(每个:位置/需要什么/工作量粗估 S/M/L)+ 推荐的抽象(采集接口/store 工厂/设置后端)及"现在做 vs 跨平台前做"判断。

## 证据规范(所有切片)

- 每个发现:`severity(critical|major|minor|nit)` + `location(file:line)` + `evidence(具体代码/import 链/引用方)` + `cross_platform_impact(平台×影响)` + `recommendation`。
- 禁止臆断:未实证的结论标 `[INFERENCE]`;引用方用 grep/lsp 实证。
- 结论必须三分类:真问题 / 卫生问题 / 非问题(当前设计合理)。

## 综合与输出

主会话汇总 4 份 research + 形成最终报告(可放 `research/00-summary.md`):
- 问题清单(按严重度)
- 优先级三档:现在做 / 跨平台前做 / 不做(每项理由)
- 平台耦合矩阵成品
- 若存在明确高价值重构 → 建议后续任务(另立 task,不在本任务改码)
