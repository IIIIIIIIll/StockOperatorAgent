# PRD: ts/ 目录平移到仓库根

## 背景

`ts/` 是当前仓库唯一代码主体（Python 业务代码已由 08-14-phaseout-e-py-deletion 分域删除，
根目录仅剩冻结的 `data_source/.../tdx/vendor/` 参考代码）。`ts/` 前缀已无区分价值，
应平移到仓库根，消除一层无意义嵌套。

## 目标

将 `ts/` 下所有内容平移到仓库根目录，保持代码、测试、构建全部可用，并同步所有外部引用。

## 范围

### In scope
- `ts/src/` → `src/`（31 文件）
- `ts/app/` → `app/`（Expo 子项目，自带 package.json/metro.config.js）
- `ts/test/` → `test/`（35 测试文件 + fixtures）
- `ts/tools/` → `tools/`
- `ts/package.json`、`ts/package-lock.json`、`ts/tsconfig.json` → 根目录
- `ts/.gitignore` → 合并进根 `.gitignore` 后删除
- 未跟踪磁盘目录 `ts/logs/`、`ts/probe-output/`、`ts/node_modules/` → 平移到根（git 无感）
- 外部引用同步：README.md、.env.example、.trellis/spec 路径
- 验证：根目录 `npm test` + `npm run typecheck` 全绿

### Out of scope
- `data_source/`、`docs/`、`database/`、`data/`、`logs/`（Python 时代残留/冻结物）不动
- 不清理根目录 Python 残留（用户未要求）
- 不改代码逻辑，纯移动

## 关键事实（已调研）

- 根目录无 `src`/`app`/`test`/`tools`/`package.json`/`tsconfig.json`/`package-lock.json`
  → tracked 名零冲突
- `ts/` 内部无 `ts/` 前缀导入（grep 零命中），app↔src↔test↔tools 全为 `../src/...`
  相对路径 → 整体平移相对关系不变
- `ts/.gitignore`：`node_modules/`、`dist/`、`*.db*`、`logs/`、`app/dist/`、
  `probe-output/`、`app/.expo/` — 需并入根 .gitignore（根已有 `logs`、`data`、`*.fs.*`）
- 引用方：README.md（`cd ts`、`ts/src/...`、`ts/probe-output/`）、.env.example:3
  注释、`.trellis/spec/ts/index.md`（frontmatter `paths: ts/**` + 正文）、
  `.trellis/spec/error-handling.md`、`.trellis/spec/architecture.md`、
  `.trellis/spec/data_source/tdx.md`

## 验收标准

1. `ts/` 目录消失（git 层面无 `ts/` 前缀 tracked 文件）
2. 根目录 `npm test` 全绿（vitest，原 ts/test 套件）
3. 根目录 `npm run typecheck` 零错误
4. `cd app` 后 Expo 工程自洽（tsc/export 不受影响；app 内部相对引用不变）
5. README.md / .env.example 无 `ts/` 路径残留
6. `.trellis/spec/ts/index.md` frontmatter `paths` 指向新布局（src/**、app/**、
   test/**、tools/**），正文及 error-handling.md / architecture.md / tdx.md 的
   `ts/` 引用同步更新
7. `git mv` 保留历史；未跟踪目录一并迁移
8. 根 `.gitignore` 含原 ts/.gitignore 全部条目，`git status` 干净

## 风险

- 低。纯移动 + 文档引用同步；唯一行为面是根目录 npm 脚本 cwd 变化，已由相对路径保证
