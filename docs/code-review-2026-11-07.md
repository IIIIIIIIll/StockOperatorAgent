# Code Review — 2026-11-07（全仓，`HEAD = cbc77a6`）

> 修复状态（2026-11-07）：53/54 已修并分 6 批提交（`cc2450c`→`04c684b`）；
> CR-25 暂缓（`DailyBar.volume` 可空需贯通四族 store 与图表）。逐条状态见
> `docs/review-2026-11-07-remediation.md`。基线：typecheck 0 error，
> vitest 782 passed / 2 skipped。

> 状态：**已完成独立验证**。9 个并行 reviewer + 5 个独立 validator。
> 验证结论：**2 条 P0、5 条 P1、47 条 P2**；原始 11 条 P1 中 4 条降级、1 条升为 P0；
> 1 条被源码证伪并改写，1 条部分证伪降为备注。下文每条 P0/P1 都带「验证」行，
> P2 表格带验证列。

---

## 1. 范围与方法

评审对象：git `HEAD cbc77a6` 的干净工作树（未提交改动为零）。

排除项：`app/dist`、`desktop/dist`、`node_modules`、`*.exe/*.apk/*.aab`、
`database/*.fs`（二进制）、`data_source/**/__pycache__`（已归档 Python）、
`.scratch`、`logs`、`probe-output`、`.trellis/tasks/archive`。

方法：

1. 母 agent 跑机械门：根/app 双 `tsc`、`vitest`、`--noUnusedLocals`、秘密扫描、
   lockfile 与依赖检查。
2. 9 个只读 reviewer 并行，各覆盖一个 seam（下表），每人完整读 8-18 个文件，
   对照 `.trellis/spec/` 判定标准违反，并抽查上一轮评审（`docs/code-review-2026-11-05.md`
   R-01..R-35）的已关闭项。
3. 母 agent 抽查 14 条关键结论的源码证据。
4. 5 个独立 validator 对抗式复核：逐条重开源码，判 CONFIRMED / ADJUSTED /
   REFUTED / UNVERIFIABLE，并检查重复、误标「新发现」、严重度夸大。

### 覆盖矩阵

| # | Seam | 主要文件 |
|---|------|----------|
| 1 | 核心编排 / LLM 管道 | `src/agents.ts`, `toolLoop.ts`, `pipeline.ts`, `committee.ts`, `events.ts`, `llm.ts`, `retry.ts`, `prompt.ts`, `mcp.ts`, `gates.ts`, `switches.ts`, `env.ts`, `progress.ts`, `metaKeys.ts` |
| 2 | 数据采集 / 外部客户端 | `src/tdx/*`, `src/yahoo/*`, `src/finnhub/*`, `webSearch.ts`, `webCollect.ts`, `billionsClient.ts`, `billionsTools.ts`, `f10.ts`, `collector.ts`, `overview.ts` |
| 3 | 存储 / 持久化 | `src/store*.ts`, `storeOps.ts`, `idbUtil.ts`, `runHistory.ts`, `lastRun.ts`, `app/lib/runArchive.ts`, `app/lib/settingsStore.ts` |
| 4 | 金融计算 / 图表数据 | `src/indicators.ts`, `adjust.ts`, `tdx/xdxr.ts`, `market.ts`, `chartData.ts`, `chartLayout.ts`, `f10.ts`, `reports.ts`, `format.ts`, `overview.ts`, `app/components/IndicatorChart.tsx`, `FinancialTrendChart.tsx`, `app/lib/chartHtml.ts` |
| 5 | App UI / 运行时 | `app/App.tsx`, `screens/*`, `hooks/*`, `components/*`, `lib/analysisController.ts`, `runner.ts`, `settings.ts`, `deviceBridge.ts`, `desktopBridge.ts`, shims, `modules/soa-keepalive` |
| 6 | 桌面壳 / 构建 / 发布 / 工具 | `desktop/{main,preload,child}`, `electron-builder.yml`, `tools/*`, `.github/workflows/*`, 根配置 |
| 7 | 测试质量 / spec 符合度 / 文档 | `test/*`（61 文件）, `vitest.config.ts`, `.trellis/spec/ts/*`, `README.md`, `docs/*` |
| 8 | 安全 / 密钥 / 供应链 / 隐私 | 三份 lockfile、workflows、隐私政策、settings 流、Electron/WebView、Android 权限 |
| 9 | 生产同源代理 / Android 原生层 | `app/server.mjs`, `app/lib/{proxies,logs-server}.cjs`, `app/scripts/build-release-clean.sh`, `app/android/*` |

## 2. 基线（评审前后一致）

| 门 | 结果 |
|----|------|
| `npm run typecheck`（根，TS 7） | **0 error** |
| `cd app && npx tsc --noEmit`（app，TS 6） | **0 error**（CI 未跑此门） |
| `npx vitest run` | **61 文件 / 755 passed / 2 skipped**，2.75s |
| `tsc --noUnusedLocals --noUnusedParameters` | **12 处**（见 CR-63） |
| `git grep` TODO/FIXME/`@ts-ignore`/`any` | 0 命中 |
| 秘密扫描（工作树 + git 历史） | 无真实密钥入库；仅测试夹具 `sk-1234567890abcdef` |
| `npm audit` | **不可用**：root/app registry 为 `registry.npmmirror.com`，advisory 端点 404；desktop 0 漏洞 |

## 3. 结论摘要

| 严重度 | 数量 | 主题 |
|--------|------|------|
| **P0** | **2** | 港美股「60日涨跌幅」= 全历史涨幅；业绩 QoQ 用年报累计值减一季报累计值，落库不可自愈 |
| **P1** | **5** | 代理 token 缺失、Android versionCode/versionName、隐私政策与权限矛盾、云备份泄露明文密钥、跨 host 重定向泄 Authorization |
| **P2** | **47** | 见 §6，按区域分组，全部带验证结论 |

验证对原始结论的影响：4 条 P1 降为 P2（CR-03/04/09/10），1 条 P1 升为 P0（CR-01），
1 条 P2 被证伪并改写（CR-28），1 条 P2 部分证伪降为备注（CR-61）。

---

## 4. P0（用户会看到错误数据）

### CR-00 · P0 · 港美股概览的「60日」涨跌幅实际是上市以来累计涨幅
- **位置**：`src/yahoo/deviceYahooCollect.ts:371-382`；契约在 `src/yahoo/composeYahooOverview.ts:32-35`
- **证据**：
  ```ts
  const bars = skipDaily ? [] : await fetchFullDailyBars(symbol, …);  // 全历史分页
  const firstClose = bars.length ? bars[0].close : undefined;        // ← 上市首日
  const lastClose  = bars.length ? bars[bars.length - 1].close : undefined;
  composeYahooOverview(meta, composed ?? {}, { firstClose, lastClose });
  ```
  `composeYahooOverview` 注释写「**60 日窗口**首根收盘」；CN 侧正确实现是
  `src/overview.ts:105` `bars.length > 60 ? bars[bars.length - 61].close : NaN`。
- **影响**：`app/screens/DataScreen.tsx:70` 用 `...(stock.overview)` 覆盖本地重算值，
  `:101` 渲染为「60日」。HK/US 采集后变成 10 年累计涨幅（AAPL 数百 %）。
  `skipDaily` 时空 bars → NaN → `mergeOverview` 保留旧错值；web/RN/探针三端共用同一函数。
- **最小修复**：`const w = bars.slice(-61); firstClose: w[0]?.close, lastClose: w.at(-1)?.close`；
  补「首末 bar 取自最后 61 根」断言（现有用例只喂 2 根 bar，测不出）。
- **来源**：data seam。**新发现**。
- **验证**：**CONFIRMED（P0）**。影响面**收窄**：`change_percent_60d` 全仓唯一消费点是
  `DataScreen.tsx:101`，不进 LLM 上下文（`pipeline.ts:63-65` 的 `formatStockOutput`
  不含该字段）、不落归档。原文「进 LLM/归档」为误判；P0 依据是「错误投资数据上屏」。

### CR-01 · P0 · 业绩 QoQ 把「年报累计值」与「一季报累计值」相减 → 假的 −74.8% 环比
- **位置**：`src/reports.ts:41-56`（`adjacentQuarterGap` / `qoqSeries`）、`:118-123`
- **证据**：相邻性只看天数（88–93 天），不区分累计口径。真实 TDX fixture
  （`test/fixtures/f10_tdx.txt:8`）中 `2025-12-31` 是全年（归母净利 15,018,100 万），
  `2026-03-31` 是一季度（3,785,200 万），间隔 90 天 → QoQ = −74.79%。
- **影响**：DataScreen 同屏打印「YoY 1.52% | QoQ −74.80%」；`src/pipeline.ts:82-84`
  把 `Net Profit QoQ percent` 写进 `build_stock_information` 给 agent，得出「净利润环比暴跌」；
  按 `report_date` 去重持久化后**无法靠重算修复**（`store-file.ts:257-258`，
  `test/reports.test.ts:129-137` 只断言 `Number.isFinite`）。
- **最小修复**：`qoqSeries` 增加「上一期 `-12-31` 且本期不是 → NaN」门槛；同步修改
  `.trellis/spec/data_source/tdx.md:83-85`（该条现把此行为写成规格）；测试改断言 `toBeNaN()`。
- **来源**：math seam。**新发现**（spec 语义本身产错数）。
- **验证**：**CONFIRMED，且 validator 建议升 P0（已采纳）**。理由：错误值进 LLM 上下文、
  落库且去重不可自愈。原文把 spec 路径写成 `data_source/tdx.md`（仓库无此目录），
  已修正为 `.trellis/spec/data_source/tdx.md:83-85`。

---

## 5. P1（发布前应修）

### CR-02 · P1 · MCP / 亿信代理客户端不发 `X-SOA-Token`：非回环部署下恒 401 静默降级
- **位置**：`src/mcp.ts:195-220`、`src/billionsClient.ts:84-100`；服务端门 `app/server.mjs:194-217`
- **证据**：服务端对 7 个代理端点统一要求 token（非回环监听时），两个客户端包装器只从白名单
  重建头，白名单无 `x-soa-token`：
  ```ts
  const FORWARD = { 'tdx-api-key': true, 'content-type': true, accept: true, 'mcp-session-id': true };
  ```
  同仓 `src/llm.ts:87`、`src/webSearch.ts:83` 都带该头；`app/.env.example:19-23` 还承诺
  「全部同源代理请求自动带 X-SOA-Token」，但端点表同样漏了这两个。
- **影响**：`HOST=0.0.0.0`（spec 支持的远程用法）时，通达信情报恒落「查询失败」、
  亿信四源恒落「检索失败」，占位文本进入 prompt，LLM 在缺情报下出结论；UI 只当普通降级。
  回环监听与桌面随机端口不受影响，故现有 fake-fetch 测试恒绿。
- **最小修复**：两个包装器各加一行——存在 `EXPO_PUBLIC_SOA_ACCESS_TOKEN` 时写入
  `x-soa-token`；同步 `.env.example` 端点表；各补一条断言该头的单测。
- **来源**：core seam。**新发现**。
- **验证**：**CONFIRMED（P1）**。补充旁证：`.env.example` 的承诺与端点表不一致，修复须同改。

### CR-05 · P1 · 发布版本链不一致：`versionCode` 恒为 1，本地发布链 `versionName` 停在 0.1.5
- **位置**：`app/app.json:17-27`（无 `android.versionCode`）；`.github/workflows/release.yml:126-146`；
  `app/android/app/build.gradle:95-96`（本地预构建产物）；`app/scripts/build-release-clean.sh:63,65`
- **证据**：三个 `package.json`/`app.json` 均为 `0.1.9`，全仓无 `versionCode` 配置；
  CI 每次 `expo prebuild` 从零生成，`versionCode` 默认 1；release 版本门只比对
  tag ≡ desktop/app/app.json 版本，管不到 `versionCode`。本地脚本不跑 prebuild，
  产物 `versionName` 停在 `0.1.5`，但分发文件名用 `v0.1.9`。
- **影响**：Google Play 拒绝重复 `versionCode`，第二个版本即断；本地 APK 文件名/系统显示/
  升级判定三者不一致。
- **最小修复**：`app/app.json` 增 `android.versionCode` 并在发版时 bump（或 workflow 从 tag 推导）；
  本地脚本构建前跑 `expo prebuild`（或同步 `versionName/versionCode`）。
- **来源**：desktop seam + server seam（合并重复）。**新发现**。
- **验证**：**CONFIRMED（P1）**。`prebuild 默认 versionCode=1` 由本地产物佐证（expo 行为，非仓库静态）。

### CR-06 · P1 · 隐私政策 §5「不申请任何 Android 权限」与实际清单直接矛盾
- **位置**：`docs/privacy-policy.md:6,93-97`；`app/modules/soa-keepalive/android/src/main/AndroidManifest.xml:5-8,13-16`
- **证据**：政策原文「**不申请任何 Android 权限**…也不包含通知(POST_NOTIFICATIONS)、前台服务」；
  入库的模块清单声明 `FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_DATA_SYNC`、
  `POST_NOTIFICATIONS`、`WAKE_LOCK` 与 `foregroundServiceType="dataSync"` 服务；
  `SoaKeepAliveModule.kt:31-35` 分析开始即 `startForegroundService`，
  `app/hooks/useAnalysis.ts:21` 是活调用点。
- **影响**：Play「权限 / 前台服务 / 数据安全」申报与自家政策互相打脸；上架驳回或事后下架风险。
- **最小修复**：政策 §5 与开发者注改为事实清单 + 用途一句话；同步 Play Console 声明。
  主清单里的 `INTERNET/VIBRATE/SYSTEM_ALERT_WINDOW/READ|WRITE_EXTERNAL_STORAGE` 是
  prebuild 产物观测（未入库），需重新 prebuild 后复核再决定是否删除模板遗留项。
- **来源**：sec seam + server seam（合并重复）。**回归**（08-29 N-7 后模块落地未回改文案）。
- **验证**：**CONFIRMED（P1）**。证据强度分层：入库模块清单已足以证伪政策（不依赖 gitignored 产物）。

### CR-07 · P1 · `allowBackup` 默认 true：明文 API key 进入 Android 云备份
- **位置**：`app/app.json:17-27`（未声明 `android.allowBackup`）；
  `app/node_modules/@expo/config-plugins/build/android/AllowBackup.js:26`
  （`config.android?.allowBackup ?? true`）；`app/lib/settingsStore.ts:40,101,109-125`
- **证据**：Expo 配置插件默认 `allowBackup = true`（静态可证）；设置（含 LLM/TDX/亿信 key）
  以 JSON 明文写 `Paths.document/soa-settings.json`，`settingsStore.ts:109-111` 自认
  「明文…不承诺密钥落盘加密」。当前 prebuild 产物观测同样为 `android:allowBackup="true"`，
  无 `fullBackupContent`/`dataExtractionRules`。
- **影响**：Auto Backup 默认上传 app 私有目录 → 明文密钥随 Google Drive 离开设备，
  与政策「仅保存在设备本地/不会离开设备」冲突；卸载重装/换机还会把密钥恢复到新设备。
- **最小修复**：`app/app.json` 增 `"android": { "allowBackup": false }`（或 `dataExtractionRules`
  排除 `soa-settings.json`），prebuild 后核对清单。
- **来源**：sec seam + server seam（合并重复）。**新发现**。
- **验证**：**ADJUSTED（P1 保留）**。位置主证据由「gitignored 产物」改为「`app/app.json`
  缺失 + Expo 插件默认 true」，已用 `AllowBackup.js:26` 静态钉死。

### CR-08 · P1 · 跨 host 重定向把用户 LLM 密钥原样发给重定向目标
- **位置**：`app/lib/proxies.cjs:273-282,306-326`
- **证据**：`forwardOpts.headers` 固定带 `Authorization`；`redirect: 'manual'` 手工跟随时
  只校验新 host「是公网」，随后用**同一个** `forwardOpts` 再请求：
  ```js
  if (next.hostname !== baseUrl.hostname) { const hop = await pinPublicHost(next); … }
  upstream = await _fetch(target, forwardOpts);   // Authorization 仍在
  ```
  WHATWG fetch 自动跟随跨源重定向时会剥掉 `Authorization`，手动跟随丢了这层保护。
  `test/proxies.test.ts:307-330` 把跨 host 跟随钉成期望行为，未断言头处理。
- **影响**：上游 302/307 跳到另一公网 host（区域节点、被投毒网关）时，用户 API key 落到
  用户从未配置过的第三方。触发需用户自配 base 返回跨 host 跳转，「投毒」属场景推断。
- **最小修复**：跨 host 分支构造 `{...forwardOpts, headers: {...forwardOpts.headers, Authorization: ''}}`
  或直接拒绝跨 host 跳转；补断言「第二跳 `Authorization === ''`」。
- **来源**：server seam。**新发现**。
- **验证**：**CONFIRMED（P1）**。位置微偏已修正（forwardOpts 273-282，循环体 306-326，
  测试 307-330）；「被投毒网关」应弱化为「上游跳转到用户未配置的 host」。

---

## 6. P2（判断项 / 标准漂移 / 次要边界）

> 每条：ID · 问题 — 位置 — 最小修复 — 验证。P2 不阻断发布，按批次处理。
> `CR-03/04/09/10` 原为 P1，验证后降级；`CR-28` 原判断被证伪，已改写；
> `CR-61` 部分证伪，降为备注。

### 6.1 核心编排（core）

| ID | 问题 | 位置 | 最小修复 | 验证 |
|----|------|------|----------|------|
| CR-20 | `completeExpert` 无空内容兜底：空流 → 空 report + 状态 `done` | `src/agents.ts:128-132`（AL2 守卫对照 `:165-171`） | 空 → `NO_CONCLUSION_TEXT` + `error` + 状态 `retry` | CONFIRMED；原文位置/锚点偏移已改 |
| CR-21 | `done` 契约无 degraded 标记：占位兜底被当成功写历史 | `src/events.ts:31-36,201`；`app/lib/analysisController.ts:911-918` | `FinalReport` 增 `degraded`；消费侧不置 `hasDone`、不写归档 | CONFIRMED（行号微调） |
| CR-22 | `abort()` 零测试，作废代仍 emit（靠消费方自带代数门） | `src/events.ts:128-131`；`test/` 无 abort 用例 | 补 abort 用例；注释写明消费方需自带代数门 | CONFIRMED（位置改为 128-131） |
| CR-23 | 取消/看门狗不触达 LLM 与工具循环，后台继续烧 token | `src/retry.ts:120-152`；`src/toolLoop.ts:88-131` | 本轮不改代码，把边界写进 `ts/events-streaming.md` 与 `retry.ts` 头注释 | CONFIRMED（已知边界 + 缺文档） |
| CR-24 | 工具预算只按轮数：`web_search` 无调用上限、同参不去重 | `src/toolLoop.ts:84`；`src/webSearch.ts:233-247` | 加 `maxCalls`（对齐亿信三件套）或对 `(name,args)` 复用 ToolMessage | CONFIRMED |

### 6.2 数据采集（data）

| ID | 问题 | 位置 | 最小修复 | 验证 |
|----|------|------|----------|------|
| CR-25 | 缺失 volume 被伪造成 0（停牌/半日市）→ 换手率假 0 | `src/yahoo/deviceYahooCollect.ts:145-146` | `null/undefined` 保留 NaN | CONFIRMED |
| CR-26 | quoteSummary 刷新后非 401 失败被误标 `crumb/401` | `src/yahoo/yahooClient.ts:200-201` | 按真状态码构造 `code/status_code` | CONFIRMED |
| CR-27 | `parseContentResponse` 无长度守卫（同文件另一解析有） | `src/tdx/f10Client.ts:44-45` | `if (body.length < 12) return ''` | CONFIRMED（行号 44-45） |
| CR-10 | Yahoo 代理链缺载荷形状校验：200 + 非 JSON 直接 TypeError | `src/yahoo/webYahooCollect.ts:84-88`；对照 `src/webCollect.ts:129-135` | 照抄 `collectViaProxy` 形状门 + HTML-200 用例 | **P1→P2**：失败路径上的文案质量，无数据/安全后果 |

### 6.3 存储（storage）

| ID | 问题 | 位置 | 最小修复 | 验证 |
|----|------|------|----------|------|
| CR-28 | **改写**：hydrate 永久失败（配额/权限）时写 op 被 `.catch(logError)` 静默丢弃，UI 仍显示已保存，重启即丢 | `src/store-file.ts:163-170`；`src/store-idb.ts:179-181` | 失败上报用户可见信号（或状态标 degraded），不要只记日志 | **原判断 REFUTED**（`enqueue` 已先 `await ready()`，不会覆盖磁盘；`test/store-file.test.ts:59-63` 钉死相反语义）→ 改为本条 |
| CR-29 | 归档索引不与正文对账：`writeIndex` 失败后该条重启即从列表消失 | `app/lib/runArchive.ts:236,320-331` | 索引条数 < 目录 `<id>.json` 数时重建 | CONFIRMED |
| CR-30 | 设置持久化非原子写：崩溃半截 JSON → 设置静默回默认 | `app/lib/settingsStore.ts:137-139`；`src/store-node.ts:94-95` | 复用 tmp+rename | CONFIRMED（web 走 localStorage 原子；桌面/RN 受影响） |
| CR-31 | `getExpoBackend(relBaseDir)` 首次调用后忽略入参 | `src/store-file.ts:40-41,94,117` | 按 `relBaseDir` 建 Map | CONFIRMED（latent：生产只有默认单例） |
| CR-32 | 文档漂移：StoreLike 方法数 11/10 并存；spec 仍把 `createMemoryRunArchive` 算作 `runArchive.ts` 后端；文件末尾悬空 JSDoc | `.trellis/spec/ts/stores.md:2,21,85`；`src/store-idb.ts:241`；`app/lib/runArchive.ts:370` | 统一 10；注明内存后端在 `test/fixtures/`；删悬空注释 | CONFIRMED（属 R-18 关闭后的文档残留） |

### 6.4 金融计算/图表（math）

| ID | 问题 | 位置 | 最小修复 | 验证 |
|----|------|------|----------|------|
| CR-33 | spec 写「财务 3 pane 折线」，实现是柱状；未记 ROE 回退 | `.trellis/spec/ts/chart-ui.md:22,31,71`；`app/components/FinancialTrendChart.tsx:62-65`；`src/chartData.ts:103` | spec 三处改柱状（2026-08-15 用户反馈）+ 补 ROE 回退 + 同步 `build-chart-view.mts` 头注 | CONFIRMED（漂移面比原文更宽） |
| CR-34 | 「涨跌幅」pane 图例色与柱色不一致；标题与 chip 同名重复 | `app/components/IndicatorChart.tsx:47,179-180,190-191`；`app/lib/chartHtml.ts:112-114` | 图例 chip 用 `upA` 或纯文字；同名过滤与 else 分支一致；同步 `chart-ui.md:57-58` | CONFIRMED（行号已修正） |

### 6.5 App UI（ui）

| ID | 问题 | 位置 | 最小修复 | 验证 |
|----|------|------|----------|------|
| CR-03 | **改写**：过期的历史 load 覆盖用户最新选择；`closeRun` 后迟到的 `openRun` 会把用户拽回历史态 | `app/lib/analysisController.ts:303-334`；`app/screens/HistoryPanel.tsx:117-122` | 加 `historySeq` 代数门（`await` 后不匹配即丢弃） | **P1→P2**：原「横幅 B/正文 A 错配」被反证（`applyReportBody` 与 `viewingRun` 同段写入） |
| CR-35 | 错误边界不随 Tab 复位：一次崩溃后切 Tab 仍是错误卡 | `app/App.tsx:394`；`app/components/ErrorBoundary.tsx:40-52` | `<ErrorBoundary key={activeTab}>` | CONFIRMED |
| CR-36 | 校验失败时市场徽标与错误文案自相矛盾 | `app/lib/analysisController.ts:736,741`；`app/App.tsx:202-204` | 失败分支也写 `s.market` | CONFIRMED |
| CR-37 | 设置面板不校验 Base URL scheme | `app/lib/settings.ts:115-138`；`app/screens/SettingsPanel.tsx:79-81`；对照 `src/llm.ts:43` | 复用 scheme 正则，面板红色提示不保存 | ADJUSTED：原文 `:112` 指向掩码函数，已改；`:249` 文案自带「Node/真机无此限制」限定 |
| CR-38 | `zlib-shim.inflateSync` 无输出上限，`number[]` 累积（deflate 炸弹 OOM） | `app/lib/zlib-shim.ts:173,185,246` | 内置 `maxOutput`（如 8 MiB）+ `Uint8Array` 增长缓冲 | CONFIRMED（影响收窄：仅 TDX 帧解压；`:263` 与论点无关已删） |
| CR-39 | keepalive 原生模块直写 console，违反「单一日志出口」条款 | `app/modules/soa-keepalive/index.ts:26-45`；标准 `ts/index.md:41` | 改走 `src/log.ts`，保留 `__DEV__` 门控 | CONFIRMED（5 处均 `__DEV__` 门控，生产零输出） |
| CR-49 | `useAnalysis` 编排胶水零测试（宽限定时器/AppState/collect 三分派） | `app/hooks/useAnalysis.ts:107-176` | 抽纯函数 + 注入 fake 单测 | CONFIRMED（属 08-22 E1 整改的已知残余） |

### 6.6 桌面/构建/发布（desktop）

| ID | 问题 | 位置 | 最小修复 | 验证 |
|----|------|------|----------|------|
| CR-04+CR-40 | `app/tsconfig.json` 仍是 `extends` 版，restore 脚本对 HEAD 恒真、每次运行都产生 diff；desktop build 入口还绕过该脚本（同一根因，合并） | `app/tsconfig.json:37`；`tools/restore-app-tsconfig.mjs:16-57,69-70`；`desktop/package.json:11` | 提交无 `extends` 的内联版；desktop build 追加 restore；加 `expect(extends).toBeUndefined()` | **P1→P2**：因果修正——diff 来源是脚本本身，不是每次 export；`ci.yml:54-56` 已装 app 依赖，TSCONFIG_ERROR 仅「只装根依赖」可达 |
| CR-41 | `probe.mts` 分析失败仍退出 0，旧 `report.json` 不清 | `tools/probe.mts:75-77` | 失败分支 `process.exitCode = 1` + 删除旧文件 | CONFIRMED |
| CR-42 | 「6 个 mutator」注释/spec 与实现 5 个不一致 | `desktop/preload.cjs:6`；`desktop/child.mjs:12`；`test/store-op-validators.test.ts:3`；`.trellis/spec/architecture.md:53` | 四处改 5，注明 `updateOverview` 已移除 | CONFIRMED |
| CR-43 | tag 发布链路不跑 typecheck/vitest | `.github/workflows/release.yml`（全文无测试步骤） | 加 `test` job，desktop/android `needs: test` | CONFIRMED；缓解：tag 通常打在已过 CI 的 master 上，裸奔面是 `workflow_dispatch` 与未过 CI 的 tag |
| CR-44 | Node 版本冲突：README ≥23.6 vs engines ≥22.23.4 / .nvmrc / CI 22 | `README.md:11`；`package.json:5-7`；`.nvmrc:1`；`ci.yml:38` | 只改 README 一行；`node-version-file` 为可选优化 | ADJUSTED：「四处不一致」夸大，engines/.nvmrc/CI 互相兼容 |
| CR-55 | 本机发布脚本把密钥暂存 `/tmp`，构建期清空 `.env` | `app/scripts/build-release-clean.sh:22-27` | `mktemp -d` + `chmod 700` + 恢复后 `shred -u`；trap 加 `INT TERM HUP` | ADJUSTED：`mktemp` 默认 0600；EXIT trap 覆盖正常/`set -e` 失败路径，仅 SIGKILL/掉电丢 key |
| CR-56 | release 签名块无「缺 `keystore.properties` 即失败」守卫 | `app/android/app/build.gradle:105-108` | 加 `throw new GradleException(...)` 或构建后 `apksigner verify` | ADJUSTED：缺失时 Gradle 配置期会抛异常（文案不指向缺文件），非静默出错包；仅本地手建路径可达 |

### 6.7 测试/spec/文档（tests）

| ID | 问题 | 位置 | 最小修复 | 验证 |
|----|------|------|----------|------|
| CR-09 | `test/device-collect.test.ts` 用 `vi.mock` 替换 src 模块，违反 testing.md 反模式 | `test/device-collect.test.ts:16-18`；标准 `.trellis/spec/testing.md:30,91` | 给 `collectForDevice` 加注入面，测试改传 fake，删 3 处 mock | **P1→P2**；且「上一轮结论失真」错误——11-05 未评审 deviceCollect，正确表述是「新增违例，zero-mock 已非当前事实」 |
| CR-45 | spec 自称「7 条架构断言」，代码已 8 条 | `.trellis/spec/ts/index.md:37,41,48`；`test/architecture.test.ts:309` | 3 处 7→8，表格补第 8 行 | CONFIRMED（11-05 文档同样写 7，属陈旧延续） |
| CR-46 | 同源代理路由表过时：spec 列 4 条，实现 6 个 handler + `/logs` = 7 | `.trellis/spec/ts/events-streaming.md:82-83`；`app/lib/proxies.cjs:755-761` | 补 `/yahoo-collect`、`/tdx-mcp`、`/billions-proxy` | ADJUSTED（计数 7，非 6） |
| CR-47 | 跨会话键 `soa:last-run` 无字面量钉死 | `test/metaKeys.test.ts:37-40`；`src/lastRun.ts:8` | 加 `expect(LAST_RUN_KEY).toBe('soa:last-run')` | ADJUSTED：`test/store-durability.test.ts:85,97` 有裸串但改名不会失败；与 R-34 同族 |
| CR-48 | 架构断言 2 可被子路径 import 绕过（`react-native/...`） | `test/architecture.test.ts:144` | 正则改 `/['"]react-native(\/|['"])/` + 反例 | CONFIRMED（当前 `src/` 无违规） |
| CR-50 | 三个测试文件不还原 `process.env` / 全局开关 | `test/events.test.ts:11-15`；`test/runner.test.ts:10-15`；`test/committee.test.ts:88-97`；标准 `testing.md:60-66` | 加 `afterEach` 保存/还原 + 复位 switches | CONFIRMED（当前靠 vitest 隔离兜住） |

### 6.8 安全/供应链/隐私（sec/server）

| ID | 问题 | 位置 | 最小修复 | 验证 |
|----|------|------|----------|------|
| CR-51 | `SEC_HEADERS` 实为两份字面量，注释称「单份防漂移」，测试只 `toContain` | `app/server.mjs:42-47`；`app/lib/proxies.cjs:27-32`；`test/server-static.test.ts:102-105` | 抽 `sec-headers.cjs` 共享，或加等值断言 | CONFIRMED（两份还差 `Cache-Control: no-store`） |
| CR-52 | `/web-search` 20s 超时定时器永不 clear | `app/lib/proxies.cjs:590-597` | `try/finally clearTimeout` | CONFIRMED（失败方定时器悬挂，最长拖住事件循环 20s） |
| CR-53 | GET 代理端点无 Origin 门：任意网页可对回环 server 触发采集/搜索 | `app/server.mjs:171-172,194-204`；`test/server-static.test.ts:153-160` | 加 `Sec-Fetch-Site: same-origin` 判据，或对连续外部触发加冷却 | CONFIRMED（测试把该行为钉成预期；无数据外泄） |
| CR-54 | `/billions-proxy` 丢弃 query string，与客户端拼装不一致 | `app/lib/proxies.cjs:700,733`；`src/billionsClient.ts:98` | 转发 `u.search`（白名单仍只看 pathname） | CONFIRMED（latent：四个端点均为 POST+body，恒无 query） |
| CR-57 | 三份 lockfile 全部把 tarball 钉在 `registry.npmmirror.com` | `package-lock.json:29`；`app/package-lock.json:34`；`desktop/package-lock.json:17` | 记录为有意决策并在 CI 显式 `--registry`，或重生成指向官方 | CONFIRMED（有 `integrity` 校验；风险=可用性/来源政策，非注入） |
| CR-58 | 许可证四方不一致：根 GPL-3.0 / 根 package.json 无 license / app `UNLICENSED` / `app/LICENSE` 是 Expo MIT 残留 | `LICENSE:1-2`；`package.json`（无 license）；`app/package.json:4`；`app/LICENSE:1-3` | 删 `app/LICENSE`；根与 app 均写 GPL-3.0-or-later | CONFIRMED（第四处为 validator 补充） |
| CR-59 | `EXPO_PUBLIC_SOA_ACCESS_TOKEN` 编译期内联：客户端那份 token 等于公开 | `src/llm.ts:76-77`；`app/lib/settings.ts:181-189`；`app/.env.example:19-23` | 文档明示「只防误连、不是机密」，或改服务端握手 | CONFIRMED（服务端 `SOA_ACCESS_TOKEN` 仍保密，仅客户端内联份公开） |
| CR-60 | 隐私政策 §3 第三方表缺 Yahoo Finance 与 Finnhub（Finnhub key 进 URL query） | `docs/privacy-policy.md:69-74`；`src/finnhub/finnhubClient.ts:55-56`；`src/yahoo/deviceYahooCollect.ts:50` | 补两行 + 注明启用条件 | CONFIRMED（行号窄化） |
| CR-61 | **备注（部分证伪）**：`.gitignore` 未覆盖 `*.keystore` | 根 `.gitignore:5`；`app/.gitignore:17` | 可选硬化：加 `*.keystore` | REFUTED 部分：`*.jks` 已忽略；`release.keystore` 无斜杠模式匹配任意深度；仅「其他命名的 keystore 放在 `app/android` 之外」才误入库 |
| CR-62 | 政策称「日志仅存本地、不自动上传」，代码 web 每行 POST `/logs` | `docs/privacy-policy.md:40`；`src/log.ts:74-80,189-191`；`app/lib/logs-server.cjs:32,54` | §1.2/§4 加一句条件说明（远程 server / RN endpoint） | ADJUSTED：默认部署落本机文件；仅「web 连非回环 server」或「RN 设 `EXPO_PUBLIC_LOG_ENDPOINT`」时日志离开设备，不是第三方共享 |
| CR-63 | 12 处未使用 import/局部变量 | `app/lib/runner.ts:8`；`src/agents.ts:123,142`；`src/indicators.ts:220`；`src/mcp.ts:206`；`src/toolLoop.ts:8`；`test/agents.test.ts:132`；`test/committee.test.ts:230`；`test/live.integration.test.ts:7`；`test/tool-loop.test.ts:2`；`test/yahoo.test.ts:5`；`tools/probe.mts:50` | 删除或接上使用 | CONFIRMED（母 agent 重跑计数：12） |

---

## 7. 验证记录

| 批次 | 分配 | CONFIRMED | ADJUSTED | REFUTED | 关键修正 |
|------|------|-----------|----------|---------|----------|
| V1 数据/数学 | 11 | 8 | 3 | 0 | CR-00 影响收窄（不进 LLM/归档）；CR-10 降 P2；CR-01 升 P0；CR-20/22/27 行号修正 |
| V2 存储/UI | 11 | 8 | 2 | 1 | CR-28 被证伪（`enqueue` 已先 `ready()`）；CR-03 后果被反证（降 P2）；CR-37 行号错 |
| V3 安全/测试 | 10 | 9 | 1 | 0 | CR-09 降 P2 且「回归」表述错误（11-05 未评审该文件）；CR-63 计数待复核 |
| V4 构建/发布 | 13 | 7 | 6 | 0 | CR-04 降 P2 且因果反转；CR-44「四处不一致」夸大；CR-46 计数 6→7；CR-55/56 风险收窄 |
| V5 合规/文档 | 10 | 7 | 2 | 1 部分 | CR-07 证据链改为「app.json 缺失 + Expo 默认 true」；CR-61 `*.jks` 已忽略（降备注）；CR-62「上传」措辞夸大 |

验证覆盖 55 条（含重叠 ID）。**硬证伪 1 条**（CR-28），**部分证伪 1 条**（CR-61），
其余 53 条成立，其中 14 条需修正行号/严重度/影响表述——均已回填本文。

## 8. 已验证干净（抽查，非全部）

- **架构断言（8 条）**：`src` 无 `node:`/RN import；`app` 无白名单外 `process.env` 直读。
- **重试契约**：`429/500/502/503/504` + `connection/timeout/network`，`min(base·2^(n-1),8s)` ×3，invoke/stream 文案单源。
- **工具循环**：15 轮上限、未知工具占位、同步/异步工具异常占位、收尾轮不执行工具、AL2 两态占位。
- **事件流**：`running→token→report→done` 时序、单 `done`/单 `error`、订阅者异常隔离、`unsubscribe` 生效。
- **指标公式**：MA/EMA/MACD/RSI/KDJ/BOLL/ATR/换手率与 Python golden fixture 逐列对齐；复权 5835 根价格 <1e-6；`xdxr` 偏移自洽。
- **提示注入面**：system prompt 全静态；用户输入只经 `normalizeTicker` 进入 human 消息；图表 HTML 无自由文本注入。
- **SSRF 基线**：仅 http(s)、拒 userinfo、DNS 解析后任一私网即拒、逐跳复检、5 跳上限；`/tdx-mcp` 目标写死；`/billions-proxy` path 白名单。
- **Electron 基线**：`contextIsolation+sandbox`、`nodeIntegration:false`、`will-navigate` 全拦、`setWindowOpenHandler(deny)`、preload 仅 4 个方法、IPC op 白名单 + 深校验、无自动更新。
- **打包**：`electron-builder.yml` files 不含 `.env`/`app/android`/`database`；asar 关闭、无 publish。
- **存储原子性**：node 适配器 tmp+rename、expo tmp+`moveSync`、tmp 名不以 `.json` 结尾、`close()` 队列尾清理幂等。
- **已关闭项抽查**：R-01/R-02/R-03/R-04/R-06/R-07/R-08/R-09/R-10/R-23/R-24/R-25/R-26/R-27/R-34 修复真实、无回归（与 math seam 零交集）。

## 9. 限制

- reviewer / validator 均为只读，未运行测试；母 agent 已跑基线门与 18 条源码抽查。
- 未在真机（Android/iOS）、真实浏览器、真实 TDX/Yahoo/Finnhub/亿信上游验证；上游客服端行为为静态推断。
- `app/android/**` 是 gitignored 的 prebuild 产物；相关结论以 `app/app.json` 与 Expo 插件默认值为依据（CR-07 已静态钉死），主清单权限需重新 prebuild 后复核。
- `npm audit` 因镜像 advisory 端点不可用而缺失，依赖漏洞面未覆盖。
- 构建产物（`app/dist`、`desktop/dist`）、归档 Python（`data_source/**`）未审。
- 未做覆盖率测量（仓库未接入 coverage provider），覆盖缺口按「模块 × 测试」静态映射。

## 10. 建议处理顺序

1. **立即**（数据正确性/安全）：CR-00、CR-01、CR-08、CR-07、CR-02。
2. **发布前**：CR-05、CR-06、CR-03（代数门）、CR-28（静默丢写）。
3. **下个迭代**：CR-29/CR-30（存储耐久）、CR-51/CR-52/CR-53（代理）、CR-35/CR-36/CR-37（UI）、CR-43/CR-44（CI）。
4. **文档同步**：CR-32、CR-33、CR-34、CR-42、CR-45、CR-46、CR-58、CR-60、CR-62。
5. **可延后**：CR-09（测试风格）、CR-31、CR-54、CR-57、CR-61。

---

*评审执行：2026-11-07。9 reviewer + 5 validator。基线：typecheck 0 error，vitest 755 passed / 2 skipped。*
