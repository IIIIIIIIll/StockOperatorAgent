# 设计：GitHub 自动化发布流水线

## 打包布局（asar:false）

```
desktop/dist/                 ← electron-builder 输出（gitignored 新增）
linux-unpacked/resources/app/
  main.mjs  preload.cjs  child.mjs   ← desktop 入口（electron-builder 默认收）
  package.json                        ← desktop/package.json
  app/
    server.mjs  lib/**  dist/**      ← expo export 产物（相对路径解析依赖此布局）
  src/**/*.ts                        ← child 经 strip-types 载入
  package.json                       ← 根 package.json（node 模块解析锚点）
  node_modules/**                    ← 根生产依赖（staging 后仅 prod）
```

- `server.mjs` 的 `DIST = path.join(ROOT, 'dist')`（ROOT=app/）→ 布局与源码一致，零代码改动。
- `proxies.cjs` `require('../../src/*.ts')`（app/lib → 根 src）→ 一致。
- `src/store-node.ts` 等 `require('@langchain/*')` 向上解析到 `resources/app/node_modules` → 一致。
- 无原生模块 → `npmRebuild: false`、无 asarUnpack。

## electron-builder 配置（desktop/electron-builder.yml）

```yaml
appId: com.stockoperatoragent.desktop
productName: StockOperatorAgent
directories: { output: dist, buildResources: build }
asar: false
npmRebuild: false
files:
  - main.mjs
  - preload.cjs
  - child.mjs
  - ../app/server.mjs
  - ../app/lib/**
  - ../app/dist/**
  - ../src/**/*.ts
  - ../package.json
  - ../node_modules/**          # CI staging 后仅生产依赖
win:  { target: [nsis], artifactName: ${productName}-Setup-${version}.${ext} }
linux: { target: [AppImage, deb], category: Utility,
         artifactName: ${productName}-${version}-${arch}.${ext} }
mac:  { target: [dmg], artifactName: ${productName}-${version}-${arch}.${ext} }
```

- `desktop/package.json` 增补：`author`（electron-builder 警告消缺）、`scripts.pack`（本地验证入口）、version 即发布版本。
- 根 `.gitignore` 增 `desktop/dist/`。

## 发布工作流（.github/workflows/release.yml）

```
触发: push tag v*  |  workflow_dispatch
┌─ job desktop ────────────── 矩阵 × [ubuntu, windows, macos]
│  checkout → setup-node(22, cache npm)
│  root: npm ci --omit=dev          ← 生产依赖 staging
│  app:  npm ci && npx expo export --platform web
│  desktop: npm ci && npx electron-builder --publish never
│  上传: tag → softprops/action-gh-release@v2 (files: desktop/dist/*.{exe,AppImage,deb,dmg})
│        dispatch → actions/upload-artifact@v4（同名文件，CI 自测）
└─ job android ────────────── ubuntu-latest
   checkout → setup-node(22) → setup-java(temurin 17)
   app: npm ci && npx expo prebuild --platform android --no-install
   签名: node tools/configure-android-signing.mjs   ← secrets 有→正式签名；无→debug 降级
   gradle: ./gradlew :app:assembleRelease --no-daemon -x lint
   上传: tag → app/android/app/build/outputs/apk/release/app-release.apk → soa-${version}.apk
        dispatch → upload-artifact
```

- **APK 正式签名（用户选定）**：`ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` 四个 Secrets。脚本 `tools/configure-android-signing.mjs`（纯 Node，提交入库）：B64 解码 → `app/android/app/release.keystore`；写 `app/android/keystore.properties`（storeFile 相对路径 + 三密码）；补丁 `app/android/app/build.gradle`（幂等：`signingConfigs.release` 块读 keystore.properties，release buildType 改挂 release 签名）；secrets 缺失 → 退出 0 不动作（expo 模板默认 debug 签名兜底）。

- 版本契约：`desktop/package.json` version ↔ `v*` tag；electron-builder 产物名自动带 version；APK 重命名步骤把 `app-release.apk` 改为 `soa-<version>.apk`（从 git tag 取，`${GITHUB_REF_NAME#v}`）。
- 各 job 独立 npm ci（仓库无 workspace 聚合，三包各有 lock）。
- gradle 内存：`GRADLE_OPTS=-Xmx3g`；GH runner 预装 Android SDK/NDK（RN 0.86 目标 SDK 35+，runner 满足）。
- 跨 job 无依赖 → 并行。
- README 增「发布」章节：发版步骤（bump version → tag → push）、产物清单、签名限制（Win/mac 提示、APK debug 签名）、私有仓库 Release 需登录说明。

## 契约（跨 slice，勿漂移）

| 项 | 值 |
|---|---|
| 打包输出目录 | `desktop/dist/` |
| Linux 产物 | `${productName}-${version}-${arch}.AppImage` / `.deb` |
| Windows 产物 | `${productName}-Setup-${version}.exe` |
| macOS 产物 | `${productName}-${version}-${arch}.dmg` |
| APK 产物名 | `soa-${version}.apk` |
| APK 签名 | Secrets 驱动正式签名（`ANDROID_KEYSTORE_B64`/`ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_ALIAS`/`ANDROID_KEY_PASSWORD`）；缺失 → debug 降级 |
| 签名脚本 | `tools/configure-android-signing.mjs`（幂等补丁，无 secrets 退出 0） |
| 上传 | tag: softprops/action-gh-release@v2；dispatch: actions/upload-artifact@v4 |
| node | 22（三方包 lock 兼容） |
| tag 格式 | `v<version>`（与 desktop/package.json 对齐） |

## 风险与缓解

- **electron-builder 下载 Electron 43.4.0（~110MB）**：本机/CI 均网络可及；失败重试一次。
- **WSL2 无 GUI**：Electron 窗口冒烟不可行 → packaged 布局 child 冒烟（AC2）证明后端+静态面；窗口层留给用户首次 CI 后本地实跑。
- **expo prebuild 需要 app/ 干净**：fresh checkout 即干净；`--no-install` 防 npm 二次安装。
- **APK job 本机不可验证**：静态校验 + 契约对齐；首次 dispatch 实跑为验证手段。
- **artifactName 与上传 glob 不一致**：契约表即验收锚点，check agent 逐项核对。
