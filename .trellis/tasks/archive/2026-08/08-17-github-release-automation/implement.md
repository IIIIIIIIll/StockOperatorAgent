# 实施计划：GitHub 自动化发布流水线

## 执行顺序（两 slice 并行，契约见 design.md）

### Slice A — 桌面打包（本地可验证）
1. `desktop/electron-builder.yml`：按 design.md 配置（asar:false、files、targets、artifactName）。
2. `desktop/package.json`：补 `author`；加 `"pack": "electron-builder"` 脚本。
3. 根 `.gitignore` 增 `desktop/dist/`。
4. 本地验证：
   - 根 staging：`npm ci --omit=dev`（动 node_modules 前确认工作区无依赖它的进程）
   - `cd desktop && npm ci && npx electron-builder --dir --linux`（下载 electron ~110MB）
   - 冒烟：自 `desktop/dist/linux-unpacked/resources/app/` 以 `node --experimental-strip-types child.mjs --store-dir /tmp/soa-smoke/store --settings-dir /tmp/soa-smoke/settings --log-dir /tmp/soa-smoke/logs` 启动 → curl `GET /` 得 index.html、`POST /logs` 200、目录落盘、SIGTERM 干净退出。
   - 恢复根依赖：`npm ci`
   - 回归：根 `npx vitest run` + `npx tsc --noEmit`
5. 产物核对：linux-unpacked 内 app/dist 存在、src/**/*.ts 存在、node_modules 仅生产依赖（无 typescript/vitest/better-sqlite3 等 dev 包）。

### Slice B — 发布工作流 + 文档 + 签名脚本
1. `tools/configure-android-signing.mjs`：纯 Node，幂等补丁 android 签名（见 design.md）；本地用临时 fixture（典型 RN build.gradle + 假 base64 keystore）双路径验证：secrets 全 → 产出 keystore/keystore.properties/补丁；缺 secrets → 退出 0 无动作。
2. `.github/workflows/release.yml`：desktop 矩阵 job（ubuntu/windows/macos）+ android job，按 design.md 契约。
3. YAML 校验：`python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))"`。
4. README「发布」章节：bump version → tag v* → push；产物清单；签名限制；APK keystore 生成命令（keytool）与 4 个 Secrets 配置步骤；APK 安装提示。

## 验证命令（终检，全绿才算完成）

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"
cd desktop && npx electron-builder --dir --linux      # 已由 Slice A 产出
# packaged 冒烟（AC2 命令）
cd .. && npx vitest run && npx tsc --noEmit           # AC5 基线
# 签名脚本双路径（AC6）：secrets 全 → fixture 产出三件套；缺 → 退出 0
node tools/configure-android-signing.mjs              # 无 secrets：no-op 退出 0
```

## 回滚点

- 配置未动业务代码：任何一步失败 → 还原 electron-builder.yml / package.json / .gitignore / workflow 文件即可，无数据面。
- 本机 npm 状态：`npm ci` 恢复锁文件状态。

## 验收

按 prd.md AC1–AC5；AC3 契约逐项对照 design.md 契约表。
