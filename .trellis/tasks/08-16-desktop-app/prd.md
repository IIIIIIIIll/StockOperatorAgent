# 桌面端开发(Electron 壳)

## Goal

Electron 桌面壳(WSLg 开发运行验证),加载现有 Expo web bundle(`app/dist`),完整分析流程可用(采集 → LLM 委员会 → 决策报告),store 与设置经 Node 后端持久化到 userData 可见文件。

## Background(confirmed facts)

- web 形态 = 静态 SPA + 同源 Node server(`app/server.mjs`: `/llm-proxy/*` `/tdx-collect` `/web-search` `/logs` + 静态 dist;代理单份实现 `app/lib/proxies.cjs`,默认 127.0.0.1 回环)。
- 桌面 Node 后端铺垫完成(Session 39,归档 08-16-desktop-node-backend):`src/store-node.ts`(createNodeFileStore + nodeSettingsFileSystem)、`runner.setStore()` ESM live binding、settingsStore node 分支(`_fs` 注入)、`tools/desktop-probe.mts` 全链示范。
- 审计(08-16-modularity-audit):剩余桌面缺口仅 P2(web bundle 复用需同源代理端点);proxyBase 单点(web 下 `location.origin`)→ localhost 加载即自动同源,零 bundle 改动。
- 平台判定单面 `detectPlatform()`(web→rn→node):Electron renderer = 'web',需显式桌面桥 flag 覆盖。
- StoreLike 同步契约(12 方法);`ready()` 由 runner 显式转发,App 启动链 `await storeReady()`。
- 约束:src+app 内 **process.env 零写入**(architecture.test.ts 强制);metro 图内禁 node:fs(store-node 唯一豁免,经注入);日志统一 `src/log.ts`,落盘经 logs-server.cjs(现读 SOA_LOG_DIR/cwd,无显式注入面)。
- 验证环境:WSLg 可用(DISPLAY=:0 / WAYLAND=wayland-0);后端依赖全纯 JS(proxies/node-tdx-market/iconv-lite),child 以 `ELECTRON_RUN_AS_NODE` 自 spawn → 内嵌 Node 支持 `--experimental-strip-types`(Electron ≥33 内 Node ≥22.18)。

## Requirements

- R1 Electron 壳加载 `app/dist`,完整分析流程可用(采集/LLM/搜索/日志同源代理)。
- R2 store 持久化走 Node 后端:FileStore + node:fs 适配(createNodeFileStore),数据目录 userData/store;设置经 nodeSettingsFileSystem 语义,userData/settings.json。
- R3 随机回环端口,退出无残留进程。
- R4 安全基线:contextIsolation + sandbox preload + 禁 nodeIntegration;禁止页面导航离开。
- R5 不写 process.env;新增显式注入面(setLogDir)。

## Acceptance Criteria

- [ ] AC1 WSLg 启动桌面应用,加载 dist,start() 全链路跑通(真采集经主进程代理 + 真 LLM 或演示 stub)
- [ ] AC2 重启后 store 数据与设置持久化生效(userData 下 JSON 文件可见、跨重启读回)
- [ ] AC3 退出无残留进程(server child 随窗退出),端口随机不冲突
- [ ] AC4 桌面 web 能力可用:图表渲染、设置面板保存、上次分析结果恢复
- [ ] AC5 回归:vitest 全绿 + tsc 0 错误 + desktop-probe 通过

## Out of Scope

- 安装包/分发/签名(electron-builder 等,后续任务)
- Windows/macOS 打包验证(v1 仅 WSLg 开发运行;Windows 为最终目标,打包时验证)
- 自动更新、菜单栏/托盘、多窗口
- IdbStore/localStorage 路径的 Electron 适配(v1 统一走 Node 后端)

## Key Decisions

- 框架:Electron(用户选定;主进程/子进程即 Node,零重写,TS-only 技能栈)。
- v1 交付:开发运行验证(WSLg),不含安装包(用户选定)。
- 服务进程形态:child 自 spawn(`ELECTRON_RUN_AS_NODE=1` + `--experimental-strip-types`,argv 传路径,不写 env)→ 主进程全 JS 零 TS 依赖,规避 Electron 主进程 strip-types 不确定性。
- store 接线:renderer 同步镜像 + 写穿队列(初始化快照 hydrate,同步读本地镜像,变更本地应用 + 串行 IPC 落盘)——保持 StoreLike 同步契约,不引入 sendSync 每调用阻塞。
- settings 接线:main 启动时经 child 预载缓存,sendSync 读缓存、变更异步转发 child 落盘(nodeSettingsFileSystem)。
- 日志目录:logs-server.cjs 新增 `setLogDir(dir)` 显式注入(child 以 userData/logs 调用)。
