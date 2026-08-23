# Desktop / Tools / CI / 根配置 全仓评审报告

- **范围**: `desktop/`(main.mjs child.mjs preload.cjs electron-builder.yml package.json)、`tools/*.mts` + `configure-android-signing.mjs`、`.github/workflows/release.yml`、根配置(tsconfig.json / vitest.config.ts / package.json / .env.example / .gitignore)、git 跟踪文件密钥卫生扫描。
- **方法**: 纯静态分析(read/grep/glob/git ls-files),未运行 build/lint/test/dev server。判定前先过基线 `.trellis/tasks/archive/2026-08/08-22-repo-review-remediation/findings_verified.md`(REFUTED/investigated-not-bug 不重报;A1/A2 已实证否决不再涉及)与 `.trellis/spec/guides/index.md` 三类 FP 模式;域规格对照 `ts/desktop-ci.md`、`ts/tools.md`。
- **HEAD**: e4d8680(工作区仅新增本评审任务目录,无源码改动)。
- **上轮整改核验结论(A 域四项全部落地,详见 Verified-clean)**: A3 版本门禁 ✓、A4 严格 base64+魔数 ✓、A5 store-op 形状校验 ✓、A6 Host 头校验 ✓。

## 发现表

| ID | 严重度 | 标题 | 证据(file:line + 引文) | 影响 | 建议修法 | 置信度 |
|---|---|---|---|---|---|---|
| F1 | **P1** | FileStore hydrate 对损坏文件零容错 + 落盘非原子写 → 一次不干净退出可致桌面端启动死循环 | `src/store-file.ts:115` `const data = JSON.parse(text) as TickerFile;`(hydrate :100-127 内裸解析,:107 meta 同);`src/store-node.ts:25` `await fsWriteFile(path, data, 'utf8');`(直接整文件覆写,无 tmp+rename);`desktop/child.mjs:220-221` `store = createNodeFileStore(storeDir); await store.ready();` → 解析抛错沿 main().catch(:294-297)`process.exit(1)` → `desktop/main.mjs:157-158` `console.error('[main] child exited unexpectedly — quitting'); app.quit();` | 断电/SIGKILL 恰逢落盘窗口留下截断 JSON → 此后每次启动 child fatal exit → 应用永久无法启动,需用户手动定位 userData/store 删除损坏文件。RN/device 路径同用该 hydrate(collectForDevice await ready()),Android 同病。写队列的 `.catch(logError)`(:132-134)只护写入 op,不护 hydrate | 双修:① hydrate 逐文件 try/catch,坏文件跳过 + logError(降级不崩);② 写入改 tmp 文件 + rename 原子替换(node 适配器一行;expo 分支可用现有 API 评估)。修后补「截断文件 → 启动存活」用例 | 0.75 |
| F2 | P2 | Electron 无单实例锁,双开共享 userData → split-brain 写路径放大 F1 | 全仓 grep `requestSingleInstanceLock|singleInstance` 零命中;`desktop/main.mjs:281-294` whenReady 直接 mkdir userData 子目录并 spawn child,无任何实例互斥;两个 child 各持独立内存镜像,对同一 `<ticker>.json` 与 `meta.json` 整文件覆写(`src/store-file.ts:145,152`) | 用户双击双开(Windows 常见)→ 两后端并发写同一数据目录:同 ticker 互相整槽覆盖丢更新;并发写交错可产生 F1 的损坏 JSON → 下次启动崩溃循环。端口不冲突(随机 listen(0)),故障静默 | main 进程加 `app.requestSingleInstanceLock()`,二次启动 `second-instance` 聚焦已有窗口后退出 | 0.85 |
| F3 | P3 | child 启动窗口期无父死检测 → 可留孤儿常驻 | `desktop/child.mjs:286-291` `process.on('disconnect', gracefulShutdown)` 等三个守护注册在 main() 末尾,而前置链路 :220-240(TS import + store.ready() + server.listen)耗时数秒且期间无监听 | 主进程在 spawn~ready 之间被 SIGKILL/崩溃 → child 收不到 disconnect(无监听者),继续跑完启动后永久驻留(随机端口 + 占住数据目录句柄),send('ready') 走死通道被静默丢弃(:66-73) | 注册提前到模块顶层(main() 之前),回调内判空容错(store/server 未就绪时直接 process.exit(0)) | 0.8 |
| F4 | P3 | release.yml android job 完全无缓存,desktop job 有 npm cache——不一致且拖慢 CI | `.github/workflows/release.yml:110-113` android setup-node 仅 node-version(对比 desktop job :33-37 有 `cache: npm` + cache-dependency-path);`:129-133` setup-java 无 `cache: gradle` → 每次 Android 构建全量下载 Gradle 发行版 + Maven 依赖 | 纯效率:android job 每次冷启动多花数分钟;不影响正确性 | android setup-node 补 `cache: npm`;setup-java 加 `cache: gradle`(官方支持) | 0.95 |
| F5 | P3 | 第三方 release action 以可变 tag 引用且持有 contents:write —— 供应链面未按 SHA pin | `release.yml:70` 与 `:165` `uses: softprops/action-gh-release@v2`(tag 引用,非 SHA);顶层 `permissions: contents: write`(:9-10)。actions/* 官方四个同为 tag pin | tag 可变:第三方仓库被攻破时可在 v2 tag 上投毒,获得写权限向 Release 投放恶意安装包。属硬化建议非现实漏洞 | 第三方 action 改 SHA pin(`softprops/action-gh-release@<full-sha>`)并加注释说明版本;官方 action 可维持 tag pin | 0.7 |
| F6 | P3 | tools/probe.mts 注释残留 U5 前旧行为描述(fc 非 2xx 会抛)——U8 同源修正漏改此处 | `tools/probe.mts:152-153`「预取 A3 经 cookieProvider 注入(YahooClient 自身 fc 请求遇非 2xx 会抛,crumb 链断)」vs U5 后实现 `src/yahoo/yahooClient.ts:221-224`:先状态码无关 `parseA3FromSetCookie`,仅无 A3 才抛 | 文档漂移:注释陈述的行为已不存在,误导后续维护者以为必须预取 A3 否则 crumb 链断(proxies.cjs 同款注释已由 U8 修正,此处遗漏) | 注释改为「预取 A3 经 cookieProvider 注入,避免重复 fc 请求(单源 obtainA3 缓存语义,与 proxies.cjs 一致)」 | 0.95 |
| F7 | P3 | electron-builder buildResources 目录不存在且无 icon 配置 → 三平台产物用默认 Electron 图标 | `desktop/electron-builder.yml:14` `buildResources: build`;glob desktop/ 仅 6 个文件,无 build/ 目录,配置内亦无 win/linux/mac icon 键 | 打包成功但 Win/Linux/mac 安装器与运行时图标均为默认 Electron 图标(builder 仅告警不失败),品牌观感缺失;无任何文档声明这是有意为之 | 补 desktop/build/icon.{ico,icns,png}(≥512px)或显式在 yml 配置 icon 路径;若暂不做,加注释声明现状 | 0.75 |

## Verified-clean 抽检清单

1. **A3 修复落地且位置正确**:release.yml 双 job 均有版本门禁(desktop job :39-52 置于 npm ci/electron-builder 前;android job :116-129 置于 prebuild/signing/build 前),`node -p "JSON.parse(...)"` 读版本、`${GITHUB_REF_NAME#v}` 只进 bash 比较/echo,无 `${{ }}` 插值注入面;含 `/` 的畸形 tag 被门禁自然拦截。
2. **A4 修复落地且质量好**:configure-android-signing.mjs 先 trim 全部空白(:166)→ 字符集/4 对齐/填充正则 + 解码-重编码往返比对拒绝非规范 base64(:126-141)→ JKS/JCEKS/PKCS12 魔数识别(:146-160)→ 校验先于任何写入;错误消息只含 env 名不含值;无 secrets 退出 0 降级 debug 签名不变;幂等(hasRelease 检查 + patched===gradle 不写回)。
3. **A5/A6 修复落地、无新端点**:child.mjs 六 op 形状校验表 STORE_OP_VALIDATORS(:118-186)+ `hasOwnProperty` 白名单防原型链 + PATH_SEP_RE 纵深,与 main.mjs STORE_OPS 六元素集合(:46-53)完全一致;server.mjs Host 校验(isLoopbackBind && !isLoopbackHostHeader → 403)置于路由分发前(:100-114);proxies.cjs 导出面仍恰为 llm-proxy/tdx-collect/yahoo-collect/websearch 四 handler(:368-372),无新增端点绕过 gate。
4. **preload 暴露面不变**:恰 4 方法 + isDesktop 布尔(preload.cjs:15-22);main.mjs webPreferences contextIsolation/sandbox true、nodeIntegration false(:261-266),will-navigate 无条件 preventDefault + window-open deny(:270-271);桌面 loadURL 为 127.0.0.1(Host 合法过 gate)。
5. **密钥卫生干净(方法+覆盖面)**:①高信号字面量模式(`-----BEGIN x PRIVATE KEY-----`、`sk-`/`lsv2_`/`ghp_`/AKIA 前缀真实形态)全仓零命中;②硬编码赋值模式 `(password|passwd|secret|api_key|token)\s*[:=]\s*["'][^"']{8,}["']` 零命中;③宽标识符扫描(case-insensitive)48 文件逐条人工分诊 = env 变量名/测试假密钥('secret-key'/'test-key')/文档与归档/LICENSE/package-lock 元数据,无一真实值;④`git ls-files`(853 文件)核查:仅 .env.example 入库(全占位符,.env 被忽略),keystore/*.pem/*.key/*.p12/*.jks 零跟踪,产物类 `*.apk/*.aab/*.exe/release.keystore` 根级忽略,app 层 `/android`、`*.jks/*.key/*.p12/*.pem` 双保险覆盖签名脚本全部输出物(app/android/keystore.properties 在被忽略目录内)。
6. **生命周期常规路径闭环**:window-all-closed/SIGTERM/SIGINT 统一走 shutdownChild(shutdown 消息 → 3s SIGKILL grace → 5s 强退兜底,timer 均 unref);child 侧 shutdown/disconnect/信号三入口幂等(shuttingDown flag)先 flush 后退出;child 异常退出时 pendingOps/pendingSnapshots 全部 reject 后 app.quit,渲染层写穿 catch 仅记错不挂队列;IPC 每 op 带 15s 超时防悬挂。
7. **U32 落地**:vitest.config.ts testTimeout 15_000 且带根因注释,与 testing.md 记录一致;root tsconfig include 覆盖 src/test/tools 三面,probe 用 transform-types、desktop 用 strip-types 属各自运行面既定差异。

## 待查线索(未达发现门槛)

- Java properties 值转义未处理前导空格:`java.util.Properties.load` 会跳过分隔符后的前导空白,口令若以空格开头会被吞(escapePropertyValue 仅处理反斜杠/换行,:138-141)。GitHub Secrets 含前导空格属病态输入。
- PKCS12 魔数只认 `0x30 0x82`:>64KB 的 keystore(DER 长度字节 0x83+)会被误拒;代码注释已论证常规 keystore 远小于该界,属文档化取舍。
- 4 个并行 job(3 OS matrix + android)同时对同一 tag 跑 softprops/action-gh-release,并发创建 Release 存在理论竞态(422/409);静态分析无法证实 softprops 内部重试行为,需实跑观察。
- main.mjs settings-save-async 对 undefined 输入会经 `JSON.stringify(undefined)` 得 undefined 并让 child 写出字符串 `"undefined"`;但类型化桥接 desktopBridge.ts:36/:219 恒传 string,可信 renderer 契约下不可达。

## 未覆盖面声明

- 禁跑约束下,electron-builder 实际打包布局、workflow 真实执行、Electron IPC 运行时时序均为静态走查 + 规格对照,未经实跑验证;F1/F2 的触发概率未做动态复现(修复建议中的用例需运行环境)。
- node_modules 内第三方依赖(electron/electron-builder/RNW 内部实现)未审;GitHub Actions 语义按公开文档推断。
- src/store-file.ts 的存储语义全貌、app/lib/desktopBridge.ts 深层正确性属其它切片(SrcCoreReview/VerifyRemediation),本报告仅沿桌面生命周期链取证至必要深度(F1/F2 根因锚点在 src/,由桌面侧暴露,请主会话去重归属)。
- 二进制/图片类跟踪文件仅做 git ls-files 类型清单审查,未做熵分析;app/android(prebuild 产物,不入库)与 Kotlin 工程不在范围。
