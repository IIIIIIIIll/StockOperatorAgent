# 代码改进巡检 — 2026-11-09（`HEAD = 87e22f3`）

> **状态(2026-11-09 收尾)**：25 条 VERIFIED 中的 **P1 全部已修 + P2/P3 绝大部分已修**，
> 余项见文末「§8 未修与理由」。修复提交：`2f9aa8d` / `9bdd6da` / `f2a4f62` / `d3bbd21` /
> `097b754` / `dc85563` / `801ef64`。
>
> **2026-11-10 复核（`HEAD = fd78861`）**：B6 结构性重构已全部落地
> （`410785e` / `0d32e44` / `63ec880` / `7e00374` / `5eb1915`），§8 末节的旧待办
> 清单已重写为真实剩余项。
>
> **2026-11-10 当日收尾（`HEAD = cd40708`）**：剩余待办 **R1-R4 全部做完**
> （`86f24ee` 读侧 `getLastLoadError` / `152001e` agents 提示词单源 /
> `df778a5` 图表建一次+更新 / `cd40708` 三个 shim 首次有测试），每步均有
> Chrome DevTools 或 Android 真机实跑佐证（见 §8）。**只剩 1 项刻意不做**
> （`release.yml` publish job 拆分）。§0 的 5 条 CI 门禁缺口**仍未修**，单列在
> §8 末尾。
>
> **两轮流程**：7 个只读 reviewer 分区扫出 30 条 → 6 个独立 validator 逐条**尝试推翻**
> （要求给出 VERIFIED / NUANCED / REFUTED 与反证行号）。
> **裁决：41 条送验 → 25 VERIFIED · 15 NUANCED · 1 REFUTED**（无一条机制被推翻；
> NUANCED 指「机制成立但后果/严重度说错了」，下文已按裁决改写）。未送验的小项标 `○ 未验`。
>
> 历史三轮（11-05 / 11-07 / 11-08）已修的 ~100 项不重复列。§0 是前几轮遗留，§1-§3 本轮新增，
> §4 是对既有待办的更正，§7 是裁决明细与证据。

---

## 0. 既有待办（本轮之前的遗留，非本轮 reviewer 产出）

| 项 | 位置 | 裁决 |
| --- | --- | --- |
| 降级终态复用 `RoleStatus 'retry'` → chip 永远显示「重试中」 | `src/agents.ts:141,180` → `app/App.tsx:388`；`RoleStatus` 只有 `'running'\|'done'\|'retry'`（`src/progress.ts:8`） | **VERIFIED**。`done` 分支（`analysisController.ts:946-995`）从不写 `statuses`，degraded 只翻 `hasDone` → 重试中挂到下一轮 run 为止 |
| release 无密钥/泄漏扫描 | `release.yml` 全文；`.github/` grep `gitleaks\|detect-secrets\|trufflehog\|codeql\|npm audit` 零命中 | **VERIFIED** |
| 桌面打包烟测只在 Linux 跑 | `release.yml:128`、`:151-152`（`if: runner.os == 'Linux'`，且断言的是 `linux-unpacked` 与 `xvfb-run`） | **VERIFIED**。`:180-186` 照样上传 `*.exe`/`*.dmg`，无第二道断言；`ci.yml` 从不跑 `electron-builder` |
| APK 签名静默降级 debug，无 `apksigner` 校验 | `tools/configure-android-signing.mjs:214-219`（缺 `ANDROID_KEYSTORE_B64` → 打印 → `exit(0)`）；workflow grep `apksigner\|jarsigner\|keytool` 零命中 | **VERIFIED**（降级路径仍在）· **发布侧已实证**：v0.1.12 的 apk 用 `apksigner` 验签为 `CN=SOA Release`（非 `CN=Android Debug`），说明 Secrets 已配置、正式签名生效；但 CI 仍不校验，回归时没人会发现 |
| 两套 workflow 均无 `concurrency:` | `.github/workflows/*` grep 零命中 | **VERIFIED**。重推同名 tag 会再触发一次；同一 run 内 desktop/android 两个 job 已互相覆盖 `body:` |
| `ci.yml:2-7` 注释过期（称 app tsc / expo export「本轮不做」） | `ci.yml:63-65`、`:78-82` 已是实际 step | ○ 未验（纯注释） |

**今天已解决**：`react-dom` 19.3.1 与 `react` 对齐（`87e22f3`）——此前 dev 端
`react-dom/client` 的版本守卫会直接抛 `Incompatible React versions`。

---

## 1. P1（7 条）

### P1-1 · 取消后的孤儿运行，事件被下一轮运行吸收 — **VERIFIED**

- **位置**：`app/lib/analysisController.ts:745-746`、`:246-248`（派发）、`:263`（cancel 只 bump
  `runSeq`）、`:742-748`（start 装新闭包并重置 `timedOut`）；发射侧 `src/events.ts:139-142`
  （`abort()` 只复位 `running`）、`:218/:227`（无条件 `emit`）。
- **实情**：门比较的是**处理器捕获的 seq vs 当前 seq**，不是事件来源。订阅把**每个**事件
  都交给**当前** `runHandler`，而 `PipelineEvent`（`:18-24`）不携带运行身份 → 无法区分来源。
  看门狗路径同理：`armWatchdog()` 置 `timedOut`（`:567`），`start()` 又清掉（`:748`），
  所以 `handleEvent:918` 的 `timedOut` 门在下一轮 start 后同样失效。
- **后果**：取消 A → 立刻分析 B：A 的迟到 token 追加进 B 的 `s.partials`（同名节点，
  两个 ticker 正文交错）；A 的 `report` 进 B 的 `events`；A 的 `done` 触发
  `saveLastRun` + `recordRun`，把 A 的内容当 B 归档（`newRunId` 带时间戳，故是新增行而非覆盖）。
- **最小修**：`RunOptions` 加 `runTag?: number`，`run()` 内每次 `emit` 铺开该字段（约 4 行），
  `start():887` 传自有 tag，构造函数订阅（`:246`）丢弃不匹配 tag 的事件。不要在 runner 内
  直接门 `emit` —— 会破坏「看门狗超时后真 `done` 仍要落地」（`:891-897`）。
- **测试缺口**：现有用例（`test/analysis-controller.test.ts:676`）只覆盖孤儿 `settle`，
  未覆盖孤儿 `events`。

### P1-2 · LLM 内层隐藏重试：单节点最多 21 次请求 — **VERIFIED**

- **位置**：`src/llm.ts:73-98`（未设 `maxRetries`）。
- **实情**（validator 精确核算）：`@langchain/core` 的 `AsyncCaller` 默认
  `maxRetries ?? 6`（`async_caller.js:182`）→ `callWithRetries(6,…)` = **1+6=7** 次；
  OpenAI SDK 自身被钉成 0 次（`@langchain/openai/dist/chat_models/base.js:324`），无第三层；
  外层 `src/retry.ts:16` `ATTEMPTS=3` → **7×3=21**。
- **后果**：内层每次重发完整 prompt，输入 token 重复计费；内层唯一钩子是
  `onFailedAttempt`（`async_caller.js:195`），项目侧日志（`retry.ts:127`）与
  `onRetry → 'retry'`（`retry.ts:169`）只在外层触发 → UI 显示角色卡死。
- **最小修**：`new ChatOpenAI({ model, apiKey, maxRetries: 0, ... })`。

### P1-3 · Yahoo 采集链的 40s 超时只管到响应头 — **NUANCED（后果需改写）**

- **位置**：`src/yahoo/yahooClient.ts:99-100`（`finally { clearTimeout(timer) }` 在 fetch
  resolve 即执行）；后续 body 读 `:225`、`:273`、`:285`、`deviceYahooCollect.ts:183`
  全在计时窗口外；`webYahooCollect.ts:71` 是裸 `fetch`，`:84 resp.json()` 完全无超时。
- **裁决**：机制与行号全对，但「永不 settle → 锁永不释放」是**最坏情形**而非必然 ——
  Node undici 默认 socket 超时（约 300s）可能兜住静默 socket。
- **改写后的后果**：`proxies.cjs:564-569` 断言的「单请求 40s → 锁必有界释放」**不成立**；
  45s `send(504)`（`:570-571`）之后锁仍被 `_collect` 持有到它 settle（`:580`），
  期间的后续采集吃 429，时长在实践中无界。
- **最小修**：body 读取圈进计时窗口（`fetchJsonWithTimeout`，先 `await resp.json()` 再
  `clearTimeout`，或用 `Promise.race`）；`collectYahooViaProxy` 改用带超时的封装。

### P1-4 · release 门禁 ≠ CI 门禁：缺 app 层 typecheck — **VERIFIED**

- **位置**：`release.yml:15-55`（只有根 `npm run typecheck`、`npm test`、desktop probe）
  vs `ci.yml:63-65`。
- **实情**：根 `tsconfig.json` 的 `include` 只有 `src/**/*.ts, test/**/*.ts, tools/**/*.mts`
  → app 层对根门**完全不可见**；`expo export` 走 Metro/Babel，类型错误照样通过。
- **后果**：对跳过 CI 的 commit 打 tag（或 `workflow_dispatch`）→ 用带类型错误的 app 代码
  产出安装包/APK，全绿。
- **最小修**：`test` job 的 `Typecheck` 之后插一步 `working-directory: app` +
  `run: npx tsc --noEmit`。

### P1-5 · web E2E 工具写好了，但从没接进 CI — **VERIFIED**

- **位置**：`package.json:13`（`e2e:web`）→ `tools/web-e2e.mjs`，`:11-12,28-30` 硬性要求
  `app/dist/index.html`；`ci.yml:78-82` 正好产出它；`.github/**` grep `e2e`/`web-e2e` = 0。
- **后果**：`expo export` 只证明能编译，挂载即抛的 bundle 一样绿；整个 web 面（首屏、
  演示分析、抽屉、数据页，见 `web-e2e.mjs:150-190`）每次发版未验证。
- **最小修**：`Build web bundle` 后加 `run: npm run e2e:web`（ubuntu-latest 自带
  `/usr/bin/google-chrome`，脚本默认即用）。

### P1-6 · 流式期间每 120ms 全量重解析 Markdown — **VERIFIED**

- **位置**：`app/components/ReportContent.tsx:53,87,107` → `MarkdownText.tsx:10`；
  节流常量 `analysisController.ts:65`（`TOKEN_NOTIFY_MS = 120`）。
- **实情**：`react-native-markdown-display` 的默认参数每次渲染都新建 markdown-it 实例，
  `src/index.js:185` 无条件 `parser(children, …)`（只有 renderer 实例被 memo）。
  `snapshot()` 每次返回新的 `partials`/`statuses` 对象（`:616`、`:342`）→ `React.memo`
  从不短路。非 token 事件还会立即 notify，所以突发时**超过** 8 fps。
- **后果**：3–5k 字报告每帧数百节点重解析 + 重 diff；Android 打字/滚动卡顿，ScrollView
  内容高度每帧变化导致滚动漂移。
- **最小修**：只节流渲染侧——`app/hooks/useThrottledText.ts`（约 12 行，尾部边沿 300ms）。
  `useDeferredValue` 不省解析成本。

### P1-7 · 盘中部分 bar 被当成当日最终 bar 复用一整天 — **VERIFIED（validator 提级）**

- **位置**：`src/yahoo/deviceYahooCollect.ts:196`（`end = nowSec + 86_400; // 含今天`）、
  `:126-147`（`barsFromChart` 不筛「已收盘」）、`applyYahooCollectedToStore.ts:91-94,103-105`
  （`replaceDatas` + 无条件 `lastDataUpdate = marketToday`）、`src/gates.ts:53-55`、
  `src/collector.ts:35-41`（命中即 `skipDaily`）。
- **后果**：10:00 采集存入未收盘 bar（close = 当时价），18:00 分析走 `skipDaily`
  → 该残缺 OHLC 与派生指标经 `pipeline.ts:220`/`:241` 进 LLM 提示词，直到隔日。
  仓库已记录同类问题：`.trellis/spec/data_source/tdx.md:165-168`。
  注意：overview/snapshot 仍会刷新，所以现价与涨跌幅不陈旧 —— 陈旧的是日 K 与派生指标。
- **最小修**：只有「最后一根 bar 已过收盘时刻」才盖 `lastDataUpdate` 戳，或
  `barsFromChart` 丢弃晚于收盘时刻的当日 bar。

---

## 2. P2

### App 运行态
- **设置写入失败静默丢失 → 下次启动跑演示模式** — **VERIFIED**
  `app/lib/settingsStore.ts:124-152`（两个 `catch {}`、`save(): void`、`:134-137` 的
  `if (!fs) { void getRnFileSystem(); return; }` 也是空操作，文件里连日志都没导入）；
  `app/lib/settings.ts:145` 调用后丢弃结果；失败 → `loadSettings` 回 `defaultSettings()`
  → `analysisController.ts:805-807` → `runner.ts:177-180` `demoLlm()`。
  唯一的救援通道是 `EXPO_PUBLIC_LLM_*` 环境变量（`settings.ts:107-109`），面板存的 key 用不到。
  修：`save(): boolean` + `saveSettings` 失败时 `logError`。
- **单个 `historyLoading` 被三套 seq 家族写** — **NUANCED（后果收敛为观感）**
  机制成立（`:287/309` list seq、`:321/362` open seq、`:396/409`+`:418/431` 未加门），
  但消费者只有 `HistoryPanel.tsx:88` 的灰化刷新图标与 `:101-104` 的「载入中…」占位；
  没有行级 spinner、不禁用行，且 `openRun` 自带 CR-03 seq 守卫（`:322-337`），
  重复点击会被干净地取代。未加门的清理只会**低估** loading，属观感。修：改计数器。
- ○ 未验 · **1011 行拆分缝**（设计建议）：①`:284-450` 历史域 + `:464-532` →
  `runHistoryController.ts`；②`:913-989` `handleEvent` → 纯 `reduceEvent(state, event)`
  返回 `{state, effects[]}`；③`:559-585` 看门狗 → `runWatchdog.ts`（注入时钟）；
  ④`:583-604` notify 合并 + `snapshot/subscribe` → `analysisStore.ts`；⑤`:736-908`
  `start()` → `startGuards` + `preflight` + 薄壳。类字段可从 10 降到 ~3。

### RN UI
- **历史列表在运行期约 8 次/秒全量重渲染** — **VERIFIED**
  三因叠加：prune 的 `setSelected((prev) => prev.filter(...))` 每次返回新数组
  （`HistoryPanel.tsx:58-60`）；`App.tsx:344-351` 六个内联箭头击穿 memo；
  `analysisController.ts:624` 的 `history: [...s.history]` 每快照换身份。
  列表是 `ScrollView` + `groups.map`（`:107-110`），无虚拟化。
  注意：`history` 的拷贝单独就足以击穿 memo，只加 `useCallback` 无效，三处都要改。
- **键盘打开时第一次点「保存配置」被吞掉** — **NUANCED（仅原生）**
  `app/screens/SettingsPanel.tsx:108` 的 ScrollView 无 `keyboardShouldPersistTaps`，
  RN 默认 `'never'`（`ScrollView.js:583`，吞点逻辑 `:1608-1616`，源码注释 `:1583-1586`）。
  但 **RN-web 该分支被注释掉**（`react-native-web/dist/exports/ScrollView/index.js:68-74`），
  web 端点击能到 Pressable。该 prop 在 `app/` 全局缺失（grep 零命中）。
- **8 列 K 表塞不下 360dp** — **NUANCED（数值换行，表头不换行）**
  实算：`theme.ts:45` `spacing.md=12/sm=8` → 行宽 ≈ 360−24−2−16 = 318dp / 8.5 flex
  = **37.4dp**/数值列、56dp 日期列；`1234.5万`≈44dp、`-10.00%`≈42dp 会换行；
  但 `量(手)`/`换手率`/`涨跌幅` 在 fontSize 11 下约 33dp < 37.4dp，**表头不换行**。
  外层只有纵向 `ScrollView`（`:94`），无横向逃逸。修：`ScrollView horizontal` + `minWidth`。

### 图表
- **每次数据变化销毁重建整图** — **NUANCED（频率被高估）**
  机制成立（`IndicatorChart.tsx:128,233`、`FinancialTrendChart.tsx:36,83`，实际是
  30 个 `addSeries`/30 次 `setData`，不是 19/20），但**不是**每个进度事件都触发：
  `dataVersion` 只在 bootstrap（`analysisController.ts:720`）与采集完成（`:841`）变化，
  `bars`/`indRows`/`klineBars`/`chartRows`/`klineChangePct` 都有 memo
  （`DataScreen.tsx:27,78,88,89`），`theme` 是模块常量 → **每次采集完成重建一次**。
  仍是 P2（拆「建一次 + 更新」），不是抖动级问题。
- **图表异步引导无失败路径 → 永久空白、无文案无重试** — **VERIFIED**
  `IndicatorChart.tsx:137` / `FinancialTrendChart.tsx:43` 的 `void import(...).then(...)`
  无 `.catch`；`createChart`/`setData` 无守卫。库证：lightweight-charts
  `validDateRegex = /^\d\d\d\d-\d\d-\d\d$/`（development.mjs:7693），
  `:7712`/`:7717` 抛错在 production 包里也保留，由 `preprocessData`（`:7768`）
  在 `setData` 内同步触发。输入侧：`chartData.ts:92` 原样透传 `rec.period`，
  而 `f10.ts:7` 是非锚定正则、`:76-77` 把整格赋给 `period`，所以 `2026-06-30年报`
  这类格可构造出该抛错（**仓库夹具里的日期都是干净的，属可构造而非已观测**）。
  另：`chartHtml.ts` 只 guard 了 `createChart`（try 167/catch 182），它自己的
  `setData` 循环（`:214`）同样无守卫 → 不是完整的降级范式。
- **红绿柱规则两份实现，只有一份有测试** — **VERIFIED**
  `IndicatorChart.tsx:100-111` 的 `histData` 与 `src/chartData.ts:22-33` 的
  `changePctHistData` 规则相同（`!Number.isFinite` 跳过 + `v >= 0 ? up : down`），
  只有后者被测（`test/chartData.test.ts:45-62`）；`test/` 里没有任何文件 import
  `app/components`。修：`histData` 委托给 `changePctHistData`。

### 数据 / 存储
- **hydrate「内存优先」会丢历史** — **NUANCED（仅 FileStore 有损）**
  `store-file.ts:207-209` 的 `!this.bars.has(ticker)` 跳过确实存在，队列（`:242-247`）
  先 `await this.ready()` 再执行、操作（`:255-262`）从内存整体重写文件 → ready 前
  `addDatas` 会让旧行消失。但 (a) **IdbStore 无此后果**：持久化是行级增量
  （`store-idb.ts:201-209` 只 put 新行；只有 `replaceDatas` 删除，`:213-223`）；
  (b) 可达窗口很窄：`bootstrap()` 已 `await storeReady()`（`analysisController.ts:657`），
  桌面 `child.mjs:183` 也先 await，只有 RN/web 在 hydrate 落定前就 `start()` 才命中。
- **降级采集把旧基本面盖上今日时间戳** — **NUANCED（戳本身无消费者）**
  机制成立（`deviceYahooCollect.ts:399-401` → `composeYahooOverview.ts:144-145` PE/PB 为
  NaN → `mergeOverview` 保留旧值 `:58-67` → `:100` 无条件盖章），但
  `overviewLastUpdate` **没有任何生产消费者**（只有记录/校验面 `store.ts:25,134`、
  `storeOps.ts:69`，旧的 `overviewNeedsRefresh` 已在 E7 删除）。所以陈旧 PE/PB 进提示词
  **与这个戳无关**，字段级合并且保留旧值是 B3 的设计。**残余真问题**：`quoteSummary`
  降级时完全没有陈旧度信号。

### 编排 / 集成
- **信息面素材 3 次 search 串行** — **VERIFIED**
  `agents.ts:448-449` 逐个 `await`；`_SEARCH_SOURCES` 3 项（`:269`）、`fast` 模式 25s
  超时（`billionsClient.ts:114,227`），twitter 也是 25s（`:244`）；进度只有一条
  `safeProgress('开始信息面素材检索。。。')`（`:436`），之后到 LLM 调用前无事件。
  最坏 75s 纯等待（含 twitter 约 100s）。看门狗 300s，所以是卡顿不是中止。
  `Promise.all` 保序且 `foundContent`（`:459`）与顺序无关 → 修法成立。
- **TDX MCP 失败静默吞掉** — **VERIFIED（行号更正）**
  `mcp.ts:261-264` 裸 `catch` 返回占位、文件内零日志导入；401 在 `:97`
  `throw new Error(\`TDX MCP HTTP ${resp.status}\`)`（`:114` 是 SSE 解析的 `catch { continue }`）。
  对比 `agents.ts:385,408,420` 都先 `warn`。修：catch 内补一条 `warn`（含 ticker 与错误）。

### CI / 打包
- **release 正文由两个 job 各写一份，后完成者覆盖** — **VERIFIED（观感级）**
  `release.yml:188`（desktop）与 `:309`（android）；android 版是严格超集（多 `.aab` /
  Play App Signing 段）。`action-gh-release` 修改同 tag 的既有 release，
  `files:` 合并、`body` 不合并；两个 job 都 `needs: test`，无顺序保证。
- **版本一致性脚本 17 行重复两份** — **VERIFIED（根 package.json 处无后果）**
  `:90-106` 与 `:238-254` 逐字节相同，只校验 `desktop/package.json`、`app/package.json`、
  `app/app.json`；根 `package.json:3` 是 `0.1.11` 但 `"private": true` 且无产物消费其版本
  → 漂移无后果，属卫生项。两块都带 `if: startsWith(github.ref,'refs/tags/')`，
  `workflow_dispatch` 下零版本校验。
- **顶层 `contents: write` 未在 build job 收窄** — **NUANCED（无 token 外泄面）**
  `release.yml:9-10` 是 workflow 级 write，desktop（`:57`）与 android（`:213`）未声明
  `permissions:` —— 机制成立。但全文 `GITHUB_TOKEN`/`github.token`/`token:` **零命中**，
  两个 checkout 都 `persist-credentials: false`（`:63-66`、`:219-222`）→
  `npm ci`/`expo prebuild`/`electron-builder`/`gradlew` **读不到** token。
  暴露面仅限「同 job 内某个被钉死 SHA 的 action 被攻陷」。另：原建议「build job 收到 read」
  **不成立** —— 发布动作就在 build job 内，正确修法是拆出独立 `publish` job。
- **`chart:check` 守护已提交产物，但无人跑** — **VERIFIED**
  `app/package.json:35` → `tools/check-chart-view.mts`（严格逐字节比对，`finally` 还原工作树）；
  `.github/` 与 `test/` 均零引用。编辑 `tools/build-chart-view.mts` 而不重生成，
  会把陈旧 WebView HTML（`useChartWebView.ts:17`）发出去且全绿。

### 测试
- **`chartData-sort` 断言在遍历自身输出的循环里** — **NUANCED（其余指控不成立）**
  循环确在 `test/chartData-sort.test.ts:15-17`、`chartData.ts:61` 文档化空报告返回 `[]`，
  所以「回归让两条序列一起消失 → 零断言执行」。但
  (a) `expect(times).toEqual([...times].sort())` **不是**自证 —— 复制后排序比对是标准的
  升序检查，且 `'YYYY-MM-DD'` 串的字典序正是对的比较器；
  (b) 这类回归**不会**整体走绿 —— `chartData.test.ts:75-76,125-126,136,141,148-152`
  已钉住 label 与点集。残余只差一句 `expect(series.length).toBe(2)`。
- **`KEEP_ALIVE_GRACE_MS` 从未被钉住** — **VERIFIED（小项）**
  `test/keep-alive-grace.test.ts:3` 导入、`:28` 用 `GRACE-1`、`:33/:41` 用 `GRACE+1000`；
  「90s」只出现在注释（`keepAliveGrace.ts:1`）与用例标题（`:22`）。
  改成 `10_000` 或 `21_600_000` 仍全绿。修：`expect(KEEP_ALIVE_GRACE_MS).toBe(90_000)`。
- **RN shim 无测试** — **VERIFIED（范围比原判更大）**
  `test/` grep `polyfill|net-shim` 零命中；`app/lib/async-hooks-shim.ts` **也没测**。
  但修法要分情况：`net-shim.ts:22-32` 是可抽纯函数的参数归一（注意它 import
  `react-native-tcp-socket`，需 mock），`polyfill.ts` 是纯副作用全局补丁，抽函数才干净。

---

## 3. P3

| 位置 | 问题 | 裁决 |
| --- | --- | --- |
| `src/agents.ts:282-298` vs `src/billionsTools.ts:26-41` | 三个格式化函数近乎复制且**双向**分叉：agents 少 `Array.isArray` 守卫（`agents.ts:287,291`，对方在 `:29,:33`）、日期用真值判断（`:312,339` vs `:57,:90` 的 `!== undefined && !== null && !== ''`）、`extra` 反而接受数组（`:305-307` vs `:43` 拒绝）；反向地 agents 对非数组 `result` 返回 `[]`（`:284-285`）而 billionsTools 会抛。两份都是模块私有，今天是维护问题不是运行时问题。建议抽 `src/billionsFormat.ts`（避免与 `committee` 形成新环）。 | **VERIFIED**（引用行号普遍偏 2–6 行） |
| `src/agents.ts:58-62` / `:89-93`；`:498` / `:524` / `:552` | 替换链逐字相同（`{system_message}`→`{market_cycle}`→`{market_rules}`→`{current_date}`，仅 `market` vs `this.market`，而 `:80` 就是同参赋值）；三专家报告块 `:498`/`:524` 逐字节相同，`:552` 差 `\n${info}\n` 与缩进 + 表头措辞。`agents.ts:4-5` 明确「查询模板容错空白、system prompt 必须逐字节」→ 漂移风险成立。 | **VERIFIED** |
| `IndicatorChart.tsx:126,:369`、`FinancialTrendChart.tsx:34,:142`、`DataScreen.tsx:26,:229` | `makeStyles(theme)` 在渲染体内调用；RNW 的 `Dimensions` 每次 resize 造新对象并通知所有监听者（`useWindowDimensions` → `setDims` → 一次重渲染）。但 IndicatorChart 的样式表只有 **6 个 key**（`:369-381`），插入规则按选择器去重（`createOrderedCSSStyleSheet.js:110-121`）→ 每次 resize ≈ 6 次分配，是 GC 噪音不是热点；且 60Hz 只发生在 web 拖拽，安卓只随旋转/分屏触发。`theme.ts:29` 是模块常量 `light`，提模块作用域安全。 | **NUANCED**（成本远小于原判） |
| `src/pipeline.ts:221` / `:250`；`:264-270` | 重复读：`:221` 已有 `deps.reports ?? store.getPerformanceReports(ticker)`，`:250` 又读一次 —— 但**仅在** `deps.reports` 未注入且 market ≠ cn 时。`safe()` 与 `safeProgress` **不是**逐字相同：后者在 `src/progress.ts:20-26`（不是 `46-53`，那是 `safePushDelta`），`safe` 少 `export ` 且 catch 注释不同。合并建议仍成立。 | **NUANCED** |
| `app/lib/analysisController.ts:246` | `runner.subscribe` 的退订函数被丢弃、无 `dispose()`（`PipelineRunner.subscribe` 声明返回 `() => void`，`src/events.ts:53-54`）。双控制器会双处理事件并**各起一行**（`:954` `at = d.isoNow()`、`:517` `newRunId(at)`，不是 upsert）。但今天不可达：唯一构造点是 `useAnalysis.ts:119` 的 `useMemo(..., [])`，`App.tsx:76` 单次使用，`useAnalysis.ts:243` 明写「根 hook 常驻不卸载」，且 `app/` 无 `<StrictMode>`。属未来防呆。 | **NUANCED**（不可达） |
| `src/indicators.ts:246` | 只把 `NaN` 转 null。原举报路径（`shares=0`）**不可达**：`pipeline.ts:129-131` 只在 `liutongguben > 0` 时传 shares，`DataScreen.tsx:85` 根本不传。真可达路径是 **close=0** → `calcLiuBias`（`:216-219`）→ `-Infinity` → `fmtNumber`（`pipeline.ts:17`）只防 `isNaN` → 提示词出现 `-Infinity%`（`trendIndicatorsText`，`:136-160`）。后果是文本污染，图表侧已过滤非有限值。 | **NUANCED** |
| `src/gates.ts:46-48` | 候选季度末只有 `0331/0630/0930/1231` 且要求精确相等 —— 硬编码确实存在。但原举报的 AAPL 后果**错误归因**：`collector.ts:41` 对 hk/us 直接置 `skipF10 = false`（`:26-27` 注释：Yahoo 全量拉 + PK 幂等），门算完即被丢弃；F10 本身是 CN-only（`pipeline.ts:248-250`）。CN 的 `report_date` 来自 A 股 F10 期间（`reports.ts:117`），是日历季度末，门可满足。→ 潜在缺陷，无描述的额外抓取。 | **NUANCED** |
| `src/store-file.ts:334`、`store-idb.ts:316`、`store.ts:186,233`（+ `app/lib/desktopBridge.ts:166`） | 四处（第五处漏报）都取 `fresh[fresh.length-1].date`。但仓库内所有 bar 源都已排序（`tdx/quoteClient.ts:57`、`deviceYahooCollect.ts:206`、`proxies.cjs:398` 原样透传、demo 数据升序）；去重基线用的是 `MAX(date)`（`store.ts:170-176`）或既有末根（`store-file.ts:328`、`store-idb.ts:308`、`store-memory.ts:29`），**不是**这个戳 → 「0 = 全重复」契约未破；唯一消费者 `gates.ts:53-54` 失败即重取（fail closed）。 | **NUANCED**（不可达） |
| `src/store-file.ts:219-221` | 读侧失败只 `logError`，无写侧 `getLastPersistError()` 那样的信号；损坏文件看起来像新股票，下一轮采集覆盖。 | ○ 未验 |
| `app/lib/analysisController.ts:58` vs `:60` | 注释写「120s 远大于最长正常停顿」，常量是 300s。 | ○ 未验 |
| `app/App.tsx:207`、`:176-183`；`HistoryPanel.tsx:87-91,239`；`App.tsx:275-283` | 主 CTA 只有 `style/disabled/onPress`，无 `accessibilityRole`/`accessibilityLabel`，也缺 `accessibilityState={{disabled}}`（同级 `:196-198,213,305,309,314` 都有）；代码框无 `accessibilityLabel`、`returnKeyType`、`onSubmitEditing`（`app/` 全局无 `onSubmitEditing`），单行默认 `blurOnSubmit` → 回车只是收键盘。实算：`fontSize:16` 行盒 ≈19–22 + `paddingHorizontal:4` → 宽≈24，加 `hitSlop 8` → **≈40×35–38**（原判 43×35 偏大）；**web 端 hitSlop 被丢弃**（RNW `Pressable` 无 `hitSlop`）→ 触摸盒仅 24×19。`marketOption` `paddingVertical:9`×2 + `fontSize:13` 行盒 ≈17 → **≈35dp**，无 hitSlop。两处均低于 44dp。 | **VERIFIED**（数值微调） |

---

## 4. 对既有「待办」的两处更正

- **`server-static.test.ts` 在有真实 `app/dist` 的机器上自跳过** —— **已过期**。
  `test/server-static.test.ts:79-116` 已改为注入 `mkdtemp` 出来的 dist 根，两分支恒跑。
- **`analysis-controller-history.test.ts` 死代码 + 先使用后声明（S7-3）** —— **不可复现**。
  通读约 530 行，所有 `let …!` 声明均在使用点之前。如确有其实，请给出具体行号。

---

## 5. 复核确认无问题的部分

- **编排**：每次 run 新建 graph 与 `MemorySaver`（`src/committee.ts:262`），固定
  `thread_id:'1'` 不会回放旧状态；工具计数工厂级、`assembleTools` 每轮重建
  （`analysisController.ts:881`）；`billionsClient` 刻意不重试（`:174-176`）；
  `cappedCall`（`billionsTools.ts:127-145`）为工具扇出设界；`progress.ts:46-84` 的静默
  catch 是为对齐 Python 的刻意降级。
- **指标数学**：`rollingMean/rollingStd/rollingExtreme` 为 O(n·w)，渲染路径无 O(n²)；
  零窗口 VOL_RATIO、全平 KDJ、`atr>0` 守卫齐备；`chartHtml.ts:89-99` 与
  `chartLayout.ts:26-36` 手工镜像仍逐式一致；`LEGEND` 颜色全引用 `C` 常量，
  线色漂移在结构上不可能。
- **UI 结构**：`DataScreen` 是 `React.memo` 且图表数据经 memo（`DataScreen.tsx:23,27,78,88,89`）；
  `App.tsx:60` 已 memo `makeStyles`；`useChartWebView` 的 `source` 是模块常量并按
  `AppState` 门控注入；抽屉/BackHandler 叠退正确；`SettingsPanel` 有挂载守卫与请求
  seq 守卫；状态 chip 以文案而非纯颜色区分。
- **测试**：无一处 `vi.mock`，全部注入式假件；11-08 修的三处「假绿」确实具备变异抵抗力
  （`indicators.test.ts:22-45` 逐格对夹具 + `checked` 计数；`qfq.test.ts` 对 5835 根；
  `architecture.test.ts:44-57` 的 `COLLECT_FLOORS`）。
- **供应链**：第三方 action 全部 SHA 钉死；`cache-dependency-path` 覆盖三份 lockfile；
  每个 checkout 都有 `persist-credentials: false`；`if-no-files-found: error` 已生效；
  `configure-android-signing.mjs` 只打印 env 变量名，不回显值。

---

## 6. 未纳入清单的观察

- `check-latest: true`（`ci.yml:39`、`release.yml:32,82,231`）让 Node 22.x 补丁号在 CI 与
  release 之间不可复现。
- `package.json:6-8` 声明 `engines.node >= 22.23.4`，但无 `engine-strict`（`npm ci` 只警告）。
- `ci.yml` 从不跑 `electron-builder`，`desktop/electron-builder.yml` 的配置错误仍要等一次
  完整失败的发版流程才暴露。
- `tools/restore-app-tsconfig.mjs:15-49` 内嵌 `app/tsconfig.json` 全文副本，无漂移断言
  （当前一致）。

---

## 7. 裁决明细

| # | 条目 | 裁决 | 关键反证 / 修正 |
| --- | --- | --- | --- |
| 1 | §0 chip 重试中 | VERIFIED | `done` 分支不写 `statuses`；`degraded` 只翻 `hasDone` |
| 2 | §0 无密钥扫描 | VERIFIED | `.github/` 五类扫描器全零命中 |
| 3 | §0 烟测仅 Linux | VERIFIED | 断言的是 `linux-unpacked` + `xvfb-run`，win/mac 无替代断言 |
| 4 | §0 APK 签名降级 | VERIFIED | 行号更正为 `configure-android-signing.mjs:214-219` |
| 5 | §0 无 concurrency | VERIFIED | grep 零命中，且同 run 内两 job 已互相覆盖 body |
| 6 | P1-1 孤儿事件 | VERIFIED | 门比的是处理器 seq，非事件来源；事件无身份 |
| 7 | P1-2 21 次请求 | VERIFIED | 精确为 7×3；OpenAI SDK 已被钉成 0 次 |
| 8 | P1-3 body 超时 | **NUANCED** | undici 默认 socket 超时可能兜底；契约不成立是真的 |
| 9 | P1-4 release 缺 app tsc | VERIFIED | 根 tsconfig include 不含 app |
| 10 | P1-5 e2e 未接线 | VERIFIED | `web-e2e.mjs` 硬性要 `app/dist`，恰好已产出 |
| 11 | P1-6 markdown 重解析 | VERIFIED | 库每次渲染新建 markdown-it，`:185` 无条件 parse |
| 12 | P1-7 盘中 bar | VERIFIED | validator 提级 P1；仓库 spec 已记录同类 |
| 13 | §2 设置写入静默 | VERIFIED | 文件内连日志都没导入；`:134-137` 是空操作 |
| 14 | §2 historyLoading | **NUANCED** | 消费面只有灰化图标与「载入中…」；`openRun` 自有 seq 守卫 |
| 15 | §2 历史列表重渲染 | VERIFIED | 三因叠加；仅加 `useCallback` 不够 |
| 16 | §2 键盘吞首点 | **NUANCED** | 仅 Android/iOS；RNW 该分支被注释掉 |
| 17 | §2 K 表 360dp | **NUANCED** | 值换行、表头不换行（33dp < 37.4dp） |
| 18 | §2 图表重建 | **NUANCED** | 每次采集完成一次，非每进度事件；30 个 series |
| 19 | §2 图表无失败路径 | VERIFIED | 库抛错在 production 保留；触发可构造非已观测 |
| 20 | §2 红绿规则两份 | VERIFIED | 无测试 import `app/components` |
| 21 | §2 hydrate 丢历史 | **NUANCED** | 仅 FileStore；IDB 行级增量；需 ready 前 start |
| 22 | §2 基本面陈旧戳 | **NUANCED** | `overviewLastUpdate` 无生产消费者 |
| 23 | §2 串行 prefetch | VERIFIED | 3×25s（含 twitter 约 100s），看门狗 300s 不中止 |
| 24 | §2 MCP 静默 | VERIFIED | 行号更正 `mcp.ts:97`；文件零日志导入 |
| 25 | §2 release 双 body | VERIFIED | android 版是严格超集，files 合并不合并 body |
| 26 | §2 版本块重复 | VERIFIED | 根 package.json `private:true` → 漂移无后果 |
| 27 | §2 token 权限 | **NUANCED** | 全文无 token 传递；「收到 read」的修法不成立 |
| 28 | §2 chart:check 未跑 | VERIFIED | `.github/` 与 `test/` 均零引用 |
| 29 | §2 chartData-sort 用例 | **NUANCED** | 复制后排序比对是标准写法；`chartData.test.ts` 已覆盖 |
| 30 | §2 keep-alive 常量 | VERIFIED | 改 10s / 6h 仍全绿 |
| 31 | §2 shim 无测试 | VERIFIED | 另漏 `async-hooks-shim.ts`；两文件修法不同 |
| 32 | §3 格式化函数复制 | VERIFIED | 分叉是双向的；行号偏 2–6 行 |
| 33 | §3 systemText/报告块 | VERIFIED | 无第三份拷贝；空白差被 `agents.ts:4-5` 明确容忍 |
| 34 | §3 makeStyles | **NUANCED** | 6 个 key + 选择器去重 → GC 噪音；60Hz 仅 web |
| 35 | §3 pipeline 重复读/safe | **NUANCED** | 条件更窄；`safeProgress` 在 `progress.ts:20-26` 且非逐字相同 |
| 36 | §3 subscribe 未退订 | **NUANCED** | 今天不可达（`useMemo([])`、无 StrictMode） |
| 37 | §3 computeAll Infinity | **NUANCED** | `shares=0` 不可达；真路径是 close=0 |
| 38 | §3 F10 季度门 | **NUANCED** | hk/us 的门被丢弃；F10 是 CN-only |
| 39 | §3 lastDataUpdate 尾元素 | **NUANCED** | 所有源已排序；去重基线用 MAX(date) |
| 40 | §3 a11y 与点击区 | VERIFIED | 实算 ≈40×35–38；**web 端 hitSlop 被丢弃** |
| 41 | `app/lib/request-gate.d.cts` 未使用（knip 报告） | **REFUTED** | 它是 `test/request-gate.test.ts:5` 引 `request-gate.cjs` 的类型来源；`tsconfig.json:17` include `test/**`、无 `allowJs`、`strict:true` → 删掉 `npm run typecheck` 会红。**不要删** |

未送验的小项：§2 拆分缝（设计建议）、§3 读侧失败信号、§3 看门狗注释、§0 `ci.yml` 过期注释。

---

## 8. 修复进度（2026-11-09 全部批次完成）

| 批次 | 提交 | 内容 |
| --- | --- | --- |
| B1a | `2f9aa8d` | P1-2 `maxRetries:0`；P1-4 release 补 app tsc；P1-5 CI 接 web e2e |
| B1b | `9bdd6da` | P1-1 事件带 `runTag`（孤儿运行不再污染下一轮）+ 变异验证用例 |
| B1c | `f2a4f62` | P1-3 `readBodyWithTimeout` + 客户端→代理跳超时；P1-7 盘中残缺 bar 不盖新鲜戳 |
| B2 | `d3bbd21` | `degraded` 终态（chip 不再「重试中」）、信息面并发预取、MCP 降级留痕 |
| B3 | `097b754` | 设置保存可见、流式渲染节流、图表失败态、历史 memo、键盘首点、K 表溢出 |
| B4/B5 | `dc85563` | 发布说明单源、版本门去重+根包、`chart:check` 接线（并修出真实生成物漂移） |
| B4/B5 | `801ef64` | 测试补钉（宽限常量/序列长度/±7 天窗）、a11y、±Infinity、F10 窗口、样式表 memo |

每批均跑 `npm run typecheck` + `cd app && npx tsc --noEmit` + `npm test`；最终
**841 passed / 1 skipped，两层 typecheck 0 error**。

### B6 结构重构进度（用户选择 B6-full）

已拆（每步独立提交 + 全绿门禁）：

| 提交 | 内容 | 结果 |
| --- | --- | --- |
| `410785e` | `src/billionsFormat.ts` | 两版分叉的格式化函数收口，守卫取并集 |
| `0d32e44` | `app/lib/runWatchdog.ts` + `app/lib/analysisNotifier.ts` | 时钟/回调注入，新增 5 例看门狗单测 |
| `63ec880` | `app/lib/eventReduce.ts` | 事件折叠纯函数化，副作用留控制器；7 例单测 |
| `7e00374` | `app/lib/startGuards.ts` | 输入校验 + 契约文案抽成纯函数；6 例单测 |
| `5eb1915` | `app/lib/historyController.ts` | 历史域整块迁出（含 `historySeq`/`historyListSeq`/`liveStash` 三份状态）；350 行带 CR-03/S5-1/S10-3/R-01/R-02/R-03/R-21 原注释 |

`analysisController.ts`：**1020 → 730 行**，**5 个接缝全部抽出**（看门狗 / 通知 /
事件归约 / start 守卫 / 历史域），另有 `src/billionsFormat.ts` 单源化。

真机复核（Android emulator，release APK，重构后重装实跑）：完整分析 5.4s、
历史列表落档、`openRun` 正文复现、`closeRun` 恢复实时态、`deleteRuns` 删除 —— 全部
走日志与 UI 双向确认，0 FATAL。

端到端两条链路已固化成工具（此前 Android 只有手敲 adb，属一次性验证）：

| 命令 | 覆盖 | 状态 |
| --- | --- | --- |
| `npm run e2e:web` | 打包产物加载 / demo 分析 / 7 chips / 抽屉 / 设置页 / 0 异常 | ✅ 重构后重跑通过 |
| `npm run e2e:android` | 安装 release APK → 启动 → 点 CTA（断言 `content-desc`）→ 分析完成 → 0 FATAL → 7 chips → 抽屉 → 历史 → `openRun` → `closeRun` | ✅ 新增，本次实跑通过 |

「仍未做」清单已收口到下方【仍未修】一节（本节旧列表重且编号断层，移除）。

### 仍未修（2026-11-10 当日收尾，`HEAD = cd40708`）

`2026-11-09` 原清单里的 B6 结构化重构与后续 R1-R4 **已全部做完**：

| 原待办 | 现状 | 证据 |
| --- | --- | --- |
| `analysisController.ts` 1011 行拆 5 段 | ✅ 730 行，5 接缝全出 | `0d32e44` / `63ec880` / `7e00374` / `5eb1915` |
| `billionsFormat.ts` 单源化 | ✅ 已抽 | `410785e` |
| 图表建一次 + 更新拆分 | ✅ 两个组件已拆 | `df778a5` |
| `net-shim` / `polyfill` / `async-hooks-shim` 测试 | ✅ 参数归一抽出 + 33 例 | `cd40708` |
| `store-file.ts` 读侧失败信号 | ✅ `getLastLoadError` | `86f24ee` |
| `src/agents.ts` 去重 | ✅ 三个纯函数单源 | `152001e` |

真实运行实证（非纯单测）：

| 面 | 方法 | 结果 |
| --- | --- | --- |
| 图表拆分 | Chrome DevTools（CDP）探针：两轮完整分析后比对 chart 宿主 DOM 节点身份 | 第二轮仍是第一轮那两个节点 → 未重建；图表区域截图逐像素相同（0.000000%）；切走/切回正常重建 |
| net-shim 新参数归一 | Android release 真机跑一只从未采集的票（000001）强制走 TDX 直连 | 「采集完成：8488 根日K」3.5s |
| 整条安卓链路 | `npm run e2e:android` | 全绿（788.8s、0 FATAL、7 chips、openRun/closeRun） |

仅剩 1 项（**刻意不做**）：

1. **`release.yml` 拆独立 `publish` job**：需要新增钉 SHA 的 action 或 gh-CLI 管道，
   无法本地验证，只能靠一次真实 tag 推送检验；现状态是显式
   `permissions: contents: write`（正确但非最小权限）。

顺带修了 `tools/android-e2e.mjs` 两处假失败（`df778a5`）：`adb logcat -d` 的默认
1MB `maxBuffer` 截断导致目标行永远匹配不到；分析等待上限硬编码 180s（演示模式够用，
真实 LLM 完整跑实测 593-789s）→ 改 `SOA_E2E_ANALYSIS_TIMEOUT_MS` 可覆盖，默认 30 分钟。

### 另记：§0 的 5 条 CI 门禁缺口已补（`a737685`）

| §0 缺口 | 现状 |
| --- | --- |
| 两套 workflow 无 `concurrency:` | ✅ ci 取消旧 run；release 刻意不取消（避免半发布） |
| APK 签名无 `apksigner` 校验 | ✅ tag 发布检出 `CN=Android Debug` 即失败；dispatch 仅告警 |
| 无密钥/CVE 扫描 | ✅ 密钥半边已接（gitleaks v2.3.9）；CVE 半边需换源，`dependabot.yml:2` 记的镜像 advisory 404 仍成立 |
| 桌面打包烟测只跑 Linux | ✅ 全 OS 安装包存在性 + ≥20MB 断言；非 Linux 资源树只打日志（路径未验证过，不拿猜测硬失败） |
| `ci.yml:4-7` 表头注释过期 | ✅ 改为陈述现状 |

未做且仍成立：**`release.yml` 拆独立 `publish` job**（需钉 SHA 的 action 或 gh-CLI
管道，无法本地验证）；**AAB 的 v2/v3 签名方案校验**（`jarsigner` 只看 jar 签名，
不验证 apksigner 风格的 v2 签名方案）。
