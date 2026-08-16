# 切片 D:跨平台就绪度审计(采集/store/设置/LLM/事件协议)

审计基准:.trellis/spec/ts/index.md(事件协议、Hermes 兼容面、持久化四族、代理契约)。方法:纯静态只读,file:line 锚点 + 引用方 grep 实证;未实证标 [INFERENCE]。

## Q1 采集入口

1. [minor] 双采集实现契约已同形(输入/输出同构),但 useAnalysis.start 以 `Platform.OS === 'web'` 二元 switch + 两段 ~15 行近乎重复的 try/catch 分支 — @ app/hooks/useAnalysis.ts:234-247(web 分支,collectForWeb 调用在 :238)、:250-266(device 分支,collectForDevice 在 :255)— evidence: `collectForWeb(ticker, opts?: CollectForWebOpts): Promise<WebCollectResult>` @ app/lib/runner.ts:72,CollectForWebOpts{skipDaily?,skipF10?} @ runner.ts:67-70 与 CollectSkipOpts @ src/webCollect.ts:23-25 结构完全同形;`collectForDevice(ticker, opts?: CollectSkipOpts): Promise<WebCollectResult>` @ src/tdx/deviceCollect.ts:53-56;两实现返回同一 WebCollectResult(f10Text/snapshot/name/capital @ webCollect.ts:28-34)| impact: 当前唯一调用方(useAnalysis);加第三实现(桌面直连)时分支再增一档 | recommendation: 抽 `MarketCollector { collect(ticker, opts?): Promise<WebCollectResult> }` 接口(S:useAnalysis 两段合并为一段,删 ~15 行;实现侧零改动——两函数签名已满足)。

2. [minor] freshness 门计算与「同季跳过 F10 用缓存顶替」逻辑在两实现中逐行重复 — @ app/lib/runner.ts:73-85 vs src/tdx/deviceCollect.ts:60-73,78-82 — evidence: 两处同为 `asiaToday() → getStock/getPerformanceReports → freshnessGates → skipDaily/skipF10 → skipped[] 日志 → f10:ticker meta 顶替` 同序同语义 | impact: 双实现漂移风险(改门逻辑需改两处) | recommendation: 抽共享 `resolveSkipGates(ticker, store)` helper + f10 顶替收进共享函数(S)。

3. [non-issue] iOS 采集 = collectForDevice 现成可用,零改造 — evidence: react-native-tcp-socket podspec `s.platforms = { :ios => "9.0", :tvos => "10.0", :osx => "10.14" }` @ app/node_modules/react-native-tcp-socket/react-native-tcp-socket.podspec:9;README 首行 "React Native TCP socket API for Android, iOS & macOS";Metro resolveRequest 将 node:net → lib/net-shim.ts 对所有 RN 平台生效(无平台判断)@ app/metro.config.js:57-60;useAnalysis 非 web 分支即 collectForDevice @ useAnalysis.ts:250-266;keepalive 在 iOS 自动 no-op(Platform.OS==='android' 门控 @ app/modules/soa-keepalive/index.ts:12-17)| impact: iOS 走真机 TDX 直连,无需 web 代理/服务器 | 结论:非问题。

4. [minor-INFERENCE] iOS 直连 LLM 的 ATS 约束:LLM_BASE_URL 为 http:// 明文时 iOS 默认被 App Transport Security 拦截 — evidence: 三键校验仅要求 http(s) 前缀 @ src/llm.ts:33-35;直连路径 proxyBase=undefined @ useAnalysis.ts:216-219 → ChatOpenAI 直连 baseUrl(RN fetch 走 NSURLSession,受 ATS 管;TDX raw TCP 不经 ATS 不受影响)| impact: 仅影响配置 http:// LLM 端点的 iOS 用户(web/Android 可走) | recommendation: iOS 计划落地时文档化 https 要求或按需 Info.plist NSAppTransportSecurity 例外;现在不做。

5. 桌面路径二分(无现成单一路径):RN macOS/Windows 壳可复用 device 直连 + FileStore + 设置文件分支 + WebView 图表(原生分支已存在 @ app/components/IndicatorChart.tsx:229-321);Electron/Tauri 壳走 web 代理路径(Platform.OS='web' → collectForWeb,需伴随 server 进程)或主进程直连 node-tdx-market(Node 原生 net 无需 shim)+ SQLite Store——tools/probe.mts 已示范整链 @ tools/probe.mts:20-25(TdxClient + new Store('probe-output/soa.sqlite'))。Windows 支持未见于 podspec/README [INFERENCE: 存疑]。

## Q2 store 选择

6. [non-issue] 现有三元对 iOS 与 RN 桌面成立,扩展点在模块级单例: `const isWeb = typeof location !== 'undefined'; export const store = isWeb ? new IdbStore() : new FileStore();` @ app/lib/runner.ts:39-40 — evidence: FileStore 经 expo-file-system(标准 Expo 模块,iOS/Android/macOS 支持[INFERENCE],生产适配器 getExpoBackend @ src/store-file.ts:42-54);runner 显式转发 ready() @ runner.ts:43-45;消费方(DataScreen/useAnalysis)全部 import 单例 store,换工厂不触碰调用方 | impact: iOS 零改动;RN macOS 桌面零改动 | 结论:非问题;store 工厂仅在出现纯 Node 桌面/第三后端时引入(S)。

7. [major-仅桌面] 纯 Node 桌面(无 Expo 运行时)当前必崩:FileStore 的 expo-file-system 动态 import 失败 → backend() 抛错 → ready()/hydrate 未 catch → useAnalysis 启动链 setError「存储就绪失败」— evidence: getExpoBackend 的 await import 无兜底 @ src/store-file.ts:42-54;ready() = this.hydrate() 不 catch @ store-file.ts:85-87;useAnalysis 启动链 catch storeReady 错误 → setError + return @ app/hooks/useAnalysis.ts:86-93;FileStore 构造已预留 (baseDir, fs) 注入点 @ store-file.ts:73-76(测试注入 node fs 适配器先例)| impact: 桌面 Node × 启动即错(store 全不可用) | recommendation: 桌面计划确认时加 store 工厂:Node 分支注入 node:fs 适配器(FileStore 现成注入面,S)或直接 new Store(sqlite) @ src/store.ts:28-30(probe 已用);时机=跨平台前做。

8. [non-issue] better-sqlite3 不泄漏进 web/RN bundle — evidence: src/store.ts 顶层 `import Database from 'better-sqlite3'` @ src/store.ts:8 的唯一**值导入**是 tools/probe.mts:6(探针,不进 App);src/ 与 app/ 其余消费全部 `import type { StoreLike } from './store.ts'`(编译期擦除):app/lib/runner.ts:6、src/events.ts:7、src/pipeline.ts:5、src/webCollect.ts:4、src/store-file.ts:9、src/store-idb.ts:7、src/store-memory.ts:3 | impact: prd.md 疑虑不成立,web/RN 打包安全 | 结论:非问题。

## Q3 设置持久化

9. [nit-卫生] runner.ts 的 CFG_KEY 三函数(readSavedConfig/saveConfig/clearConfig)是零调用死代码,与 settingsStore 不构成两套活路径 — evidence: 全仓 grep 仅命中定义处(app/lib/runner.ts:98-123,CFG_KEY='soa:llm-config')与 archive 文档;现行唯一路径 = settings.ts loadSettings/saveSettings @ app/lib/settings.ts:57-67 → settingsStore(soa:settings @ settingsStore.ts:20);08-13 审计已点名同问题(archive/08-13-full-codebase-review/research/ts-app-server.md:76-78) | impact: 仅维护误导风险 | recommendation: 删除 CFG_KEY + 三函数(现在,S)。

10. [non-issue] 设置持久化已是单点抽象:createSettingsStore 工厂(isWebEnv/isRnEnv 探针分发 + _localStorage/_fs 注入)@ app/lib/settingsStore.ts:51-75;RN 分支 expo-file-system File 同步 API @ settingsStore.ts:36-49;iOS 走 RN 文件分支现成可用(expo-file-system iOS 支持[INFERENCE])| 结论:非问题。

11. [minor-桌面] 纯 Node 下 settingsStore 静默降级:load 恒 null / save no-op(设置丢失且无报错)— evidence: createSettingsStore 中 web undefined(无 window/document)+ rnFs null(非 RN)→ load 走 loadFromFile(_fs ?? rnFs=null) → 触发惰性 import 后 return null @ settingsStore.ts:66-73;save 同路径 return @ settingsStore.ts:74-84 | impact: 桌面 Node × 设置不持久化(静默) | recommendation: 桌面计划时补 Node fs 后端复用工厂注入面(S);时机=跨平台前做。

12. [minor] LLM 密钥注入平台差异已收敛单点:web/RN 面板键持久化 + EXPO_PUBLIC_LLM_* env 兜底 @ app/lib/settings.ts:82-84(直接成员访问——babel 静态内联/Hermes 兼容面约束,spec 同款);消费点唯一: settings.keys → toLlmConfig @ settings.ts:115-117 → buildLlm(cfg, proxyBase) @ runner.ts:154-156 → createLlm @ src/llm.ts:47-59 | impact: iOS/桌面无需新接线(面板键 + env 兜底双通道现成)| 非问题(设计统一)。

## Q4 LLM 平台分支

13. [non-issue] proxyBase 单点且语义正确: `Platform.OS === 'web' ? \`${globalThis.location.origin}/llm-proxy\` : undefined` @ app/hooks/useAnalysis.ts:216-219;createLlm 经 baseURL=proxyBase + X-LLM-Base 头透传真实端点 @ src/llm.ts:47-59;webSearch 同款探针姿势 @ src/webSearch.ts:78-81 | impact: iOS/桌面 RN 直连(undefined 即直连,无 CORS 无代理);Electron web 走代理 | 结论:非问题。

14. [nit] checkLlmReachability 在 RN 上先打一发必失败的相对 URL 请求再回退直连 — evidence: `fetch('/llm-proxy/chat/completions')` @ app/lib/settings.ts:171(相对 URL 在 RN 无 origin → 抛错)→ catch 回退直连 @ settings.ts:184-190(行为正确,白花一次请求)| recommendation: 非 web 平台跳过代理尝试(nit,现在可做)。

## Q5 事件协议与第二入口复用

15. [non-issue] useAnalysis 已完全独立:无 props、零 App 组件依赖、订阅 effect 空依赖数组 @ app/hooks/useAnalysis.ts:46-146;新 UI 入口(如独立「上次结果」页)接入成本 = `const a = useAnalysis()` + 渲染 a.events/statuses/partials/lastRunAt + `a.start(ticker)`;双实例安全:storeReady 幂等(IdbStore readyPromise 单例 @ src/store-idb.ts:138-141,FileStore 同 @ src/store-file.ts:85-87)、loadDemoData 空库守卫 @ runner.ts:49-56、两实例订阅同一 runner 事件流一致;纯读页甚至可绕过 hook 直接 loadLastRun(store) @ src/lastRun.ts:8(纯函数,meta 键 soa:last-run)| 结论:非问题,第二入口成本 S。

16. [non-issue] 事件协议与运行契约面稳定可复用: PipelineEvent 六型联合 @ src/events.ts:13-19;RunOptions = Omit<PipelineDeps,'store'|'progress'> + llm/config/tools/billionsClient 注入 @ events.ts:44-57;run(ticker, opts) 注入面覆盖采集结果(f10Text/snapshot/name/capital)/情报(billions/mcp)/工具/LLM @ events.ts:90-120;PipelineDeps @ src/pipeline.ts:165-176 | impact: 新入口直接复用 runner.run,协议零改动 | 结论:非问题。

## 产出:新平台接线点清单

| # | 平台 | 位置 | 需要什么 | 工作量 | 时机 |
|---|---|---|---|---|---|
| A | iOS | app/ios/(不存在,需 prebuild) | `npx expo prebuild --platform ios` + pod install;react-native-tcp-socket 经 Autolinking 自动链接;ios.bundleIdentifier 已备 @ app.json:10-12 | S | 有 iOS 计划时 |
| B | iOS | 采集/存储/设置/LLM/保活 | 零接线:collectForDevice(@ useAnalysis.ts:250-266)、FileStore(@ runner.ts:39-40)、settingsStore RN 分支(@ settingsStore.ts:36-49)、keepalive 自动 no-op(@ app/modules/soa-keepalive/index.ts:12-17)、WebView 图表(@ app/components/IndicatorChart.tsx:229-321)均现成 | 0 | — |
| C | iOS | LLM 端点 http:// 场景 | ATS 例外(Info.plist)或文档化 https 要求(发现 4) | 0~S | 上线前 |
| D | 桌面 RN macOS | 复用 device 直连 + FileStore + 设置文件分支 + WebView 图表;prebuild | S | 有桌面计划时 |
| E | 桌面 Electron/Tauri | store/settings Node 后端:fs 适配器注入 FileStore(@ store-file.ts:73-76)或 SQLite Store(@ src/store.ts:28-30);settingsStore Node 后端(发现 11);采集走 server 代理或主进程直连 node-tdx-market(probe.mts 先例) | M | 有桌面计划时 |

推荐抽象与时机判断:
- **采集接口 MarketCollector**:现在做(S)。理由:两实现已同形且 freshness 门在漂移(发现 1/2);改动用 <30 行;第三实现(macOS 桌面直连/Electron 主进程)落地时零额外改动。
- **store 工厂**:跨平台前做。iOS/RN 桌面已被三元覆盖;仅纯 Node 桌面需要(S,FileStore 注入面现成)。
- **设置 Node 后端**:跨平台前做(S,settingsStore 工厂注入面现成)。
- **删 CFG_KEY 死代码**:现在做(S,nit)。
- **不改动项**:proxyBase 单点、密钥注入、事件协议、better-sqlite3 隔离——全部维持现状。

## 结论(三分类)

- **真问题(挡跨平台)**:0 个 critical;2 个 conditional major——纯 Node 桌面 store 启动必错(7)与设置静默丢失(11),均仅在「桌面=纯 Node 进程」方案下成立;RN 桌面与 iOS 不受影响。iOS ATS http 约束(4)为潜在 minor(仅 http:// LLM 端点场景)。
- **卫生问题(死代码/残留/重复)**:CFG_KEY 三函数死代码(9);采集分支与 freshness 门双实现重复(1/2);checkLlmReachability 代理预请求(14)。
- **非问题(当前设计合理)**:iOS 采集直连可用(3);store 三元对 iOS/RN 桌面成立(6);better-sqlite3 不泄漏(8);设置单点抽象(10);密钥注入统一(12);proxyBase 单点(13);useAnalysis 独立可复用(15);协议稳定(16)。
- **总判断**:仓库对新平台(iOS/RN macOS 桌面)就绪度高,主要缺口集中在纯 Node 桌面方案的 store/设置后端;建议以小步卫生改进为主(采集接口、删死代码),store 工厂/设置后端大改动留到真实平台计划确认后。
