---
description: 环境变量单点读取、能力开关显式注入、EXPO_PUBLIC_* 编译期内联与密钥轮换、平台探针单面
paths:
  - src/env.ts
  - src/switches.ts
  - src/log.ts
  - app/lib/settings.ts
---

# 环境变量、能力开关与密钥

## env 单点(src/env.ts)

`envValue(name)` 是 src 下 process.env 读取唯一入口(typeof process 守卫单点;
web 无 process → undefined、RN 为 Metro polyfill、Node 原生)。**process.env
零写入**(architecture 契约 6,赋值/delete 零容忍)。EXPO_PUBLIC_* **直接成员
访问**豁免——babel-preset-expo 只静态内联直接访问,`const env = process.env`
别名逃逸 → release 运行时缺失。豁免白名单(见各处注释):webSearch.
defaultSearcher / deviceCollect.DEVICE_TDX_HOSTS / settings.ts loadSettings。

优先级:**构造注入 > envValue > 默认**。

## 能力开关(src/switches.ts)

- **process.env 零写入**:能力开关经 `setCapabilitySwitches`(语义 enabled)
  显式注入;消费点(committee/webSearch/mcp/billionsTools/agents)惰性读
  `getCapabilitySwitches()`。
- 未注入 → `fromEnv()` 从 DISABLED 键反推(tdxMcp: `TDX_MCP_DISABLED`、
  webSearch: `WEB_SEARCH_DISABLED`、billions/search/twitter/fetch/findb/
  analyst: `BILLIONS_*_DISABLED`),与旧 envDisabledBool 逐位等价。
- 面板开关映射 `switchesToCapabilities`(app/lib/settings.ts,三值
  searchMax/twitterMax/fetchMax 经 assembleTools → maxCallsByCap 注入);
  App start/onSettingsChange 注入。

## EXPO_PUBLIC_* 密钥(08-17 泄露实证)

- **编译期内联**:`expo export`/gradle bundle 把 `app/.env` 的 EXPO_PUBLIC_*
  值**写死进 JS bundle**(web dist 与 Android bundle 都是);桌面打包把
  `app/dist` 整体带入安装包 → 发布包 = 密钥公开。
- **构建产物若发现旧值残留**:`expo export --clear` + 删 `/tmp/metro-cache*`
  (metro 持久化缓存复用旧 transform,清空 .env 后 bundle 仍含旧值,hash 不变
  即缓存命中)。
- **正式发布构建时 `app/.env` 的 EXPO_PUBLIC_LLM_* 必须留空**,密钥走设置面板
  运行时输入(localStorage);兜底注入只允许私有自用构建。**密钥进过公开产物
  → 轮换**。

## 平台探针单面(08-16-audit-remediation)

平台判定统一经 `src/log.ts` `detectPlatform()`(web→rn→node);`typeof window`
守卫探针(App.tsx __soa 钩子、log.ts/webSearch.ts 模块级 `declare const window`)
是**运行时守卫而非 global 增强**,不违反架构契约 4(契约 4 只禁 declare global
块内 DOM 全局名)。origin 等数据读取用 `location?.origin ?? ''`(不经平台门——
测试 stub location 环境仍需读取)。日志出口统一 src/log.ts(web 上报 /logs +
RN 沙盒 + Node),新增日志调用一律经它,禁第二出口(契约 7 防 lib/log 回潮)。
