# Android 真机独立运行:TDX TCP 数据源 + dev build 基建

## Goal

Android 设备(模拟器/真机)**完全独立运行**现有 TS 投资委员会应用:不依赖 dev server(Metro 代理),自带真实行情采集(TDX TCP 直连),LLM/搜索/亿信/mcp 直连,设置可持久化,**图表(采集数据 Tab 全指标图 + 财务趋势图)在 Android 上可见**。本轮交付可独立运行的 release APK,经后台 adb(emulator-5554)完成验证。

## Background(已确认事实,2026-08-15 排查)

- Android 上唯一的 dev-server 依赖是**行情采集**:web 走 `/tdx-collect` 代理(浏览器无 TCP,node-tdx-market 在 Node 侧跑)。`app/App.tsx` start() 的 Android 分支仅 `store.getMeta('demo:f10')`,无真实数据;注释"真机留注入点(走 RN TCP)"未实现。
- 其余链路真机已独立:LLM 直连(`buildLlm` proxyBase=undefined)、搜索直连(DDG/Tavily)、亿信/mcp 直连(面板键)、日志 RN 沙盒文件(`src/log.ts` RN transport)。
- **设置持久化缺失**:`app/lib/settings.ts` 与 `runner.ts` 的 save/load 走 `globalThis.localStorage`,RN 无此全局 → 冷启动回默认。`EXPO_PUBLIC_LLM_*`(app/.env,已 gitignore 未入库)只兜底三键。
- **图表 web-only**:`IndicatorChart`(10 pane: 主图 MA/EMA/BOLL + 成交量 + 涨跌幅 + 4 振荡器 + 3 单线)与 `FinancialTrendChart`(3 pane: 净利润/每股收益/销售毛利率)用 lightweight-charts v5(DOM canvas),effect 里 `Platform.OS !== 'web'` 直接 return → Android 上渲染空容器。数据源已同源(computeAll 结果 / financialTrendSeries)。
- **node-tdx-market 0.2.1 socket 依赖面**(本次移植目标):
  - `node:net`: `new net.Socket()` / `socket.connect(port, host, cb)` / `on('data'|'error'|'close')` / `write` / `destroy` / `destroyed` / `setKeepAlive`;server-list.js 测速亦用 net。
  - `node:events`: `TdxClient extends EventEmitter`(事件: connected/error)。
  - `Buffer.alloc/from/concat`(全局 Buffer);GBK 解码经 `iconv-lite` ^0.7.2(纯 JS,RN 可打包)。
  - CJS 双格式;`exports` 带 types。
- **react-native-tcp-socket 6.4.2**(RN>=0.60,兼容 RN 0.86):API 仿 node net.Socket,可作 `node:net` 的 Metro shim。需补 polyfill:`events` 包(node:events)+ `buffer` 包(global.Buffer)。方案:metro `resolveRequest` 别名 `node:net` → RN shim、`node:events` → events;`app/index.ts` 顶部挂 `global.Buffer`。
- **src/tdx/ 复用面**:`quoteClient.ts`(collectAll: 日K/快照/名称/xdxr 复权)、`f10Client.ts`(F10 719/720)、`xdxr.ts` 全部经 `node-tdx-market` 公开 API — 协议层零改动,只需让该包在 RN 可运行 + 真机接线。
- **打包安全**:better-sqlite3(node:store.ts)与 node-tdx-market 现仅被 type-import / Node 侧引用;node-tdx-market 进 RN bundle 后无冲突。
- **TDX 服务器可达性实测**:WSL2 网络 5/5 主机(150.158.160.2、124.71.187.122、101.35.121.35、122.51.120.217、111.229.247.189,华为云)3s 内 TCP 连通 :7709。模拟器共享宿主网络 → 预期可达。
- **构建环境缺口**:无 android/ 目录(被 gitignore);WSL2 无 java/gradle,Android SDK 仅 platform-tools(缺 platforms/build-tools);模拟器 emulator-5554(Android 17 / API 37, x86_64)已连接。dev build 需 expo prebuild + JDK 17 + SDK 组件。Expo Go 无法承载原生模块 → 本轮必须 dev build。

## Requirements

- R1 真机行情采集:Android 分支经 TDX TCP 直连拉取日K(前复权)/快照/名称/F10,数据入 store(FileStore),复用 web 采集契约(`applyCollectedToStore` 输入面)与 freshness 门。
- R2 协议可运行性:node-tdx-market 在 RN 运行时可用(`node:net`/`node:events`/Buffer shim + polyfill),不 fork 包源码(除非 shim 无法覆盖,须先记录)。
- R3 接线:采集结果供 `runner.run` 使用(替代 demo:f10 占位),与 web 行为对齐(失败 → 明确报错中止,不喂空数据)。
- R4 设置持久化:设置面板三键/能力开关/调用上限冷启动保留(RN → expo-file-system JSON 文件,web → localStorage 不变)。
- R5 Android 图表:IndicatorChart(全指标多面板)与 FinancialTrendChart(财务跨期趋势)在 Android 上渲染,数据与 web 同源(computeAll / financialTrendSeries),交互(十字光标/缩放)与 web 对齐。
- R6 独立运行验证:release APK 装模拟器(后台 adb,emulator-5554),**停 metro** 场景下跑通「输入代码 → 真实采集 → 真 LLM 分析 → 报告」;prebuild 需补 android.package(现缺失)。
- R7 LangChain/Hermes 兼容:先 demo stub LLM 验证图执行,再真 LLM;暴露问题记录并修。

## Acceptance Criteria

- [ ] AC1 dev build(debug 即可)在模拟器安装并启动,无 dev server 依赖提示。
- [ ] AC2 Android 端输入真实沪深代码(如 600036/000001)完成采集:store 有对应日K/F10/快照;非 demo 数据。
- [ ] AC3 断网/服务器不可达 → 明确错误提示,不崩溃、不喂空数据。
- [ ] AC4 真 LLM 三键下完整跑通分析(采集 → 委员会 → 最终决策),报告落屏。
- [ ] AC5 冷启动后设置(三键/开关/上限)保留。
- [ ] AC6 Android 上采集数据 Tab 图表可见:K线/指标多面板 + 财务趋势图渲染正确(与 web 数据一致,截图留证)。
- [ ] AC7 现有 web 端无回归(tsc + vitest 全绿)。

## Out of Scope(本轮)

- 发布形态(EAS/签名/商店)— 本轮 release APK(debug keystore)验证。
- web 端采集源切换(web 继续走 /tdx-collect 代理)。
- 北交所/港美股数据支持。
