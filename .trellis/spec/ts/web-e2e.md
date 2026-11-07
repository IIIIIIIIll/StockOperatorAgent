---
description: app 手工 E2E 验证配方——web export+server.mjs 托管、安卓构建安装冒烟、demo 链路触发、D15 终态判据、__soa 自动化钩子
paths:
  - app/server.mjs
  - app/App.tsx
---

# app 手工 E2E 验证(web 浏览器驱动 + 安卓冒烟)

- **2026-11-07(安卓 debug 包陈旧 bundle —— 会伪装成「代码没生效」)**:
  - **症状**:代码已改、Metro 在跑、`expo export` 也过,但 app 冷启动后行为仍是旧代码
    (本次 CR-25 差点被误判为复现 bug:`vol: b.volume` 拿 null 参与算术 → `VOL_RATIO=0.000`,
    新代码应为 `N/A`)。
  - **判据(唯一可信)**:`adb shell "run-as <pkg> grep -c '<本次改动的独有串>' files/BridgelessReactNativeDevBundle.js"`。
    命中 0 = app 载的是旧 bundle,与 `tsc`/`vitest` 结果无关。对照 curl
    `http://127.0.0.1:8081/index.bundle?platform=android&dev=true` 若含新代码而设备 bundle 不含,
    则问题在 Metro 涂层而不在代码。
  - **修复(三步缺一不可)**:`kill <旧 metro pid>` → `npx expo start --port 8081 -c` →
    `adb reverse tcp:8081 tcp:8081` → `run-as <pkg> rm -f files/BridgelessReactNativeDevBundle.js`
    → `am force-stop`/`am start` → 重新 grep 应命中。**只重启 app 不删该缓存文件无效**
    (实测两次重启均仍为旧 bundle;长期运行的 Metro 不会因文件变更而必然重建图)。
  - **已装包判据**:`dumpsys package <pkg> | grep flags` 无 `DEBUGGABLE` = release
    (跑内嵌 bundle,永不走 Metro);本次 release 0.1.9 上盖 debug 包时 `adb install -r`
    **未**触发签名冲突(未清数据),不要默认必须先 `adb uninstall`。

- **2026-11-05(抽屉二级菜单 UI 驱动要点)**:☰ 打开左侧抽屉,一级是菜单(设置/历史),二级页在同一抽屉内切换(← 返回 / ✕ 关闭);右上角原来的「历史」按钮已删。驱动时注意:
  - **抽屉宽度是比例算的**(`App.tsx` `drawerWidthFor`:窄屏 88% 上限 360dp、宽屏 28% clamp 320–420dp),**不要按固定 320dp 断言**;取真实宽度用 `[data-testid="drawer"]` 的 `getBoundingClientRect()`(RN web 把 testID 渲染成 `data-testid`)。
  - **布局只看一个阈值** `DRAWER_OVERLAY_MAX_WIDTH = 760`:窄于此值覆盖式(遮罩 + 绝对定位),否则占位式;窗口 resize 时布局即时切换,不需重挂载。
  - **dev 环境的 LogBox 警告条会压住抽屉底部 footer**(「编辑」/「清空全部」),看起来像被安全区裁掉 —— 先按它右侧 ✕ 关掉再复核;真实安全区余量在 `HistoryPanel` footer 的 `insets.bottom` 里,量法:`dumpsys window displays` 看 navigationBars frame(本机 63px)。
  - **emoji 图标在无 emoji 字体的 web/headless 环境渲染成方块**(实测 🕘 变 □,标题里的 📈 同理);界面上改用 ⚙/↺ 这类基本符号更稳。
  - **只改 JS 时不需要重装 APK**:debug 包走 Metro,`npx expo start --port 8081`(非 CI 模式)+ `adb reverse tcp:8081 tcp:8081` + `am force-stop`/`am start` 即可;之后的样式微调走 Fast Refresh,不重启。
- **2026-11-04(分析历史安卓实测,真机驱动要点)**:
  - **先查已装包是 debug 还是 release**:`adb shell dumpsys package <pkg> | grep flags`
    无 `DEBUGGABLE` 即 release 包 —— 它跑**内嵌 bundle**,Metro 改了代码也不会生效
    (实测白查半小时)。装 debug 需 `cd app/android && ./gradlew assembleDebug`,
    release 已装包签名不匹配 → 先 `adb uninstall`(会清数据)再 `adb install -r`。
  - **Metro 必须非 CI 模式**:`CI=1 expo start` 禁 watch,**改完代码重启 app 仍拿到旧
    bundle**;调 UI 时用 `npx expo start`(非 CI)。测试要 demo 模式 → 启动前把
    `EXPO_PUBLIC_LLM_*` 置空,否则 Metro 从 .env 注入真 key(真 LLM 跑几分钟)。
  - **触摸被 LogBox 吃掉**:dev 模式底部警告条 `Open debugger to view warnings`
    (`clickable=true`,约 [26,2170][1054,2295])会盖住底部按钮 —— 先点它的 ✕ 关闭,
    再点目标控件;否则「点了没反应」。
  - **底部按钮要留 safe-area**:全屏/绝对定位面板的 footer 不加上
    `insets.bottom` 会落在系统导航栏下(实测 1080x2424 @420dpi,可用区截止 ~2298px),
    `input tap` 直接落到系统。
  - **uiautomator 取点击坐标**:`uiautomator dump` 后按 `clickable="true"` 节点的
    bounds 中心点 tap;文字节点 bounds 小于触摸区,按文字中心点可能落在热区边缘。
  - **功能实测序列(全过)**:done → `run-as <pkg> ls files/soa-runs` 出现 index.json
    + `<id>.json`(demo 单条 13.9KB);抽屉按天分组;点条目→横幅「正在查看历史」+返回最新;
    重启 app 记录仍在;编辑→☐→☑→删除选中→确认删除→ `index.json` 为 `[]` 且正文文件已删;
    再重启仍为空(lastRun 不复活 —— 迁移标记生效)。

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
- **2026-08-29(e2e-full-features,全功能五连跑)**:
  - **基线(全功能全开,deepseek-v4-flash)**:web cn 64 步/1029.7s、
    hk 56 步/896.8s、us 66 步/1169.8s;安卓 cn 52 步/700.6s、us 56 步/
    868.5s——5/5 D15 终态全过;步数/耗时随工具轮重试非确定性浮动。
  - **亿信平台差异(08-29 修复)**:web 端曾因 `billionsClient` fetch 方法调用
    Illegal invocation 全灭 → 已修(裸调用包装);随后暴露亿信**实际响应无 CORS
    头**(预检有、响应无)→ 已修(同源 /billions-proxy,固定 host + path 白名单,
    见 proxies.cjs handleBillionsProxy)。安卓 RN fetch 不检查 this/CORS →
    直连正常。
  - **TDX MCP 平台差异(08-29 修复)**:web 浏览器直连 mcp.tdx.com.cn:3001 被
    CORS 阻断 → 已修(同源 /tdx-mcp 代理:initialize 握手 + 会话 ID 透传 +
    SSE 流式,curl 端到端实证 wenda-mcp-server 200);安卓直连无 CORS 正常。
    客户端 web 分支经 makeProxyMcpFetch/makeProxyBillionsFetch(runner.ts
    webBillionsFetch 单点判定),Node/RN 直连不变。
  - **安卓输入 gotcha**:RN TextInput 对 `adb input text`(commitText
    通道)不响应,逐键 `input keyevent KEYCODE_*` 有效(先 tap 聚焦、
    MOVE_END 后 DEL 清空,再逐键输入);模拟器 stylus 手写引导弹窗会
    吞掉全部输入 → 先 `settings put secure stylus_handwriting_tutorial_shown 1`
    禁用。
  - **web headless __soa gotcha**:首帧 passive effect 未 flush,
    `window.__soa` 在首次交互(点任意按钮)后才注入;手动赋值的 probe
    残留会误判「已注入」——以 `Object.keys` 验证真对象。
  - **resource timing 计数**:单页面多轮运行会因 buffer 溢出(默认 250)
    丢弃新条目——跨轮次计数不可靠,单轮内快照为准;llm 往返证据也可
    用「每角色报告生成日志」佐证。
  - **上游间歇实测**:亿信 HTTP 502(安卓 3 次)+ DDG 502(1 次)——均
    尽力而为优雅降级,不阻塞终态。
