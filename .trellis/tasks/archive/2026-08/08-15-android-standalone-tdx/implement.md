# 执行计划:Android 真机独立运行(数据源 + 持久化 + 图表)

## 顺序清单(每步可验证)

### 0. 环境前置(机器改动,先做)
- [ ] `apt install openjdk-17-jdk-headless`;`java -version` 确认 17
- [ ] Android SDK 补齐:`sdkmanager "platforms;android-37" "build-tools;<最新>"`(/usr/lib/android-sdk 现仅 platform-tools);`ANDROID_HOME=/usr/lib/android-sdk` 写入 shell 环境
- [ ] 确认后台 adb:`adb devices` 见 emulator-5554(Android 17, x86_64)

### 1. 依赖与 shim
- [ ] app/ 装 `react-native-tcp-socket@^6.4.2` `events` `buffer` `react-native-webview`
- [ ] 对照 react-native-tcp-socket `lib/types/index.d.ts` 核对 node net.Socket 用到的面(setKeepAlive(enabled,delay)/write 返回/destroyed/事件名);不一致 → shim 内适配
- [ ] `app/lib/net-shim.ts`:`export { Socket, createConnection, connect } from 'react-native-tcp-socket'`
- [ ] `metro.config.js` resolveRequest 增加:`node:net` → net-shim 绝对路径;`node:events` → require.resolve('events')(保留 langsmith 分支)
- [ ] `app/index.ts` registerRootComponent 前:`global.Buffer = require('buffer').Buffer`
- [ ] 验证:`npx tsc --noEmit`(根 + app);`npx expo export --platform android` 确认 node-tdx-market 解析成功、无 node:net 解析错误

### 2. 真机采集(`src/tdx/deviceCollect.ts`)
- [ ] `collectForDevice(ticker, opts?): Promise<WebCollectResult>`:TdxClient(host 顺序尝试 ALL_HOSTS + TDX_HOST override,connectTimeout ~4s)→ connect → collectAll(日K qfq/快照/名称/xdxr)+ f10Client(719/720,组装序对齐 proxies.cjs doCollect)→ applyCollectedToStore → 返回
- [ ] freshness 门复用 gates.freshnessGates(skipDaily/skipF10 + 缓存 F10 顶替,对齐 collectForWeb)
- [ ] 失败抛错(describeError 可读);结束 disconnect()
- [ ] 验证:Node 侧单测或探针(fake socket)跑通 collectForDevice 逻辑;dev build 模拟器冒烟

### 3. 设置持久化(`app/lib/settingsStore.ts`)
- [ ] `{ load(): string | null; save(s: string): void }`;web → localStorage;RN → expo-file-system File(Paths.document/soa-settings.json,同步 textSync/write,惰性动态 import)
- [ ] settings.ts loadSettings/saveSettings 改经 settingsStore;确认 runner.ts CFG_KEY 三函数无 RN 消费(有则同迁移)
- [ ] 验证:web 行为不变(现有测试);dev build 冷启动设置保留

### 4. Android 图表(WebView + lightweight-charts)
- [ ] 生成脚本 `tools/build-chart-view.mts`(或 app/scripts):读 node_modules lightweight-charts UMD(dist/lightweight-charts.standalone.production.js)→ 内联进模板 → 产出 `app/assets/chart-view.html`(数据驱动渲染器:candlestick/line/histogram 多 pane,颜色与 IndicatorChart C 常量/LEGEND 同值;十字光标/缩放默认开启);提交产物
- [ ] IndicatorChart RN 分支:`Platform.OS !== 'web'` → WebView(source={html}),数据 = lineData/histData 结果 JSON(useMemo 缓存防流式重渲染重建);web 分支零改动
- [ ] FinancialTrendChart RN 分支:同法(financialTrendSeries 数据 JSON 注入)
- [ ] DataScreen:确认两组件数据管线 RN 下可用(computeAll/financialTrendSeries 纯 TS,无 DOM 依赖)
- [ ] 验证:dev build 截图对照 web(同 ticker 同窗口,图表形态一致)

### 5. App 接线与标识
- [ ] App.tsx start() Android 分支:demo 占位 → collectForDevice;错误路径对齐 web(明确报错中止)
- [ ] app.json:补 `android.package` + `ios.bundleIdentifier`(prebuild 前置);name/slug/version 去模板残留("HelloWorld"/expo-template-blank-typescript)
- [ ] 验证:prebuild 后 gradle 包名与 am start 一致

### 6. 构建与验证(后台 adb)
- [ ] `npx expo prebuild --platform android`(生成 android/,已 gitignore)
- [ ] `npx expo run:android`(debug)装 emulator-5554;先 demo stub LLM 跑通图执行(LangChain/Hermes 兼容性验证)→ 再真 LLM 全链
- [ ] release 独立验证:`npx expo run:android --variant release`(或 gradle 产物 `adb install -r`);**停 metro**;`adb shell am start -n <package>/.MainActivity`
- [ ] AC2 真实采集(600036/000001)→ `adb exec-out screencap -p` 截图留证(采集数据 Tab 含 AC6 图表)
- [ ] AC4 真 LLM 全链报告;AC5 冷启动设置保留(杀进程重启,`adb shell am force-stop` + 重启)
- [ ] AC3 断网/坏 host:明确报错不崩溃
- [ ] 真机(可选):同 APK 装物理机,TDX 可达性确认

### 7. 回归与收尾
- [ ] `npx vitest run` + `npx tsc --noEmit`(根与 app)全绿(AC7)
- [ ] web 手动冒烟(采集/分析/图表/设置)无回归
- [ ] 日志/journal 记录;任务归档

## 风险点/回滚点

- 每步独立可回滚:shim/deviceCollect/settingsStore/WebView 分支为新增文件或新增分支;App.tsx 单分支;metro 分支保留 langsmith 逻辑
- react-native-tcp-socket / react-native-webview 新架构不兼容 → newArchEnabled=false 重试,或换库(先记录)
- 首次 gradle 构建耗时长(依赖下载)— 属预期,非失败
- LangChain/Hermes 若 demo LLM 就崩 → 记录具体 polyfill 缺失,单独子任务修
- chart-view.html 为构建产物:生成脚本与产物同提交,改颜色/系列 → 改脚本重生成(单一事实源在组件常量)

## 验证命令速查

```bash
adb devices                                    # 后台模拟器确认
npx tsc --noEmit                               # 根
cd app && npx tsc --noEmit                     # app
npx vitest run                                 # 根测试
npx expo prebuild --platform android           # 生成 android/
npx expo run:android                           # debug 安装
npx expo run:android --variant release         # release 独立包
adb shell am start -n <package>/.MainActivity  # 启动
adb exec-out screencap -p > shot.png           # 截图留证
adb logcat -s ReactNativeJS:E                  # 抓 RN 日志
```
