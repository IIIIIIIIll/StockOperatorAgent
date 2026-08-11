# TS 统一日志落盘 —— 实施计划

## 前置

- [ ] P1 `cd ts/app && npx expo install expo-file-system`(SDK 57 匹配版本;
      确认 package.json 增依赖)

## 实施步骤

1. **新建 `ts/src/log.ts`**(上移升级):
   - 环境判定探针(web / RN / Node 三分支,见 design)
   - console transport 保持 `[soa <level>]` 格式 + `__SOA_DEBUG` 门控
   - 上报 transport(fire-and-forget fetch,失败静默;web 同源 `/logs`,
     RN 走 `EXPO_PUBLIC_LOG_ENDPOINT`)
   - RN 沙盒 transport(动态 import expo-file-system,`Paths.document/soa-logs.log`,
     append + 5MB 轮转,失败静默降级 console)
   - `NODE_ENV==='test'` / `SOA_LOG_FILE='0'` → 不写文件
2. **`ts/app/lib/log.ts`** 改为重导出 `../../src/log.ts`(既有 import 零改动)。
3. **`ts/app/server.mjs`** 新增 `POST /logs` 端点(类型校验 + 4KB 截断 +
   `<repo>/logs/soa-ts.log` append + 5MB 轮转;`SOA_LOG_DIR` 可覆盖)。
4. **`ts/app/metro.config.js`** 中间件同构加 `POST /logs`(dev 模式)。
5. **`ts/src/retry.ts`**:退避前 `warn('LLM invoke attempt {n} failed with
   {Type}; retrying in {s}s')`(对齐 Python before_sleep;业务错误直抛不变)。
6. **测试**:
   - `ts/test/log.test.ts`(新):环境分支判定、上报 payload 形状、RN 沙盒
     transport 注入(fake file API)、`NODE_ENV=test` 不写文件;
   - `ts/test/retry.test.ts`(改):断言退避期间 warn 已发出(注入可恢复错误);
   - server 端点:vitest 下用注入 tmp 日志路径验证 append + 轮转(或 bash
     curl 实测,二选一,实现时定)。

## 验证

- [ ] V1 `cd ts && npx vitest run` 全绿(新增 + 既有)
- [ ] V2 `cd ts/app && npm run serve`,`curl -X POST localhost:8090/logs
      -H 'Content-Type: application/json' -d '{"level":"error","message":"smoke","platform":"test"}'`
      → `logs/soa-ts.log` 出现 `… | ERROR | [soa] smoke (platform:test)`;重复写
      触轮转(临时小阈值验证后还原)
- [ ] V3 文件超阈值 → `.1` 轮转文件存在
- [ ] V4 Python 全量回归 `pytest -q`(停 Streamlit)0 新增失败
- [ ] V5 `npm run web` 构建 + server 起后,浏览器跑一次真实失败路径
      (或注入) → `logs/soa-ts.log` 有 web 平台记录;server 未起时 console 照常
      (降级验证)

## 收尾

- [ ] spec 更新:`trellis-update-spec`(core/或 error-handling:TS 日志约定——
      统一 src/log.ts、上报降级不打断、落盘位置)
- [ ] commit + `/trellis:finish-work`

## 风险点 / 回滚

- expo-file-system 打包兼容(web/Node 构建) → 步骤 1 后先跑一次 `npm run web`
  构建确认;回滚 = revert ts/ 侧三文件 + 移除依赖,Python 零接触。
