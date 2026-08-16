# 切片 B:业务层纯净度审计(src/ 平台杂质 + better-sqlite3 import 闭包 + 双 tsconfig)

> 审计基准:.trellis/spec/ts/index.md;纯静态审计,零代码改动。

## 1. 杂质表(src/**/*.ts)

### 1.1 node 原生 / 平台专属包 import

- [minor] `src/store.ts:3` 顶层静态 `import Database from 'better-sqlite3'`(Node 原生,无惰性保护)— evidence: store.ts:3 顶层 import;仓库全量 grep 值 import 仅 4 处:test/events.test.ts:4、test/pipeline.test.ts:3、test/store-gates.test.ts:2、tools/probe.mts:6;src/ 内 12 个消费方全为 `import type`(chartData.ts:5/events.ts:7/lastRun.ts:5/overview.ts:9/pipeline.ts:5/reports.ts:4/store-file.ts:9/store-idb.ts:7/store-memory.ts:3/webCollect.ts:4/tdx/deviceCollect.ts:8/tdx/quoteClient.ts:5),app/ 仅 runner.ts:6 `import type { StoreLike }` | impact: 不进 web/RN bundle;仅 Node(vitest+tools)真用;但保护是"看不见的约定"(type-only),无 lint/构建强制,共享代码新增一个值 import 即 web/RN 构建炸弹 | recommendation: 保持 type-only 约定,可选加 eslint 规则 `import/no-restricted-imports` 禁非 type import of './store.ts'(或仿 store-file.ts 惰性化)。
- [major] `app/hooks/useAnalysis.ts:36` 静态值 import `collectForDevice, setDeviceStore` from `../../src/tdx/deviceCollect.ts` → `src/tdx/deviceCollect.ts:7` 顶层 `import { TdxClient } from 'node-tdx-market'`,且 deviceCollect.ts:52-53 值 import `./quoteClient.ts` 与 `./f10Client.ts`(后两者又值 import node-tdx-market/iconv-lite)— evidence: 链 App.tsx:15 → useAnalysis:36 → deviceCollect:7,52-53 → quoteClient.ts:4 / f10Client.ts:4-5 / xdxr.ts:2;node-tdx-market dist 顶层 require node:events+node:net(dist/client.js:37-38)、node:zlib(dist/protocol/frame.js:6) | impact: **node-tdx-market 连同 shims 整体进入 web bundle**(web 用不到,只走 /tdx-collect 代理);web 能跑依赖 4 重隐式保护:① metro.config.js:23-68 resolveRequest 全平台重定向 node:* → lib 适配;② net-shim.ts:8 → react-native-tcp-socket 顶层 `new NativeEventEmitter(NativeModules.TcpSockets)`(src/Globals.js:3-6)在 react-native-web 下不抛;③ app/index.ts:3 polyfill 首 import 装 Buffer(exhq-types.js 顶层 Buffer.from);④ 运行时 `Platform.OS === 'web'` 门控(useAnalysis.ts:246-256)使 collectForDevice 永不执行。任一断裂(node-tdx-market 升级加顶层 node: 用法 / react-native-tcp-socket 收紧 web 解析)即 web 加载崩 | recommendation: 参照 spec 已有先例(lightweight-charts "web-only + 动态 import"),把 deviceCollect 改为非 web 分支动态 `await import()`,或 metro 按 platform 条件解析,使 web bundle 不含 TCP 客户端。
- [nit] `src/tdx/f10Client.ts:5` `import iconv from 'iconv-lite'` 经 deviceCollect 值链入 web/RN bundle — evidence: f10Client.ts:4-5;deviceCollect.ts:53 | impact: 纯 JS 死重(web 不执行),无崩溃风险;GBK 解码走 iconv-lite 是 spec 契约(ts/index.md "GBK 解码用 iconv-lite(Hermes TextDecoder 不支持 gbk)"),非问题面 | recommendation: 随上面 deviceCollect 动态化一并解决。
- [非问题] `src/log.ts:161` 与 `src/store-file.ts:43` `await import('expo-file-system')` 动态 import + catch 降级 — evidence: log.ts:150-164(模块级惰性初始化一次,注释明示"web/Node 包不含该模块——静态 import 会污染其他平台打包");store-file.ts:40-46(同先例) | impact: 仅 RN 运行时触发,web/Node 打包零污染;vitest 解析失败被 catch 吞掉 | recommendation: 无(正确模式,store-file 对齐 log.ts 先例)。
- [非问题] `node:` 内置 import:src/ 零命中(grep 全量);test/ 与 tools/ 的 node:fs 属 Node 侧合法。

### 1.2 DOM 全局直接使用

- [非问题] `src/log.ts:16-18` 模块级 `declare const window/document/navigator` + typeof 守卫(isWebEnv :24-25、isRnEnv :28-30);`src/log.ts:75-77` `window?.location?.origin` 经 isWebEnv 守卫;`src/webSearch.ts:75-80` 同款 declare window + 守卫;`src/store-idb.ts:62-70` globalThis 探针取 indexedDB/IDBKeyRange(注释 :55-57 明示"不 declare global(双 tsconfig 冲突)");`app/lib/runner.ts:30-31` `typeof location` 探针、:86-107 `globalThis.localStorage?.` 可选链 | impact: 全部运行时守卫,无裸用;双 tsconfig 规避策略已内建 | recommendation: 无。
- [非问题] localStorage/indexedDB/TextDecoder 裸用:src/ 零命中(localStorage 仅 app 侧 globalThis?. 守卫;indexedDB 仅 globalThis 探针;TextDecoder 无使用,GBK 走 iconv-lite)。

### 1.3 process.env 直读(8 处)

- [minor] `src/billionsClient.ts:94` BILLIONS_API_KEY;`src/billionsTools.ts:162,170` BILLIONS_{cap}_DISABLED / BILLIONS_{cap}_MAX_CALLS;`src/committee.ts:41` envDisabledBool;`src/llm.ts:23,66` readLlmEnv/makeLlm 默认参 process.env;`src/mcp.ts:195,240` TDX_MCP_ENABLED / TDX_API_KEY;`src/webSearch.ts:17,82` envDisabled / TAVILY_API_KEY;`src/tdx/deviceCollect.ts:29` TDX_HOST;仅 `src/log.ts:69-70` envValue 带 `typeof process === 'undefined'` 守卫 | impact: web/RN bundle 中非 EXPO_PUBLIC_* env 读取恒 undefined(Expo 只静态内联 EXPO_PUBLIC_*,settings.ts:78-80 注释实证),即"Node-only 配置面"随 bundle 分发但静默失效;web 端密钥已改构造注入(localStorage,亿信注释"不读 process.env——Metro 不内联非 EXPO_PUBLIC 变量")。漂移先例:08-14 审计 R9 已实证 EXPO_PUBLIC_TAVILY_API_KEY 死配置 | recommendation: 对 client 侧可达的 src 模块统一"构造注入优先"约定;webSearch.ts:82 / deviceCollect.ts:29 等 Node 专属读取标注释或迁至 Node 侧接线。

## 2. better-sqlite3 import 闭包实证(核心结论)

**web/RN bundle 不含 better-sqlite3。保护机制 = type-only import 约定(babel/Metro 变换期擦除 type-only import → src/store.ts 永不进入 app 依赖图)。**

引用方全量(grep 实证,23 命中):
- 值 import(4 处,全部 Node 侧):test/events.test.ts:4、test/pipeline.test.ts:3、test/store-gates.test.ts:2、tools/probe.mts:6。
- type-only(13 处):src/chartData.ts:5、events.ts:7、lastRun.ts:5、overview.ts:9、pipeline.ts:5、reports.ts:4、store-file.ts:9、store-idb.ts:7、store-memory.ts:3、webCollect.ts:4、tdx/deviceCollect.ts:8、tdx/quoteClient.ts:5、app/lib/runner.ts:6。
- **gates.ts 不 import store.ts 任何形式**(全文件无 store import,已读 :1-28);webCollect.ts:4 仅 type;events.ts:7 仅 type。
- 佐证:better-sqlite3 在 root package.json devDependencies(非 app deps),即使误值 import 也会在 app 构建期解析失败(可探测);src/store-memory.ts:1 注释"better-sqlite3 是 Node 原生,浏览器不可用"记录设计意图。

**对照:node-tdx-market 无同款保护** —— useAnalysis.ts:36 静态值 import deviceCollect → node-tdx-market 链入 web+RN 两 bundle(见 1.1 major 条),web 端靠 4 重隐式机制兜底而非 import 隔离。

## 3. src/store.ts 惰性保护判定

无。store.ts:3 顶层静态 import,无条件分支;保护在**消费者侧**(type-only)。对比 store-file.ts:40-46(log.ts:161 同款)对 expo-file-system 用动态 import + catch 降级。结论:当前"能用且安全"(值 import 全在 Node 上下文),但保护不可见、无强制,与 store-file 的显式惰性模式不对称;新增共享代码值 import 即静默引入构建炸弹。

## 4. 双 tsconfig 编译面

- 根 tsconfig.json:include `src/**/*.ts`+`test/**/*.ts`+`tools/**/*.mts`,lib=[ES2024](无 DOM),types=[node]。
- app/tsconfig.json:extends expo/tsconfig.base(lib=[DOM,ESNext],moduleResolution=bundler,customConditions=react-native),include `**/*.ts`/`**/*.tsx`/`**/*.d.ts`(相对 app/)+ `../src/expo-file-system.d.ts`。**include 面唯一 src 重叠 = src/expo-file-system.d.ts**。
- 但 app 经 .ts 后缀 import 把 ~全部 src 拉进 app 程序(第 2 节引用链 + app 侧 17 处 `../../src/` import:runner.ts×14、useAnalysis.ts×7、DataScreen.tsx×6、IndicatorChart.tsx×3、settings.ts/settingsStore.ts/log.ts 等)— 即 src 业务层实际双编译面(lib 不同:ES2024 vs DOM+ESNext)。
- 冲突风险:src 无任何 `declare global` 声明 DOM 名(唯一 `declare global` 是 log.ts:19-21 自定义名 `__SOA_DEBUG`,双面无冲突);window/document/navigator/location 均模块级 declare const 遮蔽 + typeof 守卫;store-idb.ts 用 globalThis 探针规避。**现状零冲突,但机制脆弱**:新 src 代码若 declare global window 类名,在 app 程序(DOM lib)即重复声明冲突;且 app 无 typecheck script(根 "typecheck" 只跑单面),双编译错误仅编辑器暴露。
- severity: nit(约定约束)+ 非问题(现状设计正确)。

## 5. tdx/ 目录平台依赖

- 引用方实证:deviceCollect.ts ← useAnalysis.ts:36(app,值);quoteClient.ts ← deviceCollect.ts:52(值)、webCollect.ts:5(仅 type,擦除)、app/lib/proxies.cjs:13(Node require)、tools/probe.mts:10、test/qfq.test.ts:4、test/live.integration.test.ts:6;f10Client.ts ← deviceCollect.ts:53(值)、proxies.cjs:14、tools/probe.mts:9、tools/f10-probe.mts:2、test/live.integration.test.ts:7;xdxr.ts ← quoteClient.ts:7(值)、test/live.integration.test.ts:6。
- RN 兜底:metro.config.js:46-63 全平台 resolveRequest 重定向 node:net→app/lib/net-shim.ts(react-native-tcp-socket 适配,参数归一 net-shim.ts:8-10)、node:events→events npm、node:zlib→zlib-shim.cjs(手写 RFC1950/1951 inflate)、node:async_hooks→async-hooks-shim.ts;app/index.ts:3 polyfill 首 import(Buffer + subarray 包装 + timer unref/ref no-op);GBK 走 iconv-lite。
- Node/桌面:proxies.cjs 直 require src/tdx/*.ts(node --experimental-strip-types,proxies.cjs:6-14),tools/*.mts 直连;Node 原生 net/zlib,不经 shim。
- iOS(未来):react-native-tcp-socket 原生支持 iOS(app/package.json:18 依赖),deviceCollect 路径应可直接复用(shims 纯 JS 平台无关);桌面 web-like bundle 继承 web 端死重问题(1.1 major)。

## 结论(三分类)

- **真问题(1 条 major)**:useAnalysis.ts:36 → deviceCollect → node-tdx-market 静态进 web bundle — 对比 better-sqlite3 的 type-only 隔离,node-tdx-market 无同类保护,靠 4 重隐式机制(polyfill 时序 + shims + react-native-web 容错 + 运行时门控)兜底,升级/重构即碎;未来桌面 web-like 目标继承死重。建议 deviceCollect 改动态 import 或 metro platform 条件解析。
- **卫生问题**:① src 8 处 process.env 直读(Node-only 配置面随 web/RN bundle 静默失效,含 08-14 R9 死配置先例);② app/lib/log.ts 与 src/log.ts 双入口并存(useAnalysis 走 ../lib/log,runner 走 src/log.ts,重导出 shim);③ iconv-lite/node-tdx-market 死重随 web bundle。
- **非问题**:① expo-file-system 双动态 import(log.ts:161 / store-file.ts:43)为正确模式;② DOM 全局全守卫探针(log/webSearch/store-idb/runner),零裸用;③ tdx 三层平台切分(deviceCollect=RN / webCollect=web / proxies.cjs=Node)职责清晰;④ 双 tsconfig 现状无冲突(规避设计内建),仅"新代码勿 declare global DOM 名"的脆弱约定待文档化。
