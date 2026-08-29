# Implement: 全功能 E2E 执行序列

## 阶段 0:前置门(树状态)

- [ ] `npx vitest run`(基线 ≥666P/0F)→ `npx tsc --noEmit` 0 错误。
- [ ] `npm run chart:build && npm run chart:check`(F31 镜像一致;若产生
      diff → 记录 finding,不修)。
- [ ] `git status --porcelain` 干净(仅任务目录)。

## 阶段 1:构建(并行:安卓最长杆后台)

- [ ] 后台:`cd app/android && ./gradlew assembleDebug`。
- [ ] `cd app && npx expo export --platform web` 刷新 dist。

## 阶段 2:web 全功能验证

- [ ] hub 起 server.mjs(env = 根 .env 全键注入;ready: port 8090 + log)。
- [ ] chrome 打开 127.0.0.1:8090 → 双通道 console 挂载 → 注入
      `soa:settings`(三键 + tdxApiKey + billionsApiKey + langsmith 三件 +
      全开关 true)→ reload → 校验:无「演示模式」、localStorage 回显掩码。
- [ ] **cn 600036 全流程**:启动分析 → 周期轮询(evaluate,勿长 wait_for)→
      /llm-proxy 2xx 计数 → TDX 采集证据(/tdx-collect + 上下文数据)→
      TDX MCP/搜索/亿信产出段落截图 → D15 终态(✓ 分析完成 + chips 全完成)
      → 页面截图留档。
- [ ] **hk 00700 全流程**:同配方,/yahoo-collect 2xx + 港股报告证据。
- [ ] **us AAPL 全流程**:同配方,Finnhub 无 key 降级文案记录。
- [ ] 每步 console 消息双通道收集落档(丢 hook 缺口如实记录)。

## 阶段 3:安卓全功能验证

- [ ] `adb install -r`(旧签名残留先 uninstall)→ Metro 起(8081)+
      `adb reverse tcp:8081` → 冷启动 → logcat 清 FATAL(AC-A1)。
- [ ] `run-as` 注入 settings → 校验回显(掩码)→ 重启 app。
- [ ] **cn 600036 全流程**:logcat 收集(ReactNativeJS:E 过滤)+ screencap
      终态 + uiautomator dump 兜底。
- [ ] (评审门批准后)**us AAPL 全流程**安卓侧验证。

## 阶段 4:报告与收尾

- [ ] research/e2e-report.md:AC 矩阵(cn/hk/us × web/安卓)+ 每功能证据
      (路径/截图/日志摘录)+ 降级/skipped 如实说明 + 密钥全掩码。
- [ ] research/assets/ 截图留档。
- [ ] trellis-check → commit(仅 research + 任务目录)→ 归档。

## 验证命令速查

- server:`node --experimental-strip-types server.mjs`(默认 127.0.0.1:8090)。
- 崩溃判据:`adb logcat -d | grep -E "FATAL EXCEPTION|ReactNativeJS"`。
- 注入校验(web):reload 后读 localStorage 回显掩码 + 无「演示模式」。
- 注入校验(安卓):`run-as com.stockoperatoragent.app cat files/soa-settings.json`。

## 回滚点

纯验证任务;每面独立,失败即记录跳过,不阻塞另一面。
