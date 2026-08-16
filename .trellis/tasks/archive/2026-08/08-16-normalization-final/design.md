# 设计:契约与归属

## 文件归属表

| 文件 | desktop-node-backend | config-injection | convention-enforcement |
|---|---|---|---|
| src/store-node.ts(新,Node-only) | 创建 | — | — |
| app/lib/runner.ts | store → export let + setStore() | — | — |
| app/lib/settingsStore.ts | node 分支(注入面) | — | — |
| src/switches.ts(新) | — | 创建(核心) | — |
| app/lib/settings.ts | — | applySwitchesToEnv → setCapabilitySwitches | — |
| src/committee.ts | — | envDisabledBool 消费面改 config | — |
| src/webSearch.ts | — | webSearchEnabled 改 config | — |
| src/mcp.ts | — | mcpDisabled 改 config | — |
| src/billionsTools.ts | — | capabilities 门改 config | — |
| src/agents.ts | — | informationAnalystEnabled 经 config | — |
| src/llm.ts / billionsClient.ts / deviceCollect.ts | — | env 兜底读 → envValue 单点 | — |
| src/env.ts(新) | — | envValue 守卫单点(自 log.ts 提升) | — |
| test/architecture.test.ts(新) | — | — | 创建(静态断言) |
| tools/desktop-probe.mts(新) | 创建(接线示范) | — | — |

## 契约 1:store 注入点(desktop-node-backend)

```ts
// app/lib/runner.ts —— 现有 `export const store` 改:
export let store: StoreLike = detectPlatform() === 'web' ? new IdbStore() : new FileStore();
/** Node 桌面壳注入(Node 侧创建含 node fs 适配器的 FileStore 或 SQLite Store)。 */
export function setStore(s: StoreLike): void { store = s; }
```
- ESM live binding:`export let` 使已 import 方(useAnalysis/DataScreen)同步看到新值。
- **node:fs 禁令**:任何进入 metro 图(经 app 可达)的文件不得 import node:fs(metro 无 fs shim,静态即炸,动态同样解析失败)。node fs 适配器只在 `src/store-node.ts`(仅 probe/桌面主进程 import,不在 app 图)+ 注入传入。
- `src/store-node.ts`:`nodeFsAdapter()`(静态 node:fs 合法——Node-only 文件)+ `createNodeFileStore(baseDir)`(new FileStore(baseDir, adapter))。
- settingsStore:`createSettingsStore({ _fs })` 注入面已存在;node 分支由桌面壳传 node fs 适配(适配 expo File 面 ↔ node fs 面的薄包装,放 store-node.ts 或 settingsStore node 分支文件)。

## 契约 2:显式开关配置(config-injection)

```ts
// src/switches.ts(新)—— 替代 process.env DISABLED 隐式通道
export interface CapabilitySwitches {
  tdxMcp: boolean; webSearch: boolean; billions: boolean;
  findb: boolean; search: boolean; twitter: boolean; fetch: boolean; analyst: boolean; // 语义 = enabled
}
let current: CapabilitySwitches | null = null;
export function setCapabilitySwitches(s: CapabilitySwitches): void { current = s; }
export function getCapabilitySwitches(): CapabilitySwitches {
  if (!current) current = fromEnv();  // Node/server 无 app 层:从 process.env DISABLED 键反推(与旧语义逐位等价)
  return current;
}
```
- settings.ts:`applySwitchesToEnv` 删除,改 `setCapabilitySwitches(switchesToCapabilities(switches))`(switches 面板语义 enabled;DISABLED 旧语义取反映射)。**process.env 零写入**(AC5)。
- 消费点(全部改**惰性**读 `getCapabilitySwitches()`,禁止模块级求值):
  - committee.envDisabledBool 保留(env-only 兜底,Node 直接设 env 的场景仍工作)但委员会装配改走 deps/capabilities;
  - webSearchEnabled → `getCapabilitySwitches().webSearch`(内部;defaultSearcher 若模块级单例必须改为惰性);
  - mcpDisabled → `!getCapabilitySwitches().tdxMcp`(TDX_MCP_ENABLED 覆盖层语义保留:env 覆盖 > config > env 默认——明确优先级并单测);
  - billionsTools capability 门 → `getCapabilitySwitches().{billions,findb,...}`;
  - informationAnalystEnabled → config.analyst。
- env 兜底读取收敛:`src/env.ts` 从 log.ts 提升 `envValue(name)`(typeof process 守卫),llm/billionsClient/mcp/webSearch/deviceCollect 的兜底读迁移;优先级统一:构造注入 > envValue(> 默认)。
- 时序:App start() 与 onSettingsChange 调 setCapabilitySwitches(替换原 applySwitchesToEnv 调用点);ROLES.enabled() 惰性求值 → 运行时生效。

## 契约 3:架构静态断言(convention-enforcement)

`test/architecture.test.ts`(读源码文本断言,零依赖):
1. src/**/*.ts 无 `from 'node:` import(store-node.ts 例外白名单?——不,store-node 也用 node:fs,白名单该文件并在注释说明);
2. 无 `from 'react-native'`(src 全文件);
3. `better-sqlite3` 仅 type import(值 import 白名单 tools/probe.mts + test/*);
4. src 无 `declare global` 含 window/document/navigator/location;
5. src+app 无裸字面量 'demo:f10' / `f10:${` / `capital:${` / '600036'(metaKeys 定义除外);
6. `process.env[` 赋值仅零处(零写入);`process.env` 读取仅 src/env.ts(及 settings.ts 的 EXPO_PUBLIC 直读——白名单);
7. app/ 无 `from '../lib/log'` / `from './lib/log'` 残留。

## 验证矩阵

| 门 | 覆盖 |
|---|---|
| vitest | 全量 + store-node round-trip + switches 默认等价(env 反推 == 面板全开)+ setStore live binding + settingsStore node 分支 + architecture 断言 |
| 双 tsc | app 0 错;根 3 基线 |
| desktop-probe | `node --experimental-transform-types tools/desktop-probe.mts` 跑通 store 读改写 + settings 读改写 |
| web 冒烟 | demo/恢复/拦截(config 注入回归) |
| 模拟器 | 重启恢复(config 注入 + store let 回归);真实分析按用户选择(约 20 分钟) |

## 风险与回滚

- config-injection:委员会装配面改动最大;默认等价断言 + 全开关路径单测兜底;回滚 = revert 子 commit。
- store let 改动:live binding 在 Metro/ESM 已验证模式;模拟器冒烟兜底。
- 三子任务独立 commit;验证由父统一。
