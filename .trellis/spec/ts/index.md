---
description: TS 层(web/RN/Node 共享 src/ + app/ + 桌面/CI)入口——仓库结构、开发前检查、架构断言、主题路由
paths:
  - src/**
  - app/**
  - test/**
  - tools/**
---

# TS 层约定(`src/`/`app/`/`desktop/`/`tools/`)

> **状态(2026-08-19)**:TS 是**最终唯一实现**。Python 业务代码已分域删除
> (08-14-phaseout-e-py-deletion:E1 死代码面 → E2 数据源/存储/结构面 → E3
> 工具/agent 面 → E4 编排/UI 面 → E5 收尾),仓库已无 `main.py`/`core/`/
> `agents/`/`data_source/`/`data_storage/`/`data_structure/`/`utils/` 业务代码。
> 磁盘残留仅 **gitignored 缓存/数据文件**:`data_source/chinese_mainland/
> tdx/vendor/**/__pycache__/*.pyc`(零消费)与 `database/china_stock_data.fs*`
> (325MB,08-12 生成)——不入库、不参与构建,无需处理。`test/fixtures/` 为 TS
> 测试活跃数据(9+ 测试文件消费)。Python 侧旧分层 spec(core/data_source/
> data_storage/data_structure)作为历史归档保留。

## 仓库结构

- `src/` — 平台中立 TS 业务层(零 RN 依赖):events/agents/committee/pipeline/
  retry/toolLoop/progress/store(+4 持久化族)/gates/collector/metaKeys/log/env/
  switches/lastRun/chartLayout/chartData/indicators/tdx/*/billionsClient/
  billionsTools/mcp/webSearch/llm/prompt/adjust/overview/reports/f10/format。
- `app/` — Expo web/RN 客户端:App.tsx(纯渲染壳)+ hooks/useAnalysis.ts +
  components/ + screens/ + lib/{runner,proxies,logs-server,settings,
  settingsStore,desktopBridge,deviceBridge,collectorSelection,polyfill,shims}。
- `desktop/` — Electron 壳(main.mjs/preload.cjs/child.mjs,独立 package)。
- `tools/*.mts` — Node 探针/构建脚本;`test/*.test.ts` — vitest 套件(含
  architecture.test.ts 七条架构断言)。

## 开发前检查(动 TS 层代码前)

1. 改 src 模块 → 不违反 `test/architecture.test.ts` 七条断言(下表)。
2. 新增日志调用 → 一律经 `src/log.ts`(全端统一出口,禁第二出口)。
3. 新增 meta 键/演示 ticker → 进 `src/metaKeys.ts` 单源,禁裸字面量。
4. 读 env → 经 `src/env.ts` `envValue`;写 env → 禁止;EXPO_PUBLIC_* 仅直接成员访问。
5. 平台判定 → `src/log.ts` `detectPlatform()`,不手写 typeof 链。
6. 涉及图表/采集/桌面/CI → 先读对应主题文件(路由表)。

## 架构断言(test/architecture.test.ts,7 条)

| # | 契约 | 白名单 |
|---|------|--------|
| 1 | src 禁 node: import(静态/动态) | 仅 src/store-node.ts |
| 2 | src 禁 react-native import(平台纯净) | 无 |
| 3 | better-sqlite3 仅 type import;Store 值 import 禁 | store.ts + tools/probe.mts + test/* |
| 4 | src 无 declare global 含 DOM 全局名 | 自定义名(如 __SOA_DEBUG)允许 |
| 5 | src+app 禁 meta 键裸字面量 | metaKeys.ts + app/data/demo.json |
| 6 | process.env 零写入;读取仅 env.ts + EXPO_PUBLIC_* 直读 | env.ts + 直读白名单 |
| 7 | app 禁 lib/log 相对 import 回潮 | 无(日志统一 src/log.ts) |

## 主题文件路由

| 主题 | 文件 | 何时读 |
|------|------|--------|
| 事件协议/流式/重试/同源代理 | [events-streaming.md](./events-streaming.md) | 改 events/progress/retry/pipeline/proxies/logs-server |
| 存储/持久化/freshness/上次缓存 | [stores.md](./stores.md) | 改 store*/lastRun/metaKeys/runner/settingsStore |
| env/开关/密钥(EXPO_PUBLIC_*) | [env-switches.md](./env-switches.md) | 改 env/switches/settings/log 平台判定 |
| LLM agent/工具循环/亿信/mcp/overview | [agents-tools.md](./agents-tools.md) | 改 agents/committee/toolLoop/llm/mcp/webSearch/billions/overview |
| 图表/UI 编排/安全区 | [chart-ui.md](./chart-ui.md) | 改 chartData/chartLayout/组件/useAnalysis/App |
| TDX 采集链/qfq/F10/门控 | [tdx-data.md](./tdx-data.md) | 改 tdx/*/adjust/collector/gates/deviceBridge |
| 港股/美股数据链(Yahoo/Finnhub/市场模型) | [hk-us-data.md](./hk-us-data.md) | 改 market.ts/yahoo/*/finnhub/collectorSelection/采集代理/单位货币分支 |
| RN/Hermes 运行时兼容 | [rn-runtime.md](./rn-runtime.md) | 改 polyfill/shim 族/metro 边界 |
| app 手工 E2E 验证(web/安卓) | [web-e2e.md](./web-e2e.md) | 构建/托管 app、浏览器驱动验证、demo 触发/`__soa` 钩子、安卓冒烟 |
| 探针与构建脚本 | [tools.md](./tools.md) | 改 tools/* |

## 全局约定

- **双 tsconfig**:根 `lib=["ES2024","DOM"]`(fetch/AbortSignal 等 web 平台
  类型取 DOM 单源;@types/node 26.2 web-globals AbortSignal 形状错位曾触发
  TS 原生编译器误报——模块级 `typeof` 守卫声明不受影响,08-16 实证)。
- **双 TS 大版本**:根 `typescript ^7.0.2`(web/node 层,TS 原生编译器);
  app 层 `~6.0.3` 为 Expo SDK 57 模板钉版,RN/metro 工具链需与 SDK 匹配,
  勿升主版本——两套 tsconfig 互不兼容,故 CI 的 app 编译门由 release.yml
  expo export 兜底(见 ci.yml 顶部 R5 注释)。
- **CJS 边界**:proxies.cjs / logs-server.cjs 用 CJS(metro.config.js 是 CJS,
  server.mjs 是 ESM,两者都能 require);proxies.cjs `require('../../src/*.ts')`
  依赖 Node `--experimental-strip-types`(node ≥23.6 默认开启)。
- **持久化一句话**:web 生产 = IndexedDB,RN = expo-file-system 文件,Node =
  better-sqlite3 / node:fs 适配器;四族共用 StoreLike 同步契约(见
  [stores.md](./stores.md))。
