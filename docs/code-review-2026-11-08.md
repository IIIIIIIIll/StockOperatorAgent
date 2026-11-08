# Code Review — 2026-11-08（全仓二轮，`HEAD = 34275a3`）

> 范围：`master @ 34275a3`（v0.1.10）干净工作树，排除 `app/dist`、`desktop/dist`、
> `node_modules`、`*.exe/*.apk/*.aab`、`database/*.fs`、`data_source/**`（已归档）、
> `.scratch`、`logs`、`probe-output`、`.trellis/tasks/archive`。
> 基线（评审时实测）：`npm run typecheck` 0 error；`npx vitest run` 64 文件 /
> 794 passed / 2 skipped。CI 与 release 全部绿。

## 1. 方法

1. 母 agent 复跑机械门（typecheck / vitest / CI 状态 / HEAD check-runs）。
2. **10 个只读 reviewer 并行**，各覆盖一个 seam，完整读 10-25 个文件，对照
   `.trellis/spec/` 判定，并要求每条结论引用源码行。
3. 母 agent 手工抽查 `proxies.cjs` 无 try 的 body 读取 + 全仓
   `unhandledRejection` 缺口。
4. **6 个独立 validator 对抗式复核全部 9 条 P1**（外加 3 条与整改单冲突的结论），
   逐条判 CONFIRMED / ADJUSTED / REFUTED / UNVERIFIABLE。
5. 本轮全部原始报告：`.scratch/review-r2/*.md`（01-10 为 seam，v1-v6 为复核）。

## 2. 结论

**0 条 P0。2 条 P1（均 CONFIRMED）。** 上一轮 54 条整改中 **51 条经代码复核成立**，
3 条判为不完整/部分（CR-21、CR-28、CR-53），1 条（CR-25 的 SQLite 分支）被判
**不可达**而非缺陷。降级 9 条：wave-1 报的 9 条 P1 中有 7 条经复核降为 P2（症状
不可达、触发条件过窄或影响面被夸大）。

**修复状态（2026-11-08）：F1 + F2 已修，见第 3 节末尾的「已修」行。**
基线复核：`npm run typecheck` 0 error；`npx vitest run` 64 文件 / **799 passed** / 2 skipped
（新增 5 条回归用例；删掉修正则用例真红，见“变异验证”）。

所以：**可以发布，但两条 P1 建议在下一个 tag 前修掉**——一条是桌面端静默数据丢失，
一条是任意未认证请求可把 proxy/metro 进程打死。

## 3. P1（必须修）

### F1 · `META.json` 与 `meta.json` 在大小写不敏感盘上互相覆盖 → 桌面端静默丢数据

- 证据：`src/store-file.ts:26` `const META_FILE = 'meta.json';`，
  `:134` hydrate 用 `name === META_FILE` 精确匹配，
  `:197` / `:204` 分别写 `${ticker}.json` 与 `META_FILE`，**同一个 `baseDir`**。
- 可达性：`src/market.ts:91` 美股统一 `input.toUpperCase()`；ticker 正则
  `^[A-Za-z][A-Za-z0-9.-]{0,9}$` 放行 `META`；`src/storeOps.ts` `isTicker` 只拒
  `/[\\/]/`。桌面确实用该后端（`desktop/child.mjs:180`、`desktop/main.mjs:315`
  `path.join(userData, 'store')`），Android 也用 FileStore。
- 后果（Windows nsis / macOS dmg，卷大小写不敏感）：写 `META` 的行情会把
  `meta.json`（lastRun / F10 / demo 键）当行情文件写掉；反向则 hydrate 把合并后的
  文件当 `Record<string,string>` 解析，行情与元数据同时静默损毁。Android（ext4
  大小写敏感）不受影响。
- 修法：元数据 KV 改名 `_meta.json`（或行情文件移入 `tickers/` 子目录），hydrate
  兼容读取旧 `meta.json` 后删除；同时在 `isTicker` 保留名黑名单里挡住 `META`。
- 注意：`test/store-file.test.ts`、`test/store-durability.test.ts` 断言了字面文件名，
  需同步；hydrate 的「跳过非 `.json`」不变式必须保持。
- **已修**：`META_FILE` 改为 `_meta.json`（`_` 开头不可能由任何合法 ticker 产生），
  旧 `meta.json` 在缺少新名时被兼容读入（`hydrateMeta`，形状门把「被行情覆盖的旧
  meta」交回 ticker 分支），`enqueuePersistTicker` 对与 meta 同名的 ticker 硬拦。
  用例：`test/store-file.test.ts` 的 `F1:` / `F1 迁移:` 三条。

### F2 · `handleYahooCollect` 读 body 无 try → 客户端断开即 unhandled rejection，进程退出

- 证据：`app/lib/proxies.cjs:487-499` 函数体直接
  `const parts = []; … for await (const chunk of req) {`，**没有外层 try**；只有
  `JSON.parse`（:503）和 `new URL`（:511）被包住。四个兄弟 handler 都包了
  （:227 `handleLlmProxy`、:622 `handleTdxMcp`、:703 `handleBillionsProxy`）。
  调用点 `void handleYahooCollect(req, res);`（`app/server.mjs:235`、
  `app/metro.config.js:123`）。全仓 `grep unhandledRejection|uncaughtException`
  在 `app/` + `desktop/` **零命中**。
- 触发：Node 在客户端提前关闭时以 `ConnResetException('aborted')` 销毁
  `IncomingMessage` → async iterator reject → 未处理的 promise → Node ≥15 默认
  抛错终止进程。任意未认证的 `POST /yahoo-collect`（谎报 Content-Length 后断开）
  即可打死 server / metro。
- 修法：照兄弟 handler 用 try/catch 包住整个函数体；响应时用
  `res.headersSent ? res.destroy() : res.writeHead(502|400, …)`；另在
  `server.mjs` / `metro.config.js` 加 `process.on('unhandledRejection')` 兜底日志。
- 注意：保留 413 的 early-return（不要二次 `writeHead`）；成功路径的
  `collectingYahoo` 释放与 `clearTimeout` 不能丢；`test/proxies.test.ts:685-715`
  逐字断言了 400/429/504 分支。
- **已修**：body 读取循环包进 try/catch（`res.headersSent || req.destroyed` → destroy，
  否则 400 JSON），并在 `app/server.mjs`（`isMain` 内）与 `app/metro.config.js`
  增加 `process.on('unhandledRejection')` 记录兜底。用例：`test/proxies.test.ts` 的
  `/yahoo-collect 断连兜底(S9-1)` 两条。
- **变异验证**：把新增的 try/catch 去掉重跑，两条用例双双失败于
  `promise rejected "Error: aborted (ECONNRESET)"`；恢复后 49/49 绿。

## 4. 复核后降级（P1 → P2）

| 原 id | 判定 | 真实情况 | 现级别 |
|---|---|---|---|
| S1-1 / S10-2 | ADJUSTED | CR-21：degraded 报告确实在 `if (report.degraded)` 之前就 `saveLastRun`（`analysisController.ts:911`）+ `recordRun`（:917）；但「重启后显示 ✓ 分析完成」**不可达**——`App.tsx:382` 的门要求 `progress.length > 0`，而 restore 只写 report 事件 | P2 |
| S3-2 | CONFIRMED | CR-28：`setMeta` → 队列微任务，同 tick 读 `getLastPersistError` 永不可能看到本次失败；成功写入还会清标志。但 `recordRun` 失败会经 `historyError` 露出，非完全静默 | P2 |
| S2-1 | ADJUSTED | 同日 `skipDaily` 时 `prev_close`/`amount`/`amplitude` 会退回 `chartPreviousClose`（≈5 交易日陈旧）；`change_percent` 走 `regularMarketChangePercent`，不受影响。且该 minor 早已在 `08-25-review-findings-audit` 记录并接受 | P2 |
| S9-1 → 保留 | CONFIRMED | 见 F2 | **P1** |
| S3-1 → 保留 | CONFIRMED | 见 F1 | **P1** |
| S4-1 | ADJUSTED | web 端 2 序列图（净利润+每股收益）三档 `PANE_STRETCH` 算出的 `paneTops=[0,100,200]` 与实际两个 pane（各≈136px）不符，图例错位≈36px 落进 pane 0。无崩溃、无数据错误 | P2 |
| S5-1 | ADJUSTED | `analysisController.ts:290` 的 `list()` 后无 seq 门，删除时在途刷新会把行恢复；恢复源是陈旧快照而非 state 保留。需人类多点时序，下次刷新自愈 | P2 |
| S6-1 | ADJUSTED | `versionCode: 3` 无人强制递增（gate 只比三个 version，测试只 `toBeGreaterThan(0)`），但 Play 上传时**响亮失败**，非静默 | P2 |
| S8-1 / S9-3 | ADJUSTED | metro dev 入口缺 `sec-fetch-site` / Host / token 门（`metro.config.js:89-109`，`origin` 缺失即放行）。但 `/logs` 是 POST 会被 Origin 门拦；所有 proxy 响应不发 `Access-Control-Allow-Origin`，故是「盲请求伪造／额度燃烧」，非数据外泄 | P2 |
| S8-6 | ADJUSTED | release manifest 未声明 `usesCleartextTraffic`/`networkSecurityConfig` → `http://` 局域网 LLM 在 APK 上被系统拦；实际在**保存时**就失败，但只显示裸 `Network request failed`，隐私政策却宣传支持本地网关 | P2 |

## 5. 判为不成立

| 原 id | 判定 | 理由 |
|---|---|---|
| S10-1 / S3-3 | REFUTED（不可达） | `src/store.ts:43` 确实还是 `volume INTEGER NOT NULL` 且裸绑 `b.volume`，但 `better-sqlite3` 是 **devDependency**，唯一非测试引用是 `tools/probe.mts:203`；桌面发 FileStore、web 发 IdbStore、Android 发 FileStore，`npm ci --omit=dev` 后 `Store` 根本装不进去 |

补记（P3 潜在项）：schema 与 `DailyBar.volume: number \| null` 的注释仍不一致，只影响本地
`tools/probe.mts`，不构成发布缺陷；若将来把 SQLite 后端接进产品，需同时改列定义与
`getDatas` 的 `volume: number` 断言。

## 6. P2 待办（wave-1 原始，未逐条复核）

**编排 / 事件**：degraded 终态复用 `'retry'` 导致 chip 永远显示「重试中」(S1-2)；
`agents.ts:67` `bindTools` 失败静默吞掉 (S1-3)；`events.ts:93` 订阅者异常静默吞掉
(S1-4)；`pipeline.ts:273` 与 `mcp.ts:232` 同一句占位文案双份字面量 (S1-5)。

**数据采集**：`WebCollectResult` 丢掉了已解析的 `ticker`，HK 候选顺序变化时后续
store/runner 读错键 (S2-2)；`snapshotFromMeta` 读的 4 个 `regularMarketDay*` 键与
已验证 meta 形状不符，夹具跟着错，52 周高低链只剩最后一档活 (S2-3)。

**存储**：`loadLastRun` 只校验 `Array.isArray(opinions)` 就 `as Opinion[]`，建议复用
`isOpinionList` (S3-4)；SQLite 无 `user_version` / 迁移路径 (S3-5)。

**金融 / 图表**：RSI 在 `avgGain=0 && avgLoss=0`（全平）时返回 100「超买」而非 N/A
(S4-2)；`chartData.ts:80-97` 只有两条序列做了排序 (S4-3)；`DataScreen.tsx:82`
`computeAll` 不传 `shares`，换手率列永远空且与 `turnoverPct` 形成两套公式 (S4-4)。

**App 运行时**：`bootstrap` 后半段在 try 外且被 `void` 调用，抛错即静默半启动
(S5-2)；浏览历史会改写市场下拉（`App.tsx:76`），下一次分析用错市场 (S5-3)；
全 `app/` 无 `BackHandler`，安卓返回键开着抽屉直接退到后台 (S5-4)；看门狗超时后
迟到的 `done` 会留下「已中止」+「已完成」并存 (S5-5)。

**构建 / 桌面**：settings-save 先报成功再持久化，child 的失败回包无 id 无法 reject
(S6-2)；release 无「打包产物启动烟测」，`if-no-files-found: ignore` 允许零产物绿
(S6-3)；CI cache 路径漏 `desktop/package-lock.json` 且从不 `npm ci` desktop (S6-4)；
退出时队列内写入直接丢弃（无 drain）(S6-5)。

**测试**：看门狗 reset 用例 270s < 300s 实际超时，删掉 rearm 仍绿 (S7-1)；
`live.integration` 的 `length - 250` 比对永久红 (S7-2)；`analysis-controller-history`
里死代码 + 先使用后声明 (S7-3)；`architecture.test.ts` 文件收集失败即全绿 (S7-4)；
`server-static.test.ts` 在有真实 `app/dist` 的机器上自跳过 (S7-5)。

**安全**：proxy 回显上游 `content-type`，可能把上游 HTML 渲染在同源（那里放着
API key 的 localStorage）(S8-3)；无 Dependabot、`npm audit` 因镜像 advisory 端点
不可用而无法跑 (S8-4)；release 两个 build job 的 checkout 未设
`persist-credentials: false` (S8-5)。

**代理 / 原生**：流式转发无 backpressure，慢客户端会把整段 SSE 缓冲进内存 (S9-2)；
释放包密钥扫描只查 `.env` 值 (S9-4)；`KeepAliveService.start()` 重复调用不续期
30 分钟唤醒锁，超时后静默失保 (S9-5)。

**整改残留**：CR-03 的代数门在 `closeRun()` 的早退之后才自增，且陈旧 load 的
`finally` 会把新请求的 `historyLoading` 清掉 (S10-3)。

## 7. 复核确认无问题的部分

- **数学**：MA/EMA/MACD/KDJ/BOLL/ATR/VOL_RATIO 与 Python 夹具 1e-6 对齐；60 日窗口
  恰为 `bars[len-61].close`；CR-01 单季还原 + 88-93 天相邻季度门；`qfqAdjust`
  对 5835 根 bar 全 OHLC 对齐。
- **存储耐久**：同目录 tmp+rename、写队列串行且 `close()` 前 drain、hydrate 逐文件
  容错、归档索引与正文对账。
- **Electron 硬化**：`contextIsolation`+`sandbox`+`nodeIntegration:false`、
  `will-navigate` 拦截、window-open 拒绝、5 个 IPC op 白名单带路径检查、CSP 单源。
- **代理安全**：`pinPublicHost` 解析全部地址判公网（含 IPv6 展开与 fake-IP 例外）、
  逐跳重校验、跨源剥离 `Authorization`、1MB/64KB body 上限、`DIST + path.sep`
  路径锚定、`/logs` CRLF 清洗。
- **供应链**：workflow 全部 action SHA 钉死，三份 lockfile 均带 `integrity`。
- **设计偏离但有意**：`app/tsconfig.json` 内联替代 `extends expo/tsconfig.base`
  （CR-04），`test/build-config.test.ts` 守护。
