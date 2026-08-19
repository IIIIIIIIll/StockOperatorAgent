---
description: 桌面 Electron 壳、发布流水线与 Android 签名(desktop/ + desktopBridge + CI + 打包布局契约)
paths:
  - desktop/**
  - app/lib/desktopBridge.ts
  - app/server.mjs
  - .github/workflows/release.yml
  - tools/configure-android-signing.mjs
---

# 桌面 Electron 壳与发布流水线

## 桌面架构(08-16-desktop-app)

`desktop/`(main.mjs/preload.cjs/child.mjs,独立 package,electron devDep):

- main 进程**全 JS 零 TS 依赖**;Node 后端跑在自 spawn child
  (`ELECTRON_RUN_AS_NODE=1` + argv 带 `--experimental-strip-types`,路径经
  argv 不写 env)→ child 持 `createAppServer()`(app/server.mjs 提取的导出)+
  `createNodeFileStore` + `nodeSettingsFileSystem` + `setLogDir`;随机回环端口。
- renderer 桥 `window.__soaDesktop`(preload contextBridge,sandbox+
  contextIsolation):store 走**快照镜像 + 写穿串行队列**(`storeInit` 全量
  快照一次 hydrate,11 个 StoreLike 同步方法读本地镜像,mutator 本地应用后
  按序 invoke `store-op`;`FileStore.listStocks()/listMetaKeys()` 具体类方法
  供快照枚举)。
- bundle 钩子仅 `app/lib/desktopBridge.ts` + runner/settingsStore 两处,
  `isDesktopBridge()` 运行时门控,web/Android 零行为变化。
- **sendSync 禁令(实证教训)**:renderer 事件处理路径内 sendSync 会间歇性
  死锁(同步 Mojo cond_wait 挂起主线程,点击开关 3/5 复现、直接调用 0/2;gdb
  证实 pthread_cond_wait);settings 保存走 invoke 异步(main 缓存 + 转发
  child 落盘),仅 settings-load 冷路径(模块挂载/分析启动)保留 sendSync。
- 桌面数据目录 userData/store|settings|logs;退出流程 main 发 shutdown →
  child flush+close → 无残留。

## 打包布局契约(镜像仓库根,勿改)

```
resources/                          ← electron-builder app 根
  package.json                      ← 根 package.json("type":"module",strip-types ESM 锚点)
  src/**/*.ts                       ← extraResources(to: src)
  node_modules/**                   ← 根生产依赖(CI 先 npm ci --omit=dev;extraResources 绕
                                        electron-builder 注入的 !**/node_modules/** 排除)
  app/                              ← files 平铺:main/child/preload + server.mjs + lib/ + dist/
```

**为什么镜像根**:child.mjs 相对导入 `'../app/server.mjs'`、`'../src/store-node.ts'`
从 resources/app/ 解析;server.mjs 静态根 = 自身 dir/dist;proxies.cjs
`require('../../src/*.ts')` 从 app/lib/ 上溯两级。**任何把 app 内容嵌套成
resources/app/app/ 的布局都会打破这三处解析**(设计稿最初的错误形态)。改动
桌面入口/导入路径时,必须保持该布局或同步改打包配置。

## 决策与契约

- **asar:false + npmRebuild:false**:child 走 `ELECTRON_RUN_AS_NODE` +
  `--experimental-strip-types` 载 TS,asar 内 fs 行为不赌;运行时依赖全纯 JS
  (better-sqlite3 仅 type,architecture.test.ts 强制)→ 零原生模块,包内
  0 `*.node`。
- **版本契约**:`desktop/package.json` version ↔ tag `v<version>`;产物名自动
  带 version(Win `-Setup-${version}.exe`;Linux/mac `${productName}-${version}-
  ${arch}.{AppImage,deb,dmg}`);APK 重命名 `soa-${version}.apk`、AAB
  `soa-${version}.aab`(version 取 `${GITHUB_REF_NAME#v}`,dispatch 分支 →
  `soa-<分支名>.{apk,aab}`,仅自测)。AAB 由 `:app:bundleRelease` 产出
  (**同签名配置**——signingConfigs.release 挂上传密钥,Play App Signing 用
  同一密钥;APK 供旁载,AAB 供 Google Play 提交)。
- **上传**:tag → softprops/action-gh-release@v2(files 四类 glob +
  `soa-*.{apk,aab}`);dispatch → actions/upload-artifact@v4(name
  `soa-android`)。Release body 须含安装/签名提示(AC 要求)。
- **CI 顺序(desktop job)**:根 `npm ci --omit=dev`(生产依赖 staging)→
  `app: npm ci && npx expo export --platform web` → `desktop: npm ci &&
  npx electron-builder --publish never`。矩阵三 OS 统一 `shell: bash`。
  android job 需根依赖(langsmith 经根 node_modules 提升解析)。
- **APK 签名(tools/configure-android-signing.mjs,纯 Node 零依赖,幂等)**:
  secrets 全(`ANDROID_KEYSTORE_B64`(base64 keystore)/`ANDROID_KEYSTORE_PASSWORD`/
  `ANDROID_KEY_ALIAS`/`ANDROID_KEY_PASSWORD`)→ 解码写
  `app/android/app/release.keystore` + `app/android/keystore.properties`
  (0600,反斜杠/换行转义)+ 补丁 `app/android/app/build.gradle`(注入
  signingConfigs.release 读 properties,release buildType 改挂,重复运行零
  变化);**secrets 缺失 → 退出 0 不动作**(expo prebuild 默认 debug 签名兜底,
  流水线不中断);非法 base64/缺密码 → 非零退出,错误只打印 env 名不打印值。
  app/android 为 prebuild 产物,已被 app/.gitignore 覆盖不入库。

## 验证命令(改动打包/CI 后)

```bash
cd desktop && npx electron-builder --dir --linux     # 产 linux-unpacked
# 冒烟:packaged 布局下直跑 child(无需 GUI),GET / 200、POST /logs 200、SIGTERM 退出 0
node --experimental-strip-types child.mjs --store-dir /tmp/s --settings-dir /tmp/s --log-dir /tmp/s
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"
node tools/configure-android-signing.mjs             # 无 secrets:no-op 退出 0
```

## 陷阱

- electron-builder `files` 默认注入 `!**/node_modules/**` 排除 → 根
  node_modules 必须经 extraResources(from 指向目录本身)进包,`to` 路径相对
  resources/。
- 自定义 files 列表会替换默认 `**/*`(package.json 仍自动带上),漏列入口文件
  = 打包成功但启动即崩。
- **Wrong**:把 `app/` 内容整体搬进 `resources/app/app/`(server/proxies 相对
  解析全断)。
  **Correct**:镜像仓库根 —— resources/ = 根,resources/app/ = app 内容平铺 +
  桌面入口。
