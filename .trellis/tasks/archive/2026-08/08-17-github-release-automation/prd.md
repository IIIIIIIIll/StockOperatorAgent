# GitHub 自动化发布流水线

## Goal

打 tag → GitHub Actions 自动构建**桌面安装包**（Windows NSIS / Linux AppImage+deb / macOS dmg）+ **Android APK**，产物自动挂到 GitHub Release；无 tag 手动触发时产物落 Actions artifact（CI 自测通道）。

## Background(confirmed facts)

- 远端：`git@github.com:IIIIIIIIll/StockOperatorAgent.git`；仓库目前**无 `.github/`**。
- 桌面壳 `desktop/`：`main.mjs`（Electron 主进程，全 JS 零 TS 依赖）→ 自 spawn child（`ELECTRON_RUN_AS_NODE=1` + `--experimental-strip-types`，路径走 argv）→ `child.mjs` 持 `createAppServer()`（`app/server.mjs`）+ `src/store-node.ts`。
- `server.mjs` 静态根 = 相对自身 `dist/`（即 `app/dist`，`npx expo export --platform web` 产物，gitignored）；代理 `app/lib/proxies.cjs` 经 `require('../../src/*.ts')` 引 TS（strip-types）。**全部路径相对解析 → 打包布局与源码布局一致即可工作**。
- 运行时依赖全纯 JS：根 package.json 生产依赖仅 `@langchain/core|langgraph|openai`、`iconv-lite`、`node-tdx-market`（其自身仅依赖 iconv-lite）、`string_decoder`。`better-sqlite3` 是 devDep 且仅 type（architecture.test.ts 强制）→ **无原生模块，无需 npmRebuild/asarUnpack**。
- `desktop/package.json`：electron 43.4.0 devDep、version 1.0.0、`main: main.mjs`、无 dependencies。
- `app/` 为 Expo managed（无 `android/` 目录，CI 内 `expo prebuild` 生成）。
- 本机：node 22.22.3 / npm 12；WSL2 无 X server（Electron GUI 冒烟不可行 → 以 packaged 布局下 child 冒烟替代）。

## Requirements

- R1 `v*` tag 推送自动触发；`workflow_dispatch` 手动触发（无 tag → 产物传 Actions artifact）。
- R2 桌面产物矩阵：windows-latest→NSIS exe、ubuntu-latest→AppImage+deb、macos-latest→dmg（均不签名）。
- R3 Android APK：ubuntu-latest + expo prebuild + gradle `assembleRelease`（v1 debug 签名，可安装）。
- R4 产物经 GitHub Release 分发；Release 说明含安装/签名提示。
- R5 打包配置本机可验证（`electron-builder --dir` 产出 + packaged 布局 child 冒烟）。
- R6 版本契约：`desktop/package.json` version ↔ tag `v<version>` 对齐，README 写明发版步骤。

## Acceptance Criteria

- [ ] AC1 本机 `electron-builder --dir` 成功：`desktop/dist/linux-unpacked/` 内含 main/child/preload、`app/dist/**`、`src/**/*.ts`、根生产 node_modules；无原生模块进包。
- [ ] AC2 packaged 布局冒烟：`node --experimental-strip-types child.mjs` 自该布局启动 → `GET /` 返回 dist 首页、`POST /logs` 200、指定目录落盘。
- [ ] AC3 `release.yml` 合法（YAML 解析通过）：作业划分、矩阵、产物命名/上传路径与 electron-builder 输出契约一致；tag 分支走 gh-release、dispatch 分支走 upload-artifact。
- [ ] AC4 README 新增「发布」章节：打 tag 步骤、产物位置、签名限制、APK keystore 生成与 Secrets 配置步骤、安装提示。
- [ ] AC5 回归：根 `npx vitest run` + `npx tsc --noEmit` 全绿（打包配置改动不动业务代码，验证为基线）。
- [ ] AC6 签名脚本 `tools/configure-android-signing.mjs` 双路径可验证：有 secrets → 生成 keystore/keystore.properties/补丁 gradle（临时 fixture 验证）；无 secrets → 无操作退出 0。

> CI 实跑（含 APK job）只能在 GitHub 侧验证——本机无 Android SDK / GH runner；AC3 以静态校验 + 契约一致为准，首次 CI 运行作为上线验证。

## Out of Scope

- 代码签名（Windows Authenticode / macOS notarization / Android keystore 正式签名）——README 说明限制与后续路径。
- `electron-updater` 应用内自动更新。
- 应用图标定制（electron-builder 默认图标 + 警告）。
- EAS Build / 应用商店分发。
- Windows/macOS 本机构建验证（CI 矩阵覆盖）。

## Key Decisions

- **asar: false**：child 走 `ELECTRON_RUN_AS_NODE` + strip-types 载 TS，asar 内 fs 行为（尤其 ELECTRON_RUN_AS_NODE 下）不赌；应用小，明文目录无感知代价。
- **生产依赖 staging**：electron-builder 只认 `desktop/package.json` 的 dependencies（空）→ 根 `node_modules` 经显式 files 模式进包；CI 中根 `npm ci --omit=dev` 保证只进生产依赖（避免 whack-a-mole 排除 devDeps）。
- **APK 正式签名（secrets 驱动）**：CI 中若配置 `ANDROID_KEYSTORE_B64`（base64 keystore）+ 密码/别名 Secrets → 写入 keystore + `keystore.properties` + 补丁 `app/build.gradle` release signingConfig（提交的脚本 `tools/configure-android-signing.mjs`，幂等）；未配置 → 自动降级 debug 签名（expo prebuild 默认），Release 说明标注。keystore 生成命令与 Secrets 配置步骤写进 README（GitHub 侧操作由用户执行）。
- **macOS dmg 不签名**：可构建分发，Gatekeeper 提示"未知开发者"；真签名需开发者证书（付费），README 说明。
- **产物命名契约**（跨 slice 接口，勿漂移）：`desktop/dist/` 输出；`${productName}-${version}-${arch}.${ext}`（win Setup 变体 `-Setup-`）；APK 重命名 `soa-${version}.apk`；Release asset 名 = 文件名。
