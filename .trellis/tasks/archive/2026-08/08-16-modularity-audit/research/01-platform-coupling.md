# 切片 A:平台耦合审计(research/01-platform-coupling.md)

> 纯静态只读审计。锚点全部实证(app/src/tools + metro.config.js + node_modules 类型声明)。未实证结论标 [INFERENCE]。

## 1. `Platform.OS` 用法全量枚举(app/ + src/ + tools/)

src/ 与 tools/ 为零 `Platform.OS`(纯 Node/业务 lib,无 RN 依赖;仅 src/log.ts:12 有字符串联合类型 `Platform = 'web'|'rn'|'node'`)。全部用法集中在 app/ 4 个文件:

| 文件:行 | 分支内容 |
|---|---|
| app/hooks/useAnalysis.ts:223-225 | `Platform.OS === 'web' ? `${globalThis.location.origin}/llm-proxy` : undefined` —— LLM 同源代理 base(web 绕 CORS);真机 undefined 直连 |
| app/hooks/useAnalysis.ts:235-247 | web → `collectForWeb`(server /tdx-collect 代理采集);else(249-264)→ `collectForDevice`(TDX TCP 直连)—— 两套采集入口,调用方 switch |
| app/components/IndicatorChart.tsx:126 | effect 守卫:`Platform.OS !== 'web'` 直接 return(web 直渲 lightweight-charts DOM canvas) |
| app/components/IndicatorChart.tsx:233 | `nativeData` memo:web → null |
| app/components/IndicatorChart.tsx:302 | `nativeJson`:web → '' |
| app/components/IndicatorChart.tsx:310 | 非 web 且 WebView loaded → `injectJavaScript` 注入数据 |
| app/components/IndicatorChart.tsx:313-317 | 非 web → `<WebView source={{html: CHART_HTML}}>` 渲染 chart-view.html |
| app/components/FinancialTrendChart.tsx:37 | 同 126(web 直渲财务 3 pane) |
| app/components/FinancialTrendChart.tsx:81 | 同 233 |
| app/components/FinancialTrendChart.tsx:95 | 同 302 |
| app/components/FinancialTrendChart.tsx:103 | 同 310 |
| app/components/FinancialTrendChart.tsx:108-112 | 同 313(WebView 分支) |
| app/modules/soa-keepalive/index.ts:16-22 | `Platform.OS === 'android'` → `requireNativeModule('SoaKeepAlive')`;其余平台 native=null(静默降级) |
| app/modules/soa-keepalive/index.ts:24 | `__DEV__ && Platform.OS === 'android'` 调试日志 |

## 2. 运行时探针 → 选型映射表

| 探针 | 位置 | 判定 → 选型 |
|---|---|---|
| `typeof location !== 'undefined'` | app/lib/runner.ts:30 | web? `new IdbStore()` : `new FileStore()` —— **store 工厂唯一选择点** |
| `typeof location !== 'undefined' ? location.origin : ''` | app/lib/runner.ts:87 | collectForWeb 同源 /tdx-collect 代理 base(空 → 相对 URL) |
| `typeof window !== 'undefined'` | app/App.tsx:54 | 挂 `window.__soa` 调试钩子 |
| `typeof window !== 'undefined' && window.location?.origin` | src/webSearch.ts:79-80 | 浏览器 → `makeProxySearcher`(同源 /web-search);否则(82-83)env TAVILY_API_KEY → Tavily;否则 DDG |
| `isWebEnv()` = `typeof window !== 'undefined' && typeof document !== 'undefined'` | src/log.ts:24-26 | web 日志 transport:console + POST 同源 /logs |
| `isRnEnv()` = `typeof navigator !== 'undefined' && navigator.product === 'ReactNative'` | src/log.ts:28-30 | RN:console + expo-file-system 沙盒文件(5MB 轮转)+ EXPO_PUBLIC_LOG_ENDPOINT 上报 |
| `isNodeEnv()` = `typeof process !== 'undefined' && !!process.versions?.node` | src/log.ts:32-34 | node:仅 console(server 端点原生 fs 落盘;vitest 不写文件) |
| `detectPlatform()` 优先级 web→rn→node | src/log.ts:37-41 | log() 路由分发(src/log.ts:175-180) |
| `typeof process === 'undefined'` | src/log.ts:68-71 | envValue 守卫(web 无 process;RN 为 Metro polyfill) |
| `isRnEnv()` 模块级预载 / `isWebEnv()` 工厂分发 | app/lib/settingsStore.ts:65、85(探针定义 import 于 :10) | RN → 惰性 `import('expo-file-system')` 沙盒文件;web → localStorage |
| `globalThis.localStorage?.getItem/setItem`(optional-chain) | app/lib/runner.ts:102、114、122 | readSavedConfig/saveConfig/clearConfig —— 全平台安全(web 外 undefined 静默) |
| `globalThis.location.origin`(裸访问) | app/hooks/useAnalysis.ts:224 | 仅在 `Platform.OS === 'web'` 分支内 → web-only,安全 |

**不一致点**:web 判定三套探针并存 —— `typeof location`(runner)、`window && document`(log.ts/settingsStore)、`window.location?.origin` 非空(webSearch.ts:79)。当前 web/桌面 webview 下三者全成立故自洽,但新增平台(如 Worker/SSR)时需逐个核对,是维护成本(minor)。

## 3. shim / polyfill 清单(app/lib/ + metro 重定向)

### 3.1 polyfill.ts(app/lib/polyfill.ts,5.8KB;app/index.ts:3 **首个 import 全局生效**)
| 修补的 Hermes/RN 缺口 | 证据 |
|---|---|
| 全局 `Buffer`(Hermes 无)+ `Buffer#subarray` 重包恢复完整 API | polyfill.ts:8-24;node-tdx-market exhq-types.js **模块顶层** `Buffer.from`,必须先于依赖图求值(index.ts:1-2 注释) |
| `setTimeout/Interval` 句柄补 `unref/ref/hasRef`(Hermes 句柄为数字) | polyfill.ts:36-71;node-tdx-market startHeartbeat/scheduleReconnect 调 `timer.unref()` |
| `navigator.userAgent` 补 ''(Hermes 无 userAgent) | polyfill.ts:79-86;langchain isJsDom 判定崩 |
| `crypto.randomUUID/getRandomValues`(Math.random 熵,仅 id 用途) | polyfill.ts:105-132;langchain trace/请求 id |
| `AbortSignal.prototype.throwIfAborted` | polyfill.ts:88-100;LangGraph stream config |

### 3.2 Metro resolveRequest 重定向(app/metro.config.js:23-70)
| moduleName | 重定向 | 修补内容 |
|---|---|---|
| `node:net` | :46-48 → lib/net-shim.ts | node:net → react-native-tcp-socket 适配:参数归一 `connect(port,host,cb)` / `write(data,cb)`(tcp-socket 只收 options/encoding) |
| `node:events` | :49-52 → npm `events/events.js` | Hermes 无 node:events(node-tdx-market EventEmitter 基类) |
| `node:zlib` | :53-55 → lib/zlib-shim.cjs → lib/zlib-shim.ts | 纯 TS inflateSync(RFC1950+DEFLATE+Adler-32,251 行);frame.js 同步 `require('node:zlib')` 的 Metro ESM 互操作问题 |
| `node:async_hooks` | :56-58 → lib/async-hooks-shim.ts | 最小 AsyncLocalStorage(同步作用域,跨 async 退化 undefined);langchain core/dist/context.js 顶层 `new AsyncLocalStorage()` |
| `punycode` | :60-62 → lib/punycode-shim.ts | RFC3492 toASCII/toUnicode;markdown-it@10 normalizeLink IDNA |
| `@langchain/langgraph` | :63-68 → dist/web.js | 避免 dist/index.js→node.js 顶层 AsyncLocalStorage 的 node: 依赖 |
| langsmith 包内相对 import | :25-42 → .cjs 镜像 + .browser.* 孪生 | ESM 顶层循环 import TDZ 崩(browser 字段 Metro 不认,等价实现) |

### 3.3 其他平台相关 lib
- **proxies.cjs + proxies.d.cts / logs-server.cjs + logs-server.d.cts**:非 Hermes 修补,是同源代理/日志汇聚**单份实现双入口** —— metro dev 中间件(metro.config.js:78-92)与生产 server(app/server.mjs:10-11)。require `../../src/*.ts` 需 Node `--experimental-strip-types`。**只进 Node,不进任何客户端 bundle**。
- **src/expo-file-system.d.ts**:类型层环境模块声明(node-only lib 解析不到 expo-file-system;SDK 57 真类型优先,注释声明可删)。

### 3.4 生效范围与 iOS 判定(核心结论)
**metro resolveRequest 的 `platform` 参数只透传给 fallback(metro.config.js:69),所有重定向分支无条件生效 → 重定向是 RN 通用机制,非 Android 专属。** iOS 默认 Hermes 引擎,缺口与 Android 相同 → 全部 shim 在 iOS **需要且会自动生效**。唯一带原生面的是 net-shim 的宿主 react-native-tcp-socket(包含 ios/ 原生 + podspec,见 §4.1);zlib/punycode/async-hooks/events/langgraph/langsmith 重定向全为纯 JS,平台无关。polyfill.ts 经 index.ts:3 首 import,全平台生效(web 下多为无害 no-op)。

## 4. 原生/平台依赖可达性(import 引用方实证)

| 依赖 | 引用方 | web | Android | Node | iOS* | 桌面* |
|---|---|---|---|---|---|---|
| **react-native-tcp-socket 6.4.2** | net-shim.ts:8 ←(metro node:net 重定向)← node-tdx-market dist ← src/tdx/deviceCollect.ts:6(`import { TdxClient }`)← useAnalysis.ts:36 静态链 | 被打包但惰性(仅 `new Socket()` 触原生);包无 browser 字段(react-native-tcp-socket/package.json);生产 web 运行实证不崩 = 死代码 | ✓(已发布运行) | ✗(Node 用原生 node:net) | 包含 ios/ + podspec 可 autolink;需 dev build(Expo Go 无此模块);setKeepAlive 注释仅引 TcpSocketClient.java(Android),iOS 连接行为未实证 [INFERENCE] | 同 web(死代码) |
| **expo-file-system** | src/log.ts:161、src/store-file.ts:43、app/lib/settingsStore.ts:52 —— **三处均动态 import** + isRnEnv/平台门控 | 不触发(Metro 打 chunk,web 不求值) | ✓ | 不触发(动态 import 失败 catch 降级,vitest 实证) | ✓ 官方支持 | 不触发(web 分支) |
| **lightweight-charts 5.2** | IndicatorChart.tsx:8/41/132、FinancialTrendChart.tsx:9/41(`import type` 擦除 + `void import(...)` 动态,字面量 specifier → Metro 静态切 chunk);chartHtml.ts / assets/chart-view.html(构建期内联 UMD,见 tools/build-chart-view.mts:1-13) | ✓ 动态 import 直达(web 分支 effect 内执行) | ✗ 不进入运行时(Platform.OS 守卫 return;原生走 WebView 内联 UMD) | ✗(tools 仅生成产物) | 同 Android(WebView) | 同 web |
| **react-native-webview 13.16.1** | IndicatorChart.tsx:7、FinancialTrendChart.tsx:8(静态 import,仅非 web 渲染分支使用) | 打包不渲染(包带 web/iframe 兜底 [INFERENCE]) | ✓ | ✗ | ✓ 官方支持 | 同 web |
| **better-sqlite3** | src/store.ts:3 `import Database`;非 type import 仅 tools/probe.mts:6 与 test/(events/pipeline/store-gates,均 Node 环境);app/ 全链 12 处均为 `import type ... from './store.ts'`(runner.ts:31、events.ts:7、pipeline/overview/reports/chartData/lastRun/store-file/idb/memory) → **类型擦除,better-sqlite3 不进 web/RN bundle(AC3 实证)** | ✗ | ✗ | ✓ | ✗ | ✓(Node 形态) |
| **expo-status-bar** | App.tsx:8 | ✓ | ✓ | ✗ | ✓ | ✓ |

## 5. 平台 × 模块耦合矩阵

行=模块/机制;列=web / Android / Node / iOS* / 桌面*(*=未来;✓ 可达,✗ 不可达,△ 需适配)

| 模块/机制 | web | Android | Node | iOS* | 桌面* |
|---|---|---|---|---|---|
| store 选择(IdbStore/FileStore/SQLite) runner.ts:30 | ✓ Idb | ✓ File | ✓ better-sqlite3(tools/测试) | ✓ File | ✓ 同 web(Idb) |
| 采集入口(collectForWeb/Device) useAnalysis.ts:235 | ✓ 代理 | ✓ TCP 直连 | ✓ 代理(Node 侧) | △ TCP 直连(需验证 tcp-socket iOS 原生) | △ 需 Node 侧代理 |
| LLM 调用(直连/同源代理) useAnalysis.ts:223 | ✓ /llm-proxy | ✓ 直连 | ✓ 直连 | ✓ 直连 | △ 需 /llm-proxy 或直连(webview CORS) |
| web_search 工具 webSearch.ts:79 | ✓ 同源代理 | ✓ DDG/Tavily | ✓ Tavily/DDG | ✓ DDG(TAVILY key 不可达,见 §6-6) | △ 同 web |
| 图表(lightweight-charts / WebView) | ✓ 直渲 | ✓ WebView CHART_HTML | ✗(工具生成) | ✓ WebView | ✓ 同 web |
| 日志 log.ts | ✓ POST /logs | ✓ 沙盒文件 | ✓ console | ✓ 沙盒文件 | ✓ 同 web |
| 设置持久化 settingsStore.ts | ✓ localStorage | ✓ 文件 | ✗(仅测试注入) | ✓ 文件 | ✓ 同 web |
| 前台保活 soa-keepalive | ✗ no-op | ✓ 原生服务 | ✗ | ✗(native=null 降级,index.ts:16 守卫) | ✗ |
| Hermes shim 体系(§3) | 无害 no-op | ✓ | ✗(不经 Metro) | ✓ 自动生效 | 同 web |
| 同源代理服务 proxies.cjs/server.mjs | ✓ dev+prod | ✗(客户端不含) | ✓ server | ✗ | △ 必须随桌面打包 Node 代理 |
| env 键 EXPO_PUBLIC_LLM_* settings.ts:82-84 | ✓ | ✓(app/.env) | ✓(process.env) | ✓ | ✓ |
| env 键 TAVILY_API_KEY / TDX_HOST | ✓(Node 侧 server) | ✗(非 EXPO_PUBLIC) | ✓ | ✗ | ✓(Node 侧) |

## 6. 「新平台会在这里断」清单(severity 排序)

- [severity: major] **iOS 无原生工程,4 个原生面需 prebuild/autolink 后才有运行环境** @ app/(无 ios/ 目录,仅 android/ 已 prebuild;app.json:10-13 已有 ios 配置) — evidence: app/ 目录列表仅 android/;react-native-tcp-socket/webview/expo-file-system 均为原生模块,soa-keepalive 是 expo-module(modules/soa-keepalive/expo-module.config.json platforms:["android"]) | impact: iOS×`expo prebuild`+dev build 是硬前置,Expo Go 不可用;soa-keepalive 在 iOS 被 autolink 跳过(平台清单),运行降级正确 | recommendation: 跨平台前跑一次 `expo prebuild --platform ios` + dev client 验证(纯工程工作,非代码缺陷) |
- [severity: major] **iOS 头部安全区缺失:标题栏会顶进灵动岛/刘海** @ app/App.tsx:185 — evidence: `paddingTop: (RNStatusBar.currentHeight ?? 0) + theme.spacing.lg`;`StatusBar.currentHeight` 类型注释 `@platform android`(react-native/Libraries/Components/StatusBar/StatusBar.d.ts:81),iOS 恒 undefined → 0;根容器无 SafeAreaView(App.tsx:184 root) | impact: iOS×UI 必现错位(非崩溃) | recommendation: 改用 react-native-safe-area-context 的 useSafeAreaInsets 或 SafeAreaView(Android 侧行为不变) |
- [severity: major] **桌面复用 web bundle 时「同源代理」依赖成为断点:无 Node 代理则 start() 必断** @ app/hooks/useAnalysis.ts:223-247 + app/server.mjs:10-22 — evidence: web 采集/LLM/搜索/日志全部走 `/tdx-collect` `/llm-proxy` `/web-search` `/logs` 同源端点(proxies.cjs 双入口:metro 中间件 metro.config.js:78-92 + server.mjs);纯静态 webview 无这些端点 → 采集失败中止、LLM 代理 502 | impact: 桌面×(Tauri/Electron)必须随包带 Node 侧代理(server.mjs 逻辑)或改直连,否则核心流程不可用 | recommendation: 桌面方案确定时,把 proxies.cjs 收成可嵌入的 Node 服务或 Tauri command/IPC,而非依赖 dev server |
- [severity: minor] **平台探针三套并存(typeof location / window+document / window.location.origin)** @ app/lib/runner.ts:30、src/log.ts:24-26、src/webSearch.ts:79 — evidence: 三处 web 判定不等价(见 §2 表);当前 web+桌面 webview 下全成立,自洽 | impact: 新增平台(Worker/SSR/WebView 变体)时逐个核对,漂移风险 | recommendation: 收敛为 src/log.ts 单一 detectPlatform 面,runner/webSearch 复用 |
- [severity: minor] **web bundle 携带真机采集死链:deviceCollect → node-tdx-market → react-native-tcp-socket + zlib-shim** @ app/hooks/useAnalysis.ts:36(顶层静态 import) — evidence: import 链 useAnalysis.ts:36 → src/tdx/deviceCollect.ts:6 → node-tdx-market(其 dist 引 node:net→net-shim.ts:8→react-native-tcp-socket);web 运行时从不执行(Platform.OS 门控 useAnalysis.ts:235),生产 web 运行实证不崩;react-native-tcp-socket 无 browser 字段 → 整链 JS 进 web bundle(数百 KB 级) | impact: web×bundle 膨胀 + 死代码风险(未来 tcp-socket 升级引入 web 不安全的顶层副作用会直接炸 web) | recommendation: deviceCollect 改平台门控动态 import(与 expo-file-system 同款边界) |
- [severity: minor] **RN(iOS 同)env 键位缺口:TAVILY_API_KEY / TDX_HOST 不可达,真机静默降级** @ src/webSearch.ts:82、src/tdx/deviceCollect.ts:29、app/hooks/useAnalysis.ts:132 — evidence: 消费 `process.env.TAVILY_API_KEY`/`process.env.TDX_HOST`(deviceCollect.ts:29 `process.env.TDX_HOST ?? '150.158.160.2'`);Expo 只内联 EXPO_PUBLIC_* 前缀(app/.env.example 注释明示 08-14 R9 已删 EXPO_PUBLIC_TAVILY_API_KEY);RN 下两键恒 undefined | impact: Android/iOS×Tavily 优先失效(恒 DDG)、TDX 服务器漂移兜底失效(固定 host 列表);功能降级非崩溃 | recommendation: 若需真机 Tavily,提供 EXPO_PUBLIC_TAVILY_API_KEY 并让消费点一致;TDX_HOST 同理 |
- [severity: minor] **applySwitchesToEnv 运行时写 process.env,依赖 Metro polyfill 可变性** @ app/lib/settings.ts:104-107 — evidence: `delete process.env[name]` / `process.env[name]='1'`;babel-preset-expo 仅 release 静态内联**直接访问**(settings.ts:78-80 注释),运行时写面是否生效取决于 Metro env 对象实现;Android 现网可用 [实证:已发布],iOS 同引擎 | impact: 跨平台×风险相同于 Android,桌面 Node 集成需重验 | recommendation: 开关面改为显式注入(CommitteeDeps)而非 process.env 隐式通道,顺带去掉 RN 上不确定面 |
- [severity: nit] **app/lib/log.ts 为纯重导出残留** @ app/lib/log.ts:1-5 — evidence: `export { log, info, ... } from '../../src/log.ts'`,注释自称"统一实现已上移";App.tsx/settings.ts 经其中转 | impact: 无,卫生 | recommendation: 消费方改直连 src/log.ts 后删除 |
- [severity: nit] **ReportScreen.tsx 无任何引用方(死代码)** @ app/screens/ReportScreen.tsx:17 — evidence: 全仓 grep `ReportScreen` 仅自身定义;App.tsx 用 ReportContent(components/ReportContent.tsx) | impact: 无,卫生 | recommendation: 删除 |
- [severity: nit] **chart-view.html 与 chartHtml.ts 双份内联产物(各 ~200KB)** @ app/assets/chart-view.html:34、app/lib/chartHtml.ts:37 — evidence: tools/build-chart-view.mts:1-13 一次生成双产物(HTML 文件 + TS 模板字符串,注释称字节等价);两文件同入库 | impact: 仓库体积 ×2,生成物勿手改 | recommendation: 可接受(构建产物),但应纳入生成校验;若未来只留 WebView 一径可只留 chartHtml.ts |

## 7. 结论(三分类)

**真问题(挡跨平台):** ① 桌面:web bundle 的"同源代理"形态是全仓最大耦合泄漏 —— 桌面必须随包携带 Node 代理或改造直连(§6-3);② iOS:iOS 无原生工程 + react-native-tcp-socket 原生面未验证 + 头部安全区缺失(§6-1/2,后者是纯 UI 缺陷,前者是工程前置);③ RN bundle env 键位缺口导致真机 Tavily/TDX_HOST 静默降级(§6-6)。

**卫生问题:** web bundle 死链携带 deviceCollect/TCP 全链(§6-5)、app/lib/log.ts 残留、ReportScreen.tsx 死代码、chart 双产物、探针三套并存(§6-4)。

**非问题(设计合理):** Hermes shim 体系 —— metro resolveRequest 无条件重定向 + polyfill 首 import,Android/iOS 双端自动生效,方案正确;store 四实现共用 StoreLike、选择点单处(runner.ts:30);采集双入口按 Platform.OS 分发结构清晰;expo-file-system 三处动态 import 边界一致且全部降级安全;lightweight-charts `import type` + 动态 import 边界正确;soa-keepalive Android 平台清单 + 守卫,跨平台降级正确。
