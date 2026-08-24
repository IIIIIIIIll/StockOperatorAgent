# Implement: 真实分析 E2E

1. [ ] 安卓构建先行(后台):`cd app/android && ./gradlew assembleDebug`。
2. [ ] web 构建:`cd app && npx expo export --platform web`;hub 起 server.mjs(`node --experimental-strip-types server.mjs`,ready: 8090)。
3. [ ] 浏览器验证 AC-W1/W2/W3:打开 127.0.0.1:8090 → evaluate 注入 `soa:settings`(三键自根 .env 读,掩码留证)→ reload 确认无「演示模式」→ 驱动 600036 分析 → 双通道 console + /llm-proxy 往返 + D15 终态截图。
4. [ ] 尽力而为项(web):观察 TDX 采集进度/日志,记录采集结果与数据进入分析的证据;失败记因不计败。
5. [ ] 安卓:`adb install -r` → `run-as com.stockoperatoragent.app sh -c 'cat > files/soa-settings.json'` 注入 → 冷启动 → logcat 清 FATAL(AC-A1)→ 驱动同 ticker 分析 → 终态 screencap + ReactNativeJS 检查(AC-A2)。
6. [ ] 汇总 research/e2e-report.md:AC 矩阵、证据路径、skipped/尽力而为项如实说明;密钥全掩码。
7. [ ] trellis-check → commit → 归档。

## 验证命令速查

- 构建:见步骤 1-2;server ready 判据 hub wait pattern/port 8090。
- 注入校验(web):reload 后读 localStorage 回显掩码 + 页面无「演示模式」。
- 安卓注入校验:`run-as com.stockoperatoragent.app cat files/soa-settings.json`(回显掩码)。
- 崩溃判据:`adb logcat -d | grep -E "FATAL EXCEPTION|ReactNativeJS"`。

## 回滚点

纯验证任务无产品代码改动;每步失败即记录跳过依据,不阻塞后续端(两端互不依赖,web 先行可独立出结论)。
