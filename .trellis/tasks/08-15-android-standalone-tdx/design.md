# 设计:Android 真机独立运行(TDX TCP + 持久化)

## 目标与边界

- 交付 dev build + release APK 两态;release 断 metro 完全独立运行。
- 复用 src/tdx/ 全部协议层(quoteClient/f10Client/xdxr/adjust)与 store 层(FileStore/StoreLike)零改动;不 fork node-tdx-market(先尝试 shim,覆盖不了再记录决策)。
- web 端行为零改动。

## 架构(三块)

### 1. RN socket 运行时面(shim + polyfill)

node-tdx-market 0.2.1 的运行时依赖面(实测 dist 源码):
- `node:net`:`new net.Socket()` + `connect(port, host, cb)` + `on('data'|'error'|'close')` + `write` + `destroy` + `destroyed` + `setKeepAlive`(client.js / server-list.js / exhq-client.js 三处同面)
- `node:events`:EventEmitter(TdxClient 基类,connected/error 事件)
- 全局 `Buffer`:`Buffer.alloc/from/concat`
- `iconv-lite` ^0.7.2(GBK 解码,纯 JS + browser 字段;唯一 dep 是 safer-buffer)

对策:
- **shim 文件 `app/lib/net-shim.ts`**:`export { Socket, createConnection, connect } from 'react-native-tcp-socket'`(6.4.2,RN>=0.60 兼容 0.86,API 仿 node net.Socket)。实现时对照 `lib/types/index.d.ts` 核对用到的面(setKeepAlive(enabled, delay)/write 返回/destroyed),不一致处 shim 内适配。
- **metro.config.js resolveRequest 扩展**(保留 langsmith CJS 逻辑):`moduleName === 'node:net'` → net-shim 绝对路径;`'node:events'` → `require.resolve('events')`。
- **`app/index.ts` 顶部**(registerRootComponent 前):`global.Buffer = require('buffer').Buffer`(Hermes 无内置 Buffer;buffer 包纯 JS)。
- app/package.json 新增依赖:react-native-tcp-socket、events、buffer。

### 2. 真机采集接线(`src/tdx/deviceCollect.ts`)

对齐 web 采集契约(collectForWeb 的输入/输出形),WebCollectResult 同形:

- `collectForDevice(ticker, opts?: CollectSkipOpts): Promise<WebCollectResult>`
- 流程:构造 `TdxClient`(host 策略:按序尝试 `ALL_HOSTS`(或 TDX_HOST override),每 host `connectTimeout` ~4s,首个连接成功即用;不用 getFastestHost 并发测速——真机冷启动省 3-8 次多余连接)→ `connect()` → `quoteClient.collectAll`(日K qfq/快照/名称/xdxr)+ F10(`f10Client` 719/720,复用 proxies.cjs doCollect 的组装顺序)→ 组装 CollectedPayload → `applyCollectedToStore(store, payload)` → 返回。
- freshness 门:`freshnessGates`(gates.ts)按 store 现状判定 skipDaily/skipF10,同 collectForWeb;同季跳过 F10 用缓存 `f10:${ticker}` meta 顶替。
- 失败语义:抛错 → App 层 describeError 明确报错并中止(对齐 web"不喂空数据")。
- 生命周期:单次 run 单连接;结束 `disconnect()`。心跳/重连由 TdxClient 内置。

App.tsx start() Android 分支:从"沿用 demo:f10"改为调 collectForDevice,与 web 分支共用同一段 `f10Text/snapshot/name/capital` 注入与 runner.run 调用。

### 3. 设置持久化(`app/lib/settingsStore.ts`)

- 接口 `{ load(): string | null; save(s: string): void }`(JSON 字符串层面,兼容现有 settings.ts 的 parse/merge 逻辑)。
- 平台分发(isWebEnv 探针,同 runner.ts 先例):web → localStorage(现逻辑原样);RN → expo-file-system `File`(Paths.document/soa-settings.json),**同步 API**(textSync/write,expo-file-system.d.ts 已有),惰性动态 import 一次(store-file.ts/log.ts RN 先例)——loadSettings 是 useState 初始化的同步调用,不能依赖 storeReady。
- settings.ts 的 loadSettings/saveSettings 改经 settingsStore;runner.ts 的 CFG_KEY 三函数(readSavedConfig/saveConfig/clearConfig)先确认无 RN 消费(现状 App 只用 settings.ts 路径;有则一并迁移,无则不动)。

### 4. Android 图表渲染(WebView + lightweight-charts)

现状:IndicatorChart(10 pane)/FinancialTrendChart(3 pane)用 lightweight-charts v5 —— 纯 DOM/canvas,RN 无 DOM。选型:

- **方案:react-native-webview 内嵌 HTML,lightweight-charts UMD 跑在 WebView 里**。理由:图表逻辑/交互(十字光标/缩放/多 pane)与 web **逐像素同源**,零重写渲染逻辑;数据本地 JSON 注入,无网络依赖(独立运行成立)。react-native-webview 是原生模块,与 react-native-tcp-socket 同进 dev build,不增加第二构建形态。
- 备选(不选):react-native-svg 手绘(需重写 10-pane 逻辑 + 交叉线/缩放,行为难对齐);skia(重依赖 + 新架构耦合)。

落地:
- `app/assets/chart-view.html`:生成脚本把 lightweight-charts UMD(dist/lightweight-charts.standalone.production.js)内联进模板 + 数据驱动渲染器(series spec 数组 → createChart 多 pane,candlestick/line/histogram,颜色与 LEGEND/C 常量同值)。**构建时生成并提交**(~200-300KB,确定性)。
- 组件 RN 分支:IndicatorChart/FinancialTrendChart 在 `Platform.OS !== 'web'` 时改渲染 WebView(现有数据管线不变:lineData/histData/financialTrendSeries 已算好 → JSON 序列化注入;useMemo 缓存 JSON 防流式重渲染重建)。
- web 分支零改动(仍直连 lightweight-charts)。
- 数据契约:HTML 渲染器消费 `{ bars, series[], panes }` 纯数据,不含 React/业务逻辑 — 与 web 效果一致性由同一库 + 同一系列定义保证。

### 5. 验证载体(后台 adb)

- 目标:模拟器 emulator-5554(Android 17 / API 37, x86_64),后台 adb 已在线(实测 `adb devices` 见 device)。
- debug:`expo run:android` 自动经 adb 安装;release:gradle 产物 `adb install -r` 或 `expo run:android --variant release`。
- 交互/留证:`adb shell am start -n <package>/.MainActivity`;`adb exec-out screencap -p` 截图(图表 AC6 证据);`adb logcat` 抓 RN 日志。

## 数据流

```
App.start() [Android]
  └─ collectForDevice(code)
       ├─ TdxClient(host 顺序尝试) ─ TCP ─ TDX 服务器(实测可达)
       ├─ collectAll: 日K(qfq) + 快照 + 名称 + xdxr
       ├─ F10: 719/720 → 财务文本 + 股本结构
       └─ applyCollectedToStore(FileStore) → WebCollectResult
  ├─ buildStockInformation + runner.run(真 LLM 直连 / demo stub)
  └─ 报告渲染;采集数据 Tab 图表(web: 直连 lightweight-charts / RN: WebView 内联同库渲染)
```

## 契约与对齐

- StoreLike 同步契约、写穿透队列、freshness 跨会话 — 不新增第二套(ts spec 持久化段)。
- 日志统一走 src/log.ts(RN 沙盒文件 transport 已在)。
- 密钥:进面板 settingsStore,不落日志;Metro 不内联非 EXPO_PUBLIC 变量(ts spec 已述)。
- 采集错误:不喂空数据;TDX 不可达 → 明确报错 + 中止(对齐 web 采集失败语义)。

## 风险与验证项

| 风险 | 对策/验证 |
|---|---|
| react-native-tcp-socket 新架构(Fabric)兼容 | 安装后核对 types;dev build 冒烟;失败 → 退旧架构(newArchEnabled=false)或换库 |
| node-tdx-market 内部 API 面超出 shim | 逐项核对 client.js/server-list.js 用到的 net 面;缺 → shim 补适配,不改包 |
| iconv-lite browser 字段解析 | Metro browser mainFields;若 browser 构建缺依赖 → resolveRequest 强制主入口 |
| Hermes: Buffer/TextEncoder/streams(langchain 链) | index.ts Buffer polyfill;验证序:demo stub LLM → 真 LLM |
| TDX 服务器列表过期 | host 顺序尝试 + TDX_HOST override(settings/env);失败有重连 + 明确报错 |
| 模拟器 x86_64 vs 真机 arm64 | 同一 APK 两架构;验证以后台 adb 模拟器为准,真机可选 |
| dev build 仍需 metro 加载 JS | "独立"验收以 release APK 为准(expo run:android --variant release / adb install,debug keystore 可验) |
| WebView 图表与 web 渲染漂移 | 同一 lightweight-charts UMD + 同一系列/颜色定义;HTML 渲染器数据驱动;截图对比 |
| chart-view.html 体积 | ~300KB 内联 UMD,接受(独立运行无网络,不能 CDN) |
| android.package 缺失 | prebuild 前补 app.json android.package + ios.bundleIdentifier(一次性标识,后改需重装) |

## 兼容 / 回滚

- web 零改动(图表 web 分支不动);FileStore/InMemoryStore 不动;node-tdx-market 不改源码(shim 隔离)。
- 回滚点:shim 分支、deviceCollect、settingsStore、图表 WebView 分支均为新增文件/分支;App.tsx 单分支改动。
- 环境前置(不可回滚的机器改动):JDK 17 + Android SDK platforms;android-37 + build-tools;ANDROID_HOME。
- 新依赖:react-native-tcp-socket / events / buffer / react-native-webview(全为 app/ 依赖,web bundle 不引入)。
