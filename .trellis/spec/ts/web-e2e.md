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
