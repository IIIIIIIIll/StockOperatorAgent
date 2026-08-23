# Implement: E2E Verification

1. [ ] 安卓构建先行（最长杆）：`cd app/android && ./gradlew assembleDebug` 后台跑。
2. [ ] Web：`cd app && npx expo export --platform web` 刷新 dist。
3. [ ] hub 起 server.mjs（ready: port/log），浏览器打开验证 AC-W1/W2/W3/W4，截图留档 research/assets/。
4. [ ] 安卓：adb install -r → am start → logcat 过滤 FATAL/ReactNativeJS → screencap 拉回查看 → adb input 冒烟切 tab。
5. [ ] 汇总 research/e2e-report.md（AC 矩阵+证据+skipped 说明）→ 提交 → 归档。

## 回滚

纯验证任务：唯一产物为构建缓存与研究文件；失败即记录，无产品代码回滚面。
