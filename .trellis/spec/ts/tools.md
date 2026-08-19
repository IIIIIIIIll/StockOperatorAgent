---
description: Node 探针与构建脚本约定(tools/*.mts,desktop-probe 接线示范,chart 构建/校验,签名脚本)
paths:
  - tools/**
---

# 探针与构建脚本(tools/)

- `probe.mts` — Node 直跑探针(经 `--experimental-strip-types` 载 src/*.ts;
  better-sqlite3 值 import 白名单之一)。
- `desktop-probe.mts` — 桌面接线示范:`createNodeFileStore` +
  `nodeSettingsFileSystem` + `runner.setStore()` 注入点(`export let store`
  ESM live binding),无 GUI 直跑验证 store-op 链路。
- `f10-probe.mts` — F10 采集探针(带 key 直连,验证 `f10MarketFor` 深/沪
  market 判定与 GBK 解析)。
- `build-chart-view.mts` / `check-chart-view.mts` — WebView 内嵌 HTML 图表
  (app/lib/chartHtml.ts)生成与一致性校验(`npm run chart:build` /
  `chart:check`);HTML 侧镜像注释与 src/chartLayout.ts `paneTops` 同步,防
  双实现漂移。
- `configure-android-signing.mjs` — APK 签名配置(幂等;无 secrets 退出 0,
  详见 [desktop-ci.md](./desktop-ci.md))。

## 纪律

- 探针脚本一律 `.mts`(或显式 CJS),复用 src 真实导出,不做复制实现。
- 新探针若直连 src/store.ts 的 better-sqlite3 值 import,属 architecture
  契约 3 白名单面,勿在 src/app 内复制该 import。
