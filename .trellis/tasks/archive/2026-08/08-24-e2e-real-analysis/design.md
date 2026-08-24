# Design: 真实场景双端 E2E 验证

## 凭证注入通道(核心设计)

`loadSettings()`(app/lib/settings.ts)对持久化 JSON 做分区浅合并(`{...d.keys, ...p.keys}`),故**部分注入即可**,switches/caps 走默认值:

- **web**:页面 JS 直写 `localStorage['soa:settings']` = `{"keys":{"llmApiKey":…,"llmModel":…,"llmBaseUrl":…}}` → reload 生效(loadSettings 是 useState 初始化同步读)。经 puppeteer `page.evaluate` 注入,完整 key 不落任何文件。
- **安卓**:debug 包可 `adb shell run-as com.stockoperatoragent.app` 写沙盒文件 `files/soa-settings.json`(expo-file-system documentDirectory,KEY 同 web 单键语义,settingsStore.ts RN_SETTINGS_FILE)。写入后冷启动 app 生效。备选:设置面板 adb input 逐字输入(易错,仅作 fallback)。
- 三键值来源:根 `.env`,由执行脚本运行时读取,不进命令行历史/工件。

## 流量拓扑(两端差异)

```
web 浏览器 ──同源──> server.mjs(proxies.cjs)
                      ├ /llm-proxy/*   → X-LLM-Base/base 转发 → opencode.ai(SSRF 校验放行公网)
                      ├ /tdx-collect    → node-tdx-market(CN ticker)
                      ├ /yahoo-collect  → YahooClient(HK/US ticker)
                      └ /web-search     → DDG
安卓设备(emulator NAT=宿主网络) ──直连──> https://opencode.ai/zen/go/v1/chat/completions
                                  └─数据面:设备侧采集(deviceYahooCollect 等,执行期确认 CN 面;尽力而为)
```

判别真 stub:`llmConfigured()` 三键齐 → 真 LLM,UI 无「演示模式」标签;demo stub 必有该标签(D15 配方)。

## 判据与取证

- D15 行为级终态(web-e2e.md):成功 = 「✓ 分析完成(N 步)」+ 全角色 chips「完成」;失败 = 错误横幅原文且无成功标记。本任务加判别条件:**无「演示模式」标签** + `/llm-proxy` 2xx(web)/设备直连可达(安卓)。
- console 双通道:puppeteer `console`/`pageerror` 事件 + 页内 onerror/unhandledrejection/console 包装(SPA 重渲染会丢页内 hook,覆盖缺口如实记录)。
- 安卓:logcat 过滤 `FATAL EXCEPTION` + `ReactNativeJS`;screencap 终态截图。
- 已知展示残留(勿误判):错误终态后 chips 停留「分析中」不复位——本任务预期走成功路径,若遇失败按此甄别。

## Ticker 与场景

- 主 ticker:**600036**(CN → TDX 采集链,web 端真实数据面);安卓端同 ticker 可比。
- 备选:AAPL(Yahoo 链),仅在 CN 采集失败时换道验证港美股面(尽力而为项)。

## 执行顺序

1. 安卓构建先行(最长杆,后台):`cd app/android && ./gradlew assembleDebug`。
2. 并行 web:`cd app && npx expo export --platform web`;hub 起 `node --experimental-strip-types server.mjs`(127.0.0.1:8090,node v22 需显式 flag)。
3. 浏览器(puppeteer)注入 localStorage → reload → 驱动「开始分析」→ 观察 progress/终态/网络往返,截图留档 research/assets/。
4. 安卓:adb install -r → run-as 注入 soa-settings.json → 冷启动 → adb 驱动分析 → logcat + screencap。
5. 汇总 research/e2e-report.md(AC 矩阵+证据+skipped 说明)→ trellis-check → commit。

## 回滚

纯验证任务,产品代码零改动;唯一产物为构建缓存与研究文件。失败即记录,无回滚面。凭证注入动作结束后 localStorage/沙盒文件留存真实 key 于本机(模拟器/web 本地),报告中掩码;如需可执行清除(记录于报告附录)。
