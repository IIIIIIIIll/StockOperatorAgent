# Implement: 修复闭环验证

## 阶段 0:构建(并行)

1. [ ] 后台:`cd app/android && ./gradlew assembleDebug`(代码变更后重建)。
2. [ ] `cd app && npx expo export --platform web`(含 makeProxyMcpFetch/
      makeProxyBillionsFetch 的 dist)+ restore-app-tsconfig.mjs。

## 阶段 1:web cn 闭环验证

3. [ ] hub 起 server.mjs(env = 根 .env TDX/BILLIONS 键;ready 8090)。
4. [ ] chrome:注入 settings(三键 + TDX + 亿信 + 全开关)→ reload → 无「演示
      模式」→ 600036 cn 启动。
5. [ ] 全程证据:日志(亿信失败形态/情报段)、resource timing(/tdx-mcp 2xx、
      /billions-proxy 2xx)、D15 终态截图、报告保存。

## 阶段 2:安卓回归

6. [ ] `adb install -r` → Metro + `adb reverse` → 冷启动无 FATAL。
7. [ ] `run-as` 注入 settings → 600036 全流程 → logcat 证据(亿信形态/错误级)
      + screencap 终态。

## 阶段 3:报告与收尾

8. [ ] research/e2e-report.md:AC 矩阵 + 证据(含代理计数/情报段原文)+ 掩码。
9. [ ] trellis-check → commit → 归档。

## 验证命令速查

- server:`node --experimental-strip-types server.mjs`(127.0.0.1:8090)。
- 崩溃判据:`adb logcat -d | grep -E "FATAL EXCEPTION|ReactNativeJS"`。
- 注入校验:reload 后无「演示模式」;安卓 `run-as ... cat files/soa-settings.json`。

## 回滚

纯验证任务,无产品代码改动;两端独立,失败即记录。
