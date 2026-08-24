---
description: app 手工 E2E 验证配方——web export+server.mjs 托管、安卓构建安装冒烟、demo 链路触发、D15 终态判据、__soa 自动化钩子
paths:
  - app/server.mjs
  - app/App.tsx
---

# app 手工 E2E 验证(web 浏览器驱动 + 安卓冒烟)

- **2026-08-23(e2e-web-android)**:
  - **构建/托管**:web = `cd app && npx expo export --platform web` 后
    `node --experimental-strip-types server.mjs`(默认 `127.0.0.1:8090`,
    仅回环绑定,HOST env 可覆盖;静态服务 dist + 同源代理 `/llm-proxy/*`
    `/tdx-collect` `/web-search` `/yahoo-collect` `/logs`,代理实现单份在
    lib/proxies.cjs)。安卓 = `cd app/android && ./gradlew assembleDebug`
    → `adb install -r` → `am start`;崩溃判据 logcat 过滤
    `FATAL EXCEPTION` + `-s ReactNativeJS:E`。
  - **demo 链路触发**:未配 LLM 三键时点首页「开始分析」(ticker 预填)
    自动走演示占位 LLM(stub);自动化通道 `window.__soa.start() /
    switchTab(id) / getState()`(App.tsx effect 注入,守卫
    `typeof window !== 'undefined'`,不参与正常交互)。真实上游失败路径
    用无效 key(model/base 填真实形态,key=sk-invalid-xxx)→ 上游秒级
    401,无需等待超时。
  - **D15 终态判据(行为级)**:成功 = 「✓ 分析完成(N 步)」+ 全角色
    chips「完成」+「演示模式」标签;失败 = 错误横幅原文可见且**页面任何
    位置不得出现** ✓ 分析完成(成功标记被门控整块隐藏)。web 与 android
    行为一致(同日双端实测)。
  - **console 收集 gotcha**:SPA 重渲染会丢 in-page console hook——用双
    通道(puppeteer `console`/`pageerror` 事件 + 页内
    `window.onerror`/`unhandledrejection`/console 包装),覆盖缺口要如实
    记录并以 DOM 行为证据佐证,不要宣称全程零消息。
  - **已知展示残留**:错误终态后角色 chips 停留「分析中」不复位
    (statuses 未随 error 重置)。不影响 D15 判据;读屏验证时勿把残留
    chips 误判为仍在运行。
- **2026-08-24(e2e-real-analysis,真实 LLM 链)**:
  - **凭证注入**:`loadSettings()` 分区浅合并 → 部分注入即可:web 直写
    localStorage `soa:settings`(仅 keys 三键),安卓 `run-as` 写沙盒
    `files/soa-settings.json`(expo-file-system `Paths.document`)。值取根
    `.env` 运行时读取,档案只留掩码;`/data/local/tmp` 中转件用后即删。
  - **判别真 stub**:终态横幅 `mode==='real'?'真实 LLM':'演示模式'`
    (App.tsx lastRunAt 行)+ console「模式:真实 LLM」+ `/llm-proxy` 2xx
    往返计数,三重佐证;demo stub 必带「演示模式」标签。
  - **安卓 debug 包不内嵌 bundle**:冷启动「Unable to load script」→
    起 Metro(8081)+ `adb reverse tcp:8081 tcp:8081`;首次加载可白屏
    (惰性 chunk 构建中),force-stop 重启即正常。旧签名残留 → 先
    `adb uninstall` 再装。
  - **安卓驱动 gotcha**:系统通知权限弹窗会冻结底层窗口渲染,截屏前先关;
    被遮挡时 `uiautomator dump` 是权威状态来源。`run-as sh -c 'a && b'`
    复合命令引号易被 adb 剥层 → 拆单命令直传。
  - **chrome-devtools MCP 串行队列**:单个 `wait_for` 长超时会堵死后续
    全部请求(客户端 30s 超时不取消服务端执行)→ 长等待改轮询
    `evaluate_script`;`take_screenshot` 支持 filePath 直接落盘。
  - **双端实测基线(600036,deepseek-v4-flash)**:web 47 步/381.9s,
    安卓 36 步/178.1s——步数差 = 工具轮重试非确定性,终态语义一致;
    TDX 真实采集双端生效(web 5846 根日K);DDG 间歇 403/502 属
    尽力而为路径,优雅降级不阻塞。
