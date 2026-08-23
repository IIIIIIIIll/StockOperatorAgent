# Design: Review Remediation

## 修复设计要点

- **F1**: `hydrate()`（store-file.ts:100-127）逐文件 try/catch，坏文件 `logError` + 跳过；原子写在 store 后端层做：store-node.ts 用 `fsWriteFile(tmp)` + `fsRename`，expo 后端用其 delete+move 或写 tmp 路径再 move（以 expo-file-system API 为准）；tmp 命名 `${path}.tmp.${pid/random}` 防并发残留。
- **F2**: main.mjs whenReady 最前 `app.requestSingleInstanceLock()`，失败 `app.quit()`；`second-instance` → 聚焦 mainWindow。
- **C2/C6**: finnhubClient.companyProfile2 与 webSearch 四处出网改接 yahooClient 导出的 `fetchWithTimeout(fetchImpl, url, init?, timeoutMs?)`；超时值对齐 40s 标准（webSearch 可用较短如 20s，与 server /web-search 的 race 一致）。
- **C3**: deviceYahooCollect 导出 `invalidateA3Cache()`；yahooClient 在 quoteSummary 二次仍 401 时调用 provider 层失效钩子——最小侵入方案：cookieProvider 升级为 `{ get, invalidate }` 或新增可选第二参数；三个注入点（deviceYahooCollect.ts:396、proxies.cjs:269、probe.mts:154）同步。
- **AL2**: toolLoop 收尾轮后检查 `final.tool_calls?.length`：非空则执行该轮工具并要求一次纯文本收尾（或直接以最后可用 content 兜底）；content 为空串时 pushReport 占位文案「（本轮无结论输出）」并 logError，不静默标 done。
- **D15**: App.tsx:269-275 条件改 `!a.running && a.hasDone`；确认 lastRun 恢复路径同步置 hasDone（analysisController restore :239-240 一带）。
- **TQ1**: analysis-controller.test.ts 加 us+key→collect 收到非空 finnhub 参数的正向用例（沿用现有注入缝）。
- **TQ2**: child.mjs 是纯 Node ESM——将 STORE_OP_VALIDATORS/checkStoreOpArgs 抽到可 import 位置（或以副本导入方式）加真值表测试于 test/。
- **TQ5**: length ≥ N + 日期单调性断言替换钉死条数/日期。
- **CI 门**: 新增 .github/workflows/ci.yml：push/PR → npm ci、npm run typecheck、npm test。
- **漂移清理**: 按评审锚点逐条改注释/两份 spec 文档；死导出直接删。

## 并行切分与契约

三组并行 implement（互不触碰同文件）：
- A 存储组: src/store-file.ts、src/store-node.ts、expo 后端、desktop/main.mjs
- B 采集组: src/finnhub/*、src/webSearch.ts、src/yahoo/deviceYahooCollect.ts、src/yahoo/yahooClient.ts、app/lib/proxies.cjs(注入点)、tools/probe.mts(注入点)
- C 编排+UI 组: src/toolLoop.ts、src/agents.ts、app/App.tsx、app/lib/analysisController.ts

测试回填与卫生组在 A–C 合入后串行（依赖修复形态定型）；冲突面仅 test/ 目录，由主会话统一收口。

## 回滚

每单元独立 commit；任一单元失败 revert 对应 commit 不影响他组。
