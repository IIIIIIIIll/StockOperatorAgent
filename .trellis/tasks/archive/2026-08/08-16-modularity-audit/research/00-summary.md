# 审计综合报告(00-summary)

> 4 个并行 scout 切片(2026-08-16):01-platform-coupling / 02-business-purity / 03-duplication / 04-cross-platform-readiness。本文件为交叉核对后的综合结论。交叉核对原则:同一问题多切片命中 → 取最高严重度 + 合并证据;冲突结论回查源码裁决。

## 总体判断

**模块化真实水平:良好,且经得起放大镜。** 四个独立视角交叉验证后,结构性设计(store 四实现 + StoreLike 接口、事件协议、动态 import 平台边界、同源代理单份实现、type-only 隔离、Hermes shim 体系)全部成立,无一处被推翻。0 个 critical 级问题。

但审计发现了 **1 个高风险结构缺陷(web bundle 死链)** 和 **一批跨平台前必须处理的接线点** —— 它们不是"现在就会炸",而是"换平台/升级依赖时必炸"。以下是完整清单。

## 一、真问题(挡跨平台 / 高风险)

| # | 问题 | 证据 | 严重度 | 处置时机 |
|---|---|---|---|---|
| P1 | **node-tdx-market 整链静态进 web bundle**(useAnalysis:36 → deviceCollect → node-tdx-market → net/zlib shim → react-native-tcp-socket),web 从不执行,靠 4 重隐式机制兜底(polyfill 时序/shims/react-native-web 容错/运行时门控)——任一断裂即 web 加载崩;对比 better-sqlite3 的 type-only 隔离,此链无同类保护 | B-1.1(major)、A-§6-5(minor)、A-§4 依赖表 | **major** | **现在做**:deviceCollect 改非 web 分支动态 import(对齐 lightweight-charts/expo-file-system 既有边界先例) |
| P2 | **桌面复用 web bundle 时同源代理是断点**:采集/LLM/搜索/日志全走 `/tdx-collect` `/llm-proxy` `/web-search` `/logs`,纯静态 webview 无这些端点 → start() 必断 | A-§6-3(major)、D-发现 5/13 | major | 桌面方案确定前(方案=随包带可嵌入 Node 代理或改直连) |
| P3 | **纯 Node 桌面 store/设置双缺口**:FileStore 的 expo-file-system 动态 import 无兜底 → ready() reject → 启动即错;settingsStore 纯 Node 静默降级(load null/save no-op) | D-发现 7/11(均 conditional major) | major(仅该方案) | 跨平台前:store 工厂 + Node fs 适配器(FileStore 注入面现成,S) |
| P4 | **iOS 工程前置 + 安全区缺陷**:无 ios/ 工程(需 prebuild+dev build);`RNStatusBar.currentHeight` 是 android-only → iOS 标题栏顶进灵动岛 | A-§6-1/2(major) | major(工程)/major(UI) | iOS 计划落地时;安全区改用 safe-area-context |
| P5 | **RN 真机 env 键位缺口**:TAVILY_API_KEY / TDX_HOST 非 EXPO_PUBLIC_* → 真机恒 undefined → Tavily 优先失效(恒 DDG)、TDX 服务器兜底失效 | A-§6-6(minor)、B-1.3 | minor(现网 Android 已存在) | 需要真机 Tavily/TDX 时 |
| P6 | **平台探针三套并存**(typeof location / window+document / window.location.origin),web 判定不等价 | A-§6-4(minor) | minor | 现在做:收敛到 detectPlatform 单面 |

## 二、重复实现(合并建议)

| # | 位置 | 内容 | 建议 | 时机 |
|---|---|---|---|---|
| D1 | useAnalysis:235-266 vs runner:73-85 vs deviceCollect:60-82 | 采集双分支 + freshness 门逐行重复 | 抽 `MarketCollector` 接口 + `resolveSkipGates` 共享 helper(S,<30 行,两实现已同形) | **现在做** |
| D2 | IndicatorChart:217-224 / FinancialTrendChart:67-74 / build-chart-view 内嵌 JS | pane 顶比例公式 3 份 | web 两组件抽公共纯函数;HTML 侧保持镜像注释 | 跨平台前(维护性) |
| D3 | settings.ts:48 / billionsTools.ts:14-18 / :172 | caps 默认值 {3,2,3} 三份两命名 | 单一常量源导出 | 跨平台前 |
| D4 | chartHtml.ts ↔ chart-view.html ↔ build-chart-view.mts | 同一 HTML 三形态,无一致性校验 | npm script + 生成校验 | 跨平台前 |
| D5 | theme.ts 亮色板 ↔ 模板 fallback 4 处 | 兜底色二次出现 | 注释标注对齐 | 顺手 |

## 三、死代码 / 卫生(现在可清,零风险)

| # | 位置 | 内容 | 实证 |
|---|---|---|---|
| H1 | app/screens/ReportScreen.tsx(≈130 行) | st.tabs 早期重复实现 | 全仓零 import;App 用 ReportContent |
| H2 | app/lib/runner.ts:98-125 | CFG_KEY + readSavedConfig/saveConfig/clearConfig | 零调用;08-13 审计已点名 |
| H3 | app/assets/chart-view.html(~200KB) | 运行时零引用产物 | 全部命中为注释 |
| H4 | app/lib/log.ts | re-export shim,注释过期 | 仅 2 个活引用方,直连 src/log.ts 后删 |
| H5 | src/ 8 处 process.env 直读 | Node-only 配置面随 web/RN bundle 静默失效 | B-1.3;含 08-14 R9 死配置先例 |

## 四、非问题(审计确认设计正确,维持)

- **better-sqlite3 隔离**:type-only import 约定实证成立,web/RN bundle 不含(23 个引用方全量核对)——但属"隐形约定",建议加 eslint `import/no-restricted-imports` 防回归
- **Hermes shim 体系**:metro resolveRequest 无条件重定向 + polyfill 首 import,Android/iOS 自动生效
- **expo-file-system 三处动态 import**:边界一致,降级安全
- **图表三套**:实为 1 渲染组件 + 1 生成常量 + 1 模板工具,数据契约单点(chartData/indicators);web 与 WebView 渲染器镜像属 WebView 架构必然
- **事件协议 / useAnalysis / 第二入口复用**:零改动复用,接入成本 S
- **soa-keepalive 跨平台降级**:平台清单 + 守卫正确
- **代理双入口共享单份实现**(proxies.cjs/logs-server.cjs):正确

## 五、平台耦合矩阵(成品)

见 research/01-platform-coupling.md §5(web/Android/Node/iOS*/桌面* × 13 类模块/机制)。要点:store/图表/日志/设置四类对 iOS 零改动;采集/LLM/搜索需验证原生面;桌面 web-like 继承同源代理依赖。

## 六、优先级执行建议

**现在做(本轮价值最高,S 级工作量,风险低):**
1. P1:deviceCollect 动态 import 化(web bundle 去死链)
2. D1:MarketCollector 接口 + freshness 门共享
3. H1+H2+H3+H4:死代码清理(ReportScreen/CFG_KEY/chart-view.html/log shim)
4. P6:平台探针收敛

**跨平台前做(有真实平台计划再动):**
5. P2/P3:桌面方案(嵌入式 Node 代理 / store 工厂 + Node 后端)
6. P4:iOS prebuild + 安全区
7. D3/D4:caps 单源、图表生成校验
8. P5:真机 Tavily/TDX_HOST(需要时)

**不做 / 长期:**
9. applySwitchesToEnv 改显式注入(中等工作量,当前 Android 实证可用,收益不紧迫)
10. iOS ATS 例外(仅 http:// LLM 端点场景)
11. WebView 渲染器与 web 分支合并(架构上不可能)

## 附:审计范围与方法

- 切片:01 平台耦合 / 02 业务纯净度 / 03 重复实现 / 04 跨平台就绪;全部 read-only scout,静态审计,零产品代码改动
- 证据规范:每发现带 file:line + 引用方 grep 实证;未实证标 [INFERENCE]
- 基线:.trellis/spec/ts/index.md
- 本任务产物:research/01-04 + 本文件;后续若执行"现在做"清单,另立任务
