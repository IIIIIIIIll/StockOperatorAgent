# 桌面端开发 — 技术设计

## 架构总览

```
┌─ Electron ─────────────────────────────────────────────┐
│ main.mjs (纯 JS)                                        │
│  ├─ BrowserWindow (contextIsolation+sandbox preload)    │
│  │    loadURL http://127.0.0.1:<port>/  (app/dist)      │
│  ├─ IPC 桥: store-init / store-op (invoke, 异步)         │
│  │          settings-load/save (sendSync, 同步走缓存)     │
│  └─ spawn child: ELECTRON_RUN_AS_NODE=1 +              │
│       --experimental-strip-types desktop/child.mjs      │
│       (argv: --store-dir --settings-dir --log-dir)       │
└─────────────────────────────────────────────────────────┘
child.mjs (Electron 内嵌 Node,strip-types)
  ├─ createAppServer() ← app/server.mjs 提取(静态 dist + 4 同源代理)
  │      listen(0, '127.0.0.1') → 随机端口
  ├─ createNodeFileStore(storeDir) ← src/store-node.ts
  ├─ nodeSettingsFileSystem(settingsDir) ← src/store-node.ts
  └─ setLogDir(logDir) ← app/lib/logs-server.cjs 新增显式注入
```

## 关键设计决策与依据

### 1. 服务进程 = 自 spawn child,而非主进程内嵌

- `proxies.cjs`/`store-node.ts` 是 TS,需 `--experimental-strip-types`。Electron 主进程能否吃该 flag(NODE_OPTIONS 支持面)未实证 → 不在主进程赌。
- child 以 `ELECTRON_RUN_AS_NODE=1` 启动 `process.execPath`(electron 二进制即 node,官方模式),flag 直接放 argv —— 打包后同样成立(无系统 node 依赖)。
- 路径参数(argv)替代 env 写入 —— 遵守「process.env 零写入」架构断言。
- 生命周期:main 启动时 spawn child → child ready 消息(含端口 + 设置预载值)→ 建窗;`window-all-closed` → main 发 shutdown → child flush()+close()+server.close() → 退出;3s 超时强杀兜底。

### 2. store 接线:renderer 同步镜像 + 写穿队列(保持 StoreLike 同步契约)

- renderer 侧 `DesktopStore`(app/lib/desktopBridge.ts):`ready()` = `invoke('store-init')` 拉全量快照 → 本地镜像;12 个 StoreLike 方法同步读写本地镜像;mutator 变更同时入串行队列(`invoke('store-op')` 逐条落盘,写穿透对齐 FileStore 队列语义)。
- child 侧:store-op 按序应用到 FileStore;快照经现有 getter 序列化。
- 新增 `FileStore.listStocks(): string[]`(仅具体类方法,不进 StoreLike 接口)→ child 快照枚举用;其余字段走已有 getStock/getDatas/getPerformanceReports/getMeta。
- 数据量级小(个股级 JSON),快照一次全量;崩溃一致性 = FileStore 写穿语义,与 Android 一致。

### 3. settings 接线:main 缓存 + sendSync

- `loadSettings()` 在 useAnalysis useState 初始化器同步调用 → 必须同步可答。
- main 在 child ready 时预载设置(JSON 串),sendSync 读缓存;save → 缓存更新 + 异步转发 child 经 nodeSettingsFileSystem 落盘。
- renderer 侧 settingsStore 走 `createSettingsStore(bridgeStorage, null)`(SettingsStorageLike 形态 getItem/setItem 映射到桥)——复用 web 分支路径,零 fs 适配。

### 4. bundle 钩子(两处,均运行时 flag 门控,浏览器/Android 惰性)

- `app/lib/desktopBridge.ts`:`isDesktopBridge()` = `window?.__soaDesktop?.isDesktop`。
- `app/lib/runner.ts`:模块作用域 `if (isDesktopBridge()) setStore(new DesktopStore(bridge))`(live binding,消费方零改动)。
- `app/lib/settingsStore.ts`:`const singleton = isDesktopBridge() ? createSettingsStore(bridgeStorage(), null) : createSettingsStore();`。
- preload(contextBridge, sandbox 内可用 ipcRenderer invoke/sendSync)暴露 `window.__soaDesktop`。

### 5. server.mjs 提取与日志注入

- 提取 `export function createAppServer()`(路由体移入),`serveStatic` 保持导出,isMain listen 守卫保留(node 直跑/vitest 不回归)。
- `logs-server.cjs` 新增 `setLogDir(dir)`:模块级变量,`logFilePath()` 优先取之,SOA_LOG_DIR 兜底保留(web 路径不变)。

### 6. 安全基线

- contextIsolation: true、sandbox: true(preload 内 ipcRenderer 可用)、nodeIntegration 关闭。
- `will-navigate` preventDefault + `setWindowOpenHandler` deny(SPA 内不导航离开)。
- 端口 127.0.0.1 随机;代理 SSRF/体积/净化防线为 proxies.cjs 既有契约,零改动复用。

## 数据流与契约

- child→main 消息:`ready {port, settings}`、`ack(opId)`;main→child:`store-op {opId, op, args}`、`settings-save {json}`、`shutdown`(stdio/process.send)。
- renderer→main:`invoke 'desktop:store-init' → snapshot`、`invoke 'desktop:store-op'`、`sendSync 'desktop:settings-load'`、`sendSync 'desktop:settings-save'`。
- snapshot 结构:`{stocks: Record<ticker, StockRecord>, datas: Record<ticker, DailyBar[]>, reports: Record<ticker, PerformanceReport[]>, meta: Record<string,string>}`(JSON 安全,均纯对象)。

## 兼容性/迁移

- web/Android 路径零行为变化(bridge flag 缺省惰性;server.mjs 导出重构后行为等价)。
- `app/dist` 由 `expo export --platform web` 重建(现有脚本 `npm run web` 前半段)。
- 新增 `desktop/` 独立 package(electron devDep),不进 app metro 图、不进根 vitest 默认扫描(如有 include 限制则在 implement 阶段核实)。

## 风险与回退

| 风险 | 缓解 |
|------|------|
| Electron 二进制下载失败(WSL2 网络) | ELECTRON_MIRROR 镜像;锁 electron 版本记录 |
| WSLg 渲染(GPU 为 Basic Render Driver) | Chromium swiftshader 软件渲染兜底,可验证 UI;必要时 `--disable-gpu` |
| child strip-types 在 Electron 内嵌 Node 版本缺 flag | Electron ≥33(Node ≥22.18)必有;spike 第一步即验证,失败则升 electron 版本 |
| FileStore 快照序列化遗漏字段 | desktop-probe 扩展 round-trip 断言(写→快照→读回逐字段) |
| vitest 不扫 desktop/ | 验证面走 tools/desktop-probe.mts(仓库探针惯例),不依赖新测试目录 |

## 实施偏差(08-16 实现后回填)

- settings 保存由 sendSync 改为 **invoke 异步**(`desktop:settings-save-async`)+ renderer 本地镜像:sendSync 在 React 事件处理路径内**间歇性死锁**(同步 Mojo cond_wait 挂起 renderer 主线程;点击开关 3/5 复现、直接调用 0/2,gdb 原生栈证实 pthread_cond_wait)。settings-load 保留 sendSync(仅冷路径)。详见 spec ts/index.md「桌面 Electron 壳」。
- /llm-proxy body 上限 64KB→1MB、/web-search q 校验禁空白→禁控制字符:均真实全链(真 LLM 终审 / 分析师 DDG 回退)撞出的既有代理契约缺陷,web 生产同路径,一并修复。
- 其余按 design 原样落地(main 全 JS、child 自 spawn、快照镜像+写穿队列、setLogDir 注入、随机端口、退出清理)。
