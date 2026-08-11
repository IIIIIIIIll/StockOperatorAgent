# TS 侧统一日志落盘 + LLM 调用可见度

## 目标与用户价值

TS 侧(web 浏览器 + RN app)agent 运行偶发「回复完全出不来」时无法事后取证:
当前唯一日志模块 `ts/app/lib/log.ts` 只输出 console,不落盘、无轮转,与 Python
侧 `loguru` + `logs/stock_operator_agent.log` 不对等。目标:统一日志 API 上移
`ts/src/log.ts`、环境感知 transport(web 上报 / RN 沙盒 / server 汇聚),并补
LLM 重试可见度(对齐 Python `retry.py` before_sleep),让偶发失败可翻日志定位。

## 背景与事实（证据）

- **日志现状**:`log.ts` 输出仅 console(`[soa <level>]`,debug 级 `__SOA_DEBUG`
  门控);消费者 App.tsx(分析/采集失败)、settings.ts(LLM 可达性,密钥已 mask)。
  `ts/src/` 业务层**零日志**(retry.ts 退避静默、events.ts 无 console)——结构性
  缺口:`log.ts` 在 app 层,依赖方向 app→src,业务层无法使用。
- **运行模式**:web dev = metro 中间件、web prod = server.mjs(8090),均有
  `/llm-proxy` 端点先例;RN 真机 LLM 直连(无 server 依赖);agent 图/LLM 调用
  在客户端执行,**server 只跑代理**,是唯一跨模式确定的落盘汇聚点。
- **三方库调研(2026-08-11 检索)**:react-native-logs 无官方 web 支持(本项目
  web 是主要形态);LogLayer(2025 新库)统一 API 但底层按端插拔,浏览器端仍只有
  console/远程端点——**无库能让浏览器写文件**(平台物理约束)。用户拍板:不引
  三方库,自研 `log.ts` 升级(零依赖、对齐 house style、server 汇聚端点任何方案
  都得自建)。
- **RN 沙盒**:expo-file-system **未安装**(app 依赖清单核实),需
  `npx expo install expo-file-system`(SDK 57)。用户拍板:RN 真机沙盒文件落盘,
  无 server 也可查。
- **重试现状**:`ts/src/retry.ts` 429/5xx/连接/超时退避 ×3(1s 起 8s 上限),
  业务错误直抛;退避过程零日志。Python 侧有 before_sleep warn 先例。

## 需求

- **R1 统一日志 API**:新建 `ts/src/log.ts`(环境判定 + 多 transport),web/RN/
  Node/vitest 全端共用;`app/lib/log.ts` 改为重导出,既有 import 零改动。
- **R2 环境 transport**:
  - web:console + POST 同源 `/logs`(fire-and-forget,失败静默不打断业务);
  - RN:console + expo-file-system 沙盒文件(`Paths.document/soa-logs.log`,
    append + 5MB 轮转)+ `EXPO_PUBLIC_LOG_ENDPOINT` 配置时上报;
  - Node:console;vitest(`NODE_ENV==='test'`)不写文件。
- **R3 server 汇聚端点**:server.mjs + metro.config.js 各加 `POST /logs`
  (类型校验 + 4KB 截断),写 `<repo>/logs/soa-ts.log`(Python logs/ 并列,
  `SOA_LOG_DIR` 可覆盖),5MB 轮转。
- **R4 重试可见度**:`retry.ts` 每次退避前 warn(attempt/异常类型/下次间隔),
  对齐 Python before_sleep;业务错误直抛零延迟不变。

## 明确不做（Out of Scope）

- Python 侧日志改动(已有 loguru 落盘)。
- 日志鉴权/加密(同源 + 局域网场景;日志不含密钥明文)。
- 日志 UI(设置面板展示沙盒路径、在线查看日志页)。
- LLM 调用采样/性能追踪。

## Acceptance Criteria

- [x] **AC1** `curl -X POST 'localhost:8090/logs' -d '{"level":"error","message":"smoke","platform":"test"}'`
      → `logs/soa-ts.log` 出现 `… | ERROR | [soa] smoke (platform:test)`;文件
      ≥5MB 轮转为 `soa-ts.log.1`(dev metro 与 prod server.mjs 两端点均验证)。
- [x] **AC2** web 端真实失败路径(`logError`)上报后 logs/ 可查;server 未起时
      console 照常、业务不中断(降级验证)。
- [x] **AC3** RN 真机/模拟器:沙盒文件 `soa-logs.log` 落盘(无 server 也可查);
      配 `EXPO_PUBLIC_LOG_ENDPOINT` 时同时上报。
- [x] **AC4** `retry.ts` 重试发生时 warn 退避记录可见(attempt/间隔);业务错误
      仍直抛零延迟。
- [x] **AC5** `app/lib/log.ts` 重导出后既有调用零改动,console 格式
      `[soa <level>]` 逐字节不变。
- [x] **AC6** `cd ts && npx vitest run` 全绿(新增 log/retry 用例);Python
      `pytest -q`(停 Streamlit)0 新增失败。

## 测试影响

- 新增 `ts/test/log.test.ts`:环境分支判定、上报 payload 形状、RN 沙盒
  transport 注入(fake file API)、`NODE_ENV=test` 不写文件。
- `ts/test/retry.test.ts` 增补:退避期间 warn 已发出(注入可恢复错误)。
- server 端点:注入 tmp 日志路径验证 append + 轮转。

## 验收结果（2026-08-11）

- AC1:curl 冒烟 200/400/400 + 文件行 `2026-08-11 12:00:00 | ERROR | [soa] smoke (platform:web)` 逐字节;轮转由 log-server.test.ts 覆盖。
- AC2:web 上报链路冒烟通过;server 未起时客户端 catch 静默降级(单测覆盖)。
- AC3:RN 沙盒 transport 用 fake file API 单测覆盖(设备验证 deferred,log.test.ts 18 用例)。
- AC4:retry.test.ts 增补退避 warn 断言,业务错误直抛不变。
- AC5:app/lib/log.ts 重导出,既有调用零改动;console 格式逐字节。
- AC6:vitest 全量 21 files/157 passed;Python pytest 583 passed/19 skipped/0 failed。
- 额外:`expo export --platform web` 构建通过(动态 import 打包兼容);tsc 零错误;commit 1fc7828。
