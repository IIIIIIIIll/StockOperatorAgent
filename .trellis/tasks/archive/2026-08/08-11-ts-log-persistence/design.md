# TS 统一日志落盘 —— 技术设计

## 架构总览

单一日志 API 上移为 `ts/src/log.ts`(现 `app/lib/log.ts` 的唯一出口升级),
环境感知 transport,按运行平台自动路由;文件落盘只发生在有 fs 的位置
(Node server 汇聚 / RN 沙盒),浏览器经上报汇聚到 server 同一份文件。

```
web  : log.info/warn/error → console + POST 同源 /logs ─→ server fs 写 logs/soa-ts.log(轮转)
RN   :                    → console + File(Paths.document, soa-logs.log) 沙盒
                           + EXPO_PUBLIC_LOG_ENDPOINT 配置时 POST 上报(同 server 文件)
Node : server 端点(/logs)原生 fs 落盘(不经客户端分支);vitest 不写文件
```

## 环境判定(src/log.ts,无 react-native import,纯全局探针)

| 分支 | 探针 | transport |
|---|---|---|
| web 浏览器 | `typeof window !== 'undefined' && typeof document !== 'undefined'` | console + 同源 `/logs` 上报 |
| RN 真机/模拟器 | `typeof navigator !== 'undefined' && navigator.product === 'ReactNative'` | console + expo-file-system 沙盒文件 + 可选上报 |
| Node(vitest/tools) | `typeof process !== 'undefined' && !!process.versions?.node`(且非上两者) | console;`NODE_ENV==='test'` 或 `SOA_LOG_FILE='0'` → 不写文件 |

> 不静态 `import 'react-native'`/`'node:fs'`/`'expo-file-system'`:
> 三者任一静态导入都会污染其他平台打包。expo-file-system 仅 RN 分支
> 动态 `await import('expo-file-system')`(模块级惰性初始化一次)。

## transport 契约(src/log.ts)

- **console**:格式 `[soa <level>] <message>` 保持逐字节不变;`debug` 级
  `__SOA_DEBUG==='1'` 门控保留(App.tsx/settings.ts 既有调用零变化)。
- **上报**:fire-and-forget,`fetch(endpoint, {method:'POST', keepalive:true,
  body: JSON.stringify({ts, level, message, platform})})`,失败 catch 静默,
  **不打断业务**(error-handling 降级风格)。web endpoint 默认
  `${location.origin}/logs`;RN endpoint = `process.env.EXPO_PUBLIC_LOG_ENDPOINT`
  (空/未设 → 不上报)。上报节流:同帧多日志合并为单次?——不,保持逐条,
  量小(App 层日志低频)。
- **RN 沙盒文件**:`new File(Paths.document, 'soa-logs.log')`,逐条 append
  (new API:`file.create()` + `file.write()` 读改写;失败 catch 静默降级 console)。
  大小 ≥5MB → rename `.1` 再开新文件(对齐 server 轮转语义)。

## 服务端汇聚端点(dev metro + prod server.mjs 双份,对齐 /llm-proxy 先例)

- `POST /logs`:读 body(≤64KB,超限 413),`{ts, level, message, platform}`
  类型校验(level ∈ info|warn|error|debug,message 为 string,截断 4KB),
  非法 → 400 `{error}`;合法 → append 到日志文件。
- 日志文件:默认 `<repo>/logs/soa-ts.log`(Python `logs/stock_operator_agent.log`
  并列;server 进程 cwd=ts/app → `path.join(process.cwd(), '..', 'logs')`,
  `SOA_LOG_DIR` 可覆盖);行格式
  `2026-08-11 12:00:00 | INFO | [soa] <message> (platform:web)`。
- 轮转:append 前 stat,≥5MB → rename `soa-ts.log.1` 再写。
- 无鉴权(同源 + 局域网场景;日志不含密钥明文,settings.ts 已 mask)。

## 兼容与迁移

- `app/lib/log.ts` 改为 `export { log, info, warn, error, debug } from '../../src/log.ts'`
  ——App.tsx / settings.ts 的 import 与调用点零改动。
- `retry.ts`(同 src/)`import { warn } from './log.ts'`;每次退避前
  `warn('LLM invoke attempt {n} failed with {Type}; retrying in {s}s')`,
  对齐 Python `retry.py` before_sleep 语义;业务错误仍直抛零延迟(不碰判定)。
- Node 分支(vitest)不写文件:测试不污染仓库 logs/。

## 风险与权衡

- **新增依赖 expo-file-system**(SDK 57 需 `npx expo install expo-file-system`
  匹配版本)——web/Node 构建安全靠"不静态导入 + 环境短路";RN 侧验证在
  expo web 与真机构建各跑一次。
- **双份 server 端点实现**(metro.config.js + server.mjs)漂移风险——既有
  `/llm-proxy` 双份先例,接受;两端点共享同一行格式与轮转逻辑(抽私有 helper
  或注释互指,实现时定)。
- 日志无鉴权/无加密:同源 + 局域网内网场景;上报内容与 console 相同,不含密钥。
- 高频率日志(debug 级)默认关,不产生上报风暴。

## 回滚

- 全部改动局限于 ts/ 侧:log.ts 上移 + 端点 + retry warn;任一问题 revert
  ts/ 侧三个文件即可,Python 侧零接触。
