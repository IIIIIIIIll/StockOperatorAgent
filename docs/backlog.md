# Backlog —— 未完成项台账

- **来源**：`docs/code-review-2026-11-19.md`（全仓 r3 评审，1×P0 / 18×P1 / 51×P2）+
  `docs/code-review-2026-11-09.md`、`docs/hk-us-cn-parity-gaps.md` 里「明确不做 / 仍开着」的段落。
- **为什么要这个文件**：r3 的 51 条原始分 lane 报告在 `.scratch/review-r3/lanes/`，
  而 `.scratch` 在 `.gitignore:33` 里。换机器 / 重新 clone 后那份证据就没了，
  `code-review-2026-11-19.md` 里「其余 40+ 条见 lanes/」会指向不存在的文件。
  本文件是它的持久化替代。
- **状态口径**：
  - `已修` —— 有代码锚点，可直接核对；
  - `仍在` —— 本次或此前复验过，缺陷还在；
  - `未复验` —— 2026-11-19 之后没逐条对过现状。**动之前先看代码**，别照抄行号。
- **复验基线**：`npx tsc --noEmit` 0 错；`npx vitest run` 全绿。

## 一、已经关闭（防重复劳动，先看这张表）

| 项 | 结论 | 锚点 |
|---|---|---|
| 前复权累计因子重复相乘（P0） | 已修，独立 oracle 对拍 5835 根 0.0000% | `src/adjust.ts`；`test/qfq.test.ts` |
| CN 链缺「盘中半根 bar」守卫 | 已修，三分支对齐 Yahoo 链 | `src/webCollect.ts:77-95` |
| 工具异常占位写死「联网搜索失败」 | 已修：占位带真实工具名 | `src/toolLoop.ts:134` |
| 工具输出进 context（C3） | **不做**（决策：token 富裕，不截断） | — |
| `store-node` 的 tmp+rename 缺 fsync | 已修：写 tmp → fsync → rename → fsync 父目录 | `src/store-node.ts` `nodeFsAdapter` |
| 设置文件明文含 API Key（桌面） | 已修：AES-256-GCM 信封 + safeStorage 托管 key | `src/store-node.ts` `encryptedSettingsFileSystem`；`desktop/main.mjs` |
| AAB 只跑 `jarsigner` 不看结果 | 已修：`-strict` 判退出码 + `keytool` 拒 debug 证书 | `.github/workflows/release.yml` |
| 三份 lockfile 停在 1.0.0 | 已修：统一 1.0.4，并入发版门禁 | `package-lock.json` 等 |
| CN 概览缺 52周高低 / 每股收益 → UI 恒 N/A | 已修：日K 算 52 周极值、F10 取 EPS | `src/overview.ts`；`app/screens/DataScreen.tsx` |
| `architecture.test.ts` 漏 `import 'node:x'` 形态 | 已修 | `test/architecture.test.ts:150,164` |
| e2e 里 `\|\| true` 让 check 永远打勾 | 已修（`grep -c` 为 0） | `tools/web-e2e-hk.mjs` |
| 提示词写 ±150/±200 而 pipeline 在 150 翻档 | 已修：统一 ±50/±150 | `src/prompt.ts:17` |
| README 版本码注释算错（11100） | 已修：10100 | `README.md:133` |
| `release.yml` 变更说明硬编码 v1.0.1 | 已修：按 tag 渲染 | `.github/workflows/release.yml` |

## 二、明确不做（决策记录 —— 不要重开）

| 项 | 理由 |
|---|---|
| 资金流 / 概念板块 / 南向资金（港美） | 免 key 源不存在；板块归属仍由 `assetProfile.sector/industry` 提供 |
| 港美领先能力「单向对齐」：券商目标价/评级、EPS 一致预期、下次财报日、内部人持股、真实 5 分钟涨速、公司画像文本 | 港美本来就有，CN 侧不需要为此补齐 |
| `toolLoop` 工具输出截断（C3） | 用户 2026-11-21 决定：token 预算充裕，不截断 |
| 公告 / 研报全文 | HKEX 条款禁止程序化抓取再分发，需先做许可判定 |
| AAB 的 APK Signature Scheme v2/v3 校验 | `.aab` 是 JAR，只能用 v1 方案签；v2/v3 是 APK 的方案，Play 收到后自己重签 —— 不存在可验的块 |

## 三、真墙（不是代码缺陷，缺源或缺许可）

| 缺口 | 为什么关不掉 | 需要什么 |
|---|---|---|
| 港股每手股数（board lot） | Yahoo 无该字段；CN 的 `LOT_SIZE=100` 对港股不成立 | HKEX 证券名单 CSV |
| HKD/CNY、USD/CNY 汇率换算 | 只有货币标签，无换算 | 任意免费汇率源 |
| 港股/美股 Q2/Q3 单季毛利率、ROE、每股现金流 | 东财没有对应单季行（口径纪律不允许拿半年值顶单季） | 付费源或港交所摘要 |
| CN 股息率 | 东财 F10 未接分红接口 | 东财分红送配端点或付费源 |
| 成交额（港美） | 已用东财 f57 补真值；仍缺的只有「无东财覆盖」的标的 | 第二数据源 |

## 四、待办清单（57 条，来自 r3 评审）
### 编排 / 取消链

| id | 位置 | 问题 | 状态 |
|---|---|---|---|
| C2 | `src/retry.ts:11-12 / src/agents.ts:112, src/toolLoop.ts:76` | Comment claims "`events.abort()` 现在会真正中断在飞请求与退避计时器", but no caller ever passes `RetryOptions.signal`: `return streamWithRetry(llm as StreamableLlm, payload, this.config, { onDelta: …, onRetry: … });`. So `sleepWithAbort(delay * 1000, undefined)` uses a plain timer and the per-chunk `throwIfAborted(signal)` (retry.ts:148) is dead code; post-cancel the loop still issues up to 3 upstream calls with 1s/2s/4s sleeps. | 已修（`agents.ts:119` 显式下传 `signal`） |
| C3 | `src/toolLoop.ts:118` | Tool output enters context with no cap: `messages.push(new ToolMessage({ content: String(content), tool_call_id: call.id }));` — 15 rounds of unbounded billion-fetch/web text, no per-item or total truncation (billionsTools caps only fetch at 3000 chars). | **未做（用户决定：token 富裕，不截断）** |
| C4 | `src/toolLoop.ts:115` | Every tool exception is reported as a web-search failure: `content = \`（联网搜索失败：${(err as Error).message}）\`;` — a failing billions search/fetch is fed back to the model as search breakage, pushing it to switch tools / burn rounds. | 已修（本次：占位文本带真实工具名） |
| C5 | `src/agents.ts:136, :179` | Non-string content is blind-coerced: `typeof response.content === 'string' ? response.content : String(response.content)` — array content blocks become `[object Object]…` and get pushed as the report; `retry.ts extractDeltaText` handles arrays, the report path does not. | 仍在：`agents.ts:126/141/184` 仍 `String()` |
| C6 | `src/prompt.ts:17 vs src/pipeline.ts:108` | Prompt tells the model zones are "±50/±150/±200 对应震荡/强势弱势/超买超卖", but the injected label flips at 150: `if (macdV > 150) return '超买';` — same report carries label and contradictory rule. | 已修（提示词改为 ±50/±150，与 `pipeline.ts:108` 一致） |
| C7 | `.trellis/spec/ts/agents-tools.md (AL2 ¶), .trellis/spec/ts/events-streaming.md` | Doc drift: spec says the closing-round fallback flips roleStatus to `'retry'`; code sets `conclusive ? 'done' : 'degraded'` (agents.ts:183). events-streaming.md still lists roleStatus as `running\ | 未复验 |
| C8 | `src/llm.ts:42-43` | Validation precedes sanitisation: `const baseUrl = (e.LLM_BASE_URL as string).trim(); if (!/^https?:\/\//.test(baseUrl))` — the exact NUL-prefix case the `sanitizeLlmValue` comment (:55-59) describes is rejected with the misleading "必须以 http:// 开头". | 仍在：`llm.ts:42` 先校验后 `trim` |

### 数据源 · CN 采集

| id | 位置 | 问题 | 状态 |
|---|---|---|---|
| D3 | `src/eastmoney/klineClient.ts:96、src/eastmoney/f10Client.ts:146` | `const resp = await Promise.race([fetch(url, ...), new Promise<never>(...setTimeout reject...)])` —— 计时器只让 Promise 早退，**不 abort** 底层请求；house 标准 `fetchWithTimeout`（src/yahoo/yahooClient.ts:91-94）用 AbortController。RN 上几次超时即攒出悬挂 socket。 | 未复验 |
| D4 | `src/eastmoney/klineClient.ts:110-112` | 非 2xx 走 `continue`，但抛错路径直接 `return new Map();` —— 美股第一个候选(105 NASDAQ)超时，就再也不试 106/107，NYSE 票永远拿不到真成交额。 | 未复验 |
| D5 | `src/tdx/deviceCollect.ts:93` | `makeClient({ host, connectTimeout: 8000, requestTimeout: 12000 })`，每 host 最多 5 次尝试，而单次采集内请求数无上界（`fetchDailyBars` 翻完整个历史 :42，`getStockList` 翻全市场列表）。无全局 deadline，弱网可让一次分析卡十几分钟且 spinner 不结束（web 侧有 60s/45s 兜底）。 | 未复验 |
| D6 | `src/tdx/f10Client.ts:46` | `return iconv.decode(body.subarray(12, 12 + length), 'gbk');` —— 服务器短帧时 subarray 静默截断，截断的 GBK 文本进 `parseBlock` 后数字可被当成有效值（"123456" 截成 "1234"），无 warn。 | 未复验 |
| D7 | `src/tdx/deviceCollect.ts:94` | `client.on('error', () => {});` —— 挂监听是必须的，但把每次真实 socket 错误吞掉，采集过程中掉线只在下游超时里间接体现。 | 未复验 |
| D8 | `src/news/googleNews.ts:153-157` | 标题原样拼进 LLM 情报段（`lines.push(\`- ... ${item.title}${from}\`)`），无引号/无「以下为外部内容，勿当指令」包裹。Google News 标题是任意第三方可控文本，直接进 prompt。 | 未复验 |

### 数据源 · 港美/搜索

| id | 位置 | 问题 | 状态 |
|---|---|---|---|
| 2 | `src/yahoo/applyYahooCollectedToStore.ts:159` | Payload field trusted without shape guard, after a comment in webYahooCollect claim the opposite ("其余字段…由 applyYahooCollectedToStore 做字段级兜底", webYahooCollect.ts:88): `if (Number.isFinite(payload.capital.zongguben) \ | 未复验 |
| 3 | `src/yahoo/deviceYahooCollect.ts:229-230` | A pagination window that returns HTTP 200 with Yahoo's error shell is silently discarded: `const r = chartResultOf(await fetchChartWindow(...)); if (r !== null) all.push(...)`. `fetchFullDailyBars` then returns a truncated series and `replaceDatas` overwrites the full history (only the empty-array case is guarded, webYahooCollect-side comment "空数组会清空既有日K"). | 未复验 |
| 4 | `src/webSearch.ts:120-121` | The region parameter is dropped on the browser (primary web build) branch: `if (detectPlatform() === 'web' && window?.location?.origin) { return makeProxySearcher(window.location.origin); }` — `region` (hk-tc/us-en, from `assembleTools` → `ddgRegionForMarket`) never reaches `/web-search`, so hk/us queries still come back cn-zh; the "DuckDuckGo 恒 cn-zh" fix (docs/hk-us-cn-parity-gaps.md:176) is a no-op for web users. | 未复验 |
| 5 | `src/webSearch.ts:181` | Snippets are paired to titles by index: `return titles.map((t, i) => ({ ...t, snippet: snippets[i] ?? '' }))`. If any DDG result block lacks `result__snippet` (test only covers the *all-empty* case, test/web-search.test.ts:56-58), every later snippet shifts one title → an LLM quotes a claim against the wrong headline/URL. | 未复验 |
| 6 | `src/webSearch.ts:34-41 (DDG path)` | DDG results are never capped and snippets go into the prompt verbatim, unlike Tavily's `max_results: 5` (:73): `lines.push(\`- ${parts.join('；')}\`)` after `parseDdgHtml` returns every result. Uncapped untrusted HTML-derived text reaches LLM context with no data/instrument marker → prompt-injection surface + context bloat. | 未复验 |
| 7 | `src/yahoo/composeYahooReports.ts:36-42 vs .trellis/spec/ts/hk-us-data.md:36` | Spec still states the opposite of the code: spec `// PerformanceReport[]; … QoQ 相邻期无 88-93 天门槛` while the implementation gates on it (`periodKindOf` → `gapKindOf(daysBetweenYmd(...))`). Two reviewers reading spec will call the current guard a regression. | 未复验 |

### 存储 / 日志

| id | 位置 | 问题 | 状态 |
|---|---|---|---|
| L4-3 | `src/store-idb.ts:206` | `for (const b of fresh) barsStore.put({ ...b, ticker });` — addDatas persists only the delta. A failed/aborted tx leaves those bars in memory and never on disk, and no later write re-sends them; FileStore rewrites the whole file so it self-heals (pinned by test/store-file.test.ts:278-286). test/store-idb.test.ts:221-228 asserts only the memory mirror, so the gap is unasserted. No production caller of `addDatas` today (only tools/), so it bites when the incremental path returns. | 未复验 |
| L4-4 | `src/store-idb.ts:150` | `list.push(b);` — hydrated rows come from `getAllRows(db,'daily_bars')` and already contain `ticker`; `getDatas()` (`{...b}`) therefore returns bars *with* an extra `ticker` key after a reload, but without it in the same session, and never in Store/FileStore/InMemory. Any `toEqual`/`JSON.stringify` bar comparison (pattern at test/device-collect.test.ts:128) breaks only post-reload. | 未复验 |
| L4-5 | `src/store-file.ts:303` | `await fs.writeFile(joinPath(baseDir, META_FILE), JSON.stringify(Object.fromEntries(this.meta)));` — all meta (per-ticker `f10:`/`capital:`/`yahoo-profile:`/`yahoo-annual:` + the full `soa:last-run` report) shares one JSON file, fully rewritten on every `setMeta` (7+ per analysis) and fully parsed at startup. Nothing prunes it; ~30 tracked tickers ⇒ hundreds of KB rewritten per write. | 仍在：`store-file.ts:303` meta 整文件重写 |
| L4-6 | `src/store-node.ts:41-47` | `await fsWriteFile(tmp, data, 'utf8');` / `await fsRename(tmp, path);` — no `fsync` of the file or the directory, so "atomic" holds for process kill only, not power loss (target can be empty after rename). Also tmp files are unlinked only on the error path, so crash residue accumulates forever (hydrate skips it, but nothing deletes it). | 已修（本次：写 tmp → fsync → rename → fsync 父目录） |
| L4-7 | `src/log.ts:155` | `file.write(`${line}\n`, { append: true });` — `formatLogLine` embeds the message raw. The server file transport scrubs `\r`/`\n` (`sanitizeLine`, logging.md), the RN sandbox does not, so a multi-line LLM/network error message forges extra timestamped lines in `soa-logs.log`. | 未复验 |
| L4-8 | `src/runHistory.ts:69` | `.replace(/^[#>\-*\s]+/, '')` — strips a leading minus, so a decision opening `-5.2% 才止损` becomes preview `5.2% 才止损` in the history list: a wrong number rendered as fact. | 仍在：`runHistory.ts:68` 正则吃掉行首 `-`（负号） |

### 财务数学 / 图表数据

| id | 位置 | 问题 | 状态 |
|---|---|---|---|
| A3 | `src/chartData.ts:104-105` | `if (grossMargin.length) series.push({label:'销售毛利率 (%)'}) else if (netWorthReturn.length)` — grossMargin is sourced only from F10 (`rec.metric !== '销售毛利率'` :91), yet `reports[].fields.sales_gross_margin` is populated for HK/US (src/yahoo/composeYahooReports.ts:181) and ignored, so HK/US always renders 净资产收益率 or N/A (acknowledged at docs/hk-us-cn-parity-gaps.md:16). | 未复验 |
| A4 | `src/indicators.ts:238` | `const turnover = vol.map((v) => (shares === undefined \ | 未复验 |
| A5 | `src/yahoo/quoteSummary.ts:76-77` | `if (typeof fmt === 'string' && fmt !== '') return fmt;` — any non-empty string is accepted as the report-period key; the same file's header warns that a divergent key makes period alignment “失配即静默产生 NaN”. A localized `fmt` (e.g. `3/31/2025`) silently kills QoQ/YoY join. | 未复验 |
| A6 | `src/format.ts:3-5` | `return /^\d{8}$/.test(d) ? ... : d;` — anything that is not exactly 8 digits is passed through unchanged, so `'2026-03-31 00:00:00'`/`''` reach lightweight-charts `time` (setData rejection, handled only by the failure overlay added at app/components/IndicatorChart.tsx:209-211). No validation, no log. | 未复验 |

### UI 渲染

| id | 位置 | 问题 | 状态 |
|---|---|---|---|
| L6-3 | `app/components/ReportContent.tsx:49-53` | Throttle bridges two different nodes: when `liveNode` flips 初稿→修订, `useThrottledText` still holds the previous node's text, and `{ ...partials, [liveNode]: throttledNode }` writes it under the 修订 node for ≤300ms → 「对抗修订」 briefly renders the 初稿 text. | 未复验 |
| L6-4 | `app/screens/DataScreen.tsx:114,120,124` | 单位后缀盖在 N/A 上：`${fmtNumber(...)}%` 渲染成 `N/A%`；`52周高低` 对 cn 恒 `N/A / N/A`（composeOverview 从不设 week_52_*） | 部分已修（本次：cn 已补 eps/52周高低）；`N/A%` 未修 |
| L6-5 | `app/screens/DataScreen.tsx:230` | 行内配色互相矛盾：收按 `close >= open` 上色，相邻涨跌幅按 `pct`（对前收）上色 —— 同一行可以红收 + 绿负涨跌 | 仍在（本次只提取了 `pctColor`，判据未统一） |
| L6-6 | `app/theme.ts:41` | `warn: '#b8860b',` on `#FFFFFF` is ≈3.3:1 — under the 4.5:1 threshold it is used at: 11px `statusChipText` (`无结论`/`重试中`), 12px gate notice, 12px progress hint. | 未复验 |
| L6-7 | `app/hooks/useAnalysis.ts:121` | Controller lives in `useMemo(...)` with no teardown, and its constructor does `deps.runner.subscribe(...)` (app/lib/analysisController.ts:239) throwing away the returned unsubscribe. Any App remount (Fast Refresh, root remount) leaves an orphan controller still folding every token event into its own state + keepalive grace timer. | 未复验 |
| L6-8 | `app/components/ReportContent.tsx:44` | `const styles = makeStyles(theme);` rebuilt on every render — i.e. on every 120ms token frame — while the identical pattern was fixed elsewhere (DataScreen.tsx:28, IndicatorChart.tsx:180 `React.useMemo`). Same at HistoryPanel.tsx:51, SettingsPanel.tsx:43. | 未复验 |

### App 运行时

| id | 位置 | 问题 | 状态 |
|---|---|---|---|
| S5 | ``app/lib/analysisController.ts:704`` | `if (this.timedOut) { this.timedOut = false; s.error = null; …` — runs on **both** branches of `finishDone`, so a late *degraded* done (watchdog already announced 中止, `s.hasDone=false`, nothing persisted) erases the only banner. User: no result, no error, no ✓完成. | 未复验 |
| S6 | ``app/lib/analysisNotifier.ts:53`` | `} catch { /* 订阅者异常不影响其他订阅者 … */ }` — subscriber throw swallowed with no counter/log, while the sibling broadcast path counts and warns (`src/events.ts:118-127`, S1-4). A React subscriber throwing on every frame freezes the UI with no trace. | 未复验 |
| S7 | ``app/lib/capabilities.ts:69`` | `if (!cached) cached = compute();` while the doc two lines up says "桌面桥在模块加载后才存在,故不在模块顶层求值" — yet `runner.ts:55` and `settingsStore.ts:196` both call it at module-eval. First call wins forever: a bridge that isn't in place on the first import silently pins `storageBackend:'idb'` / non-bridge settings for the whole session. `resetCapabilitiesCache()` exists only for tests. | 未复验 |
| S8 | ``app/lib/analysisController.ts:261`` | `s.error = '已取消分析'; s.statuses = {};` — `cancel()` clears statuses but not `partials`, so the aborted draft keeps rendering (`partial \ | 未复验 |

### 测试 / E2E

| id | 位置 | 问题 | 状态 |
|---|---|---|---|
| 8-2 | `tools/web-e2e.mjs:152` | "demo" premise is wrong when `app/dist` was exported from a tree with `.env` keys: `// demo 链路:浏览器 profile 是全新的 → 无 LLM 键 → 占位 LLM,秒级`. `app/lib/settings.ts:112` inlines `process.env.EXPO_PUBLIC_LLM_API_KEY` at build time, so a fresh profile still has real keys → a paid real-LLM run inside a 90s deadline, no `演示模式` assert (spec `.trellis/spec/ts/web-e2e.md` 2026-11-04 records this exact gotcha). | 未复验 |
| 8-3 | `test/architecture.test.ts:150 (also 164, 188)` | All three import contracts miss the side-effect form: `/(?:from\s*\ | 已修（正则补 `^\s*import\s+` 分支） |
| 8-4 | `tools/web-e2e-hk.mjs:261` | 交替（alternation）优先级比 intended 低，第二分支匹配任意 `行业\n…`：`check('画像行业 chip', /行业\nCommunication Services\|行业\n.+/.test(data), '')` | 已修（松散交替已按原文收紧）+ `\|\| true` 已删 |
| 8-5 | `tools/web-e2e-hk.mjs:216` | Passes while the market switch did nothing — the market button already renders a market label, so the string is in the body even if the option click missed: `check(\`市场切换为${MARKET_LABEL}\`, (await evalJs('document.body.innerText')).includes(MARKET_LABEL));` | 未复验 |
| 8-6 | `test/server-static.test.ts:133` | Breaches the documented isolation rule "no live port" (`testing.md`: "tested by importing the module and driving fake `req`/`res` objects — no live port"): `await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));` Same file also writes repo build output — `writeFileSync(file, '<!doctype html>…')` into `app/dist/index.html` (lines 25-30), shared cwd across parallel test files. | 未复验 |
| 8-7 | `test/turnover.test.ts:89 (also :90; pipeline.test.ts:162-164)` | Expected value recomputed with the source's own formula, so it cannot catch a factor change: test `toBeCloseTo((1000 * 1e4) / 1e10, 10)` vs `src/pipeline.ts:48` `return (b.volume * 10_000) / capital.liutongguben;`. Risk is contained because hardcoded values exist elsewhere in the same file (`'Turnover Rate: 1.12%'`, `'换手率: 1.124'`). | 未复验 |

### 构建 / 发版

| id | 位置 | 问题 | 状态 |
|---|---|---|---|
| B2 | ``tools/restore-app-tsconfig.mjs:19`` | `// 会报 [TSCONFIG_ERROR]。此处内联 expo SDK 57 tsconfig.base 全量选项;` — the committed `app/tsconfig.json:4` says **58**. The hardcoded `EXPECTED` restore silently writes the stale 57 comment back; nothing compares `EXPECTED` to the file. | 仍在：`restore-app-tsconfig.mjs:19` 注释仍写 SDK 57 |
| B3 | ``README.md:133`` | `node tools/derive-version-code.mjs 1.1.0   # → app/app.json 的 versionCode = 11100` — formula is `major*10000+minor*100+patch` (`1.1.0 → 10100`; `test/version-code.test.ts:11` pins `1.2.3 → 10203`). A release operator hand-verifying against this number sees a phantom failure. | 已修（README 现写 10100，与公式一致） |
| B4 | ``.github/workflows/release.yml:476`` | `## 本次变更（v1.0.1）` — hardcoded while the same job's gate requires the tag to equal `1.0.2`; every release body ships a heading for the previous version unless a human edits it. | 未复验 |
| B5 | ``package-lock.json:3` (`app/…:3`, `desktop/…:3`)` | `"version": "1.0.0"` in all three lockfiles vs `"version": "1.0.2"` in the four manifests. The release gate verifies four files but never the three lockfiles it `npm ci`s from, so this drift is invisible. | 已修（本次：三份 lockfile → 1.0.4，并加入发版门禁） |
| B6 | ``tools/web-e2e.mjs:31`` | `const ROOT = new URL('..', import.meta.url).pathname;` — percent-encoded (`/home/u/my%20repo/`), so `existsSync(join(ROOT,'app','dist','index.html'))` fails on any repo path with a space or non-ASCII char and reports "app/dist 不存在". Sibling scripts (`probe.mts`, `check-chart-view.mts`) use `fileURLToPath`. | 未复验 |
| B7 | ``tsconfig.json:19-21`` | `"include": ["src/**/*.ts","test/**/*.ts","tools/**/*.mts"]` — the five release-critical `tools/*.mjs` (`configure-android-signing`, `derive-version-code`, `web-e2e`, `android-e2e`, `restore-app-tsconfig`) are never typechecked or linted; a typo surfaces only on tag day. | 未复验 |
| B8 | ``desktop/child.mjs:192`` | `settings = null; // unreadable settings -> null (settingsStore silent-degrade parity)` — a corrupt `soa-settings.json` silently yields empty settings with no log line (`.trellis/spec/error-handling.md:124`: "Swallowing errors silently — always `warn`/`error` before degrading"). | 未复验 |

### 文档 / 契约

| id | 位置 | 问题 | 状态 |
|---|---|---|---|
| 4 | ``.trellis/spec/ts/web-e2e.md:92`` | Doc lists a fixed defect as still live: "错误终态后角色 chips 停留「分析中」不复位(statuses 未随 error 重置)". Code now resets: `app/lib/eventReduce.ts:84` `state.statuses = {};` with "#96:error 终态清角色 chips". A tester following the recipe will misread correct behavior as residue. | 未复验 |
| 5 | ``.trellis/spec/ts/events-streaming.md:22`` | Protocol comment drops a real status: "`roleStatus'… // running\ | 未复验 |
| 6 | ``.trellis/spec/ts/stores.md:110`` | Wrong method count, contradicted 40 lines earlier in the same file ("10 个同步方法") and in `desktop-ci.md:23` ("11 个 StoreLike 同步方法"): "11 个同步方法读本地镜像". `src/store.ts:63-73` = 10 members; `app/lib/desktopBridge.ts:119-198` implements exactly 10; `listStocks()/listMetaKeys()` exist only on FileStore (`src/store-file.ts:400,406`), not on DesktopStore. | 未复验 |
| 7 | ``.trellis/spec/ts/events-streaming.md:99`` | Proxy route table is incomplete — no `/news-feed`, although it is served and gated: `app/server.mjs:154` `if (req.method === 'GET' && req.url.startsWith('/news-feed'))`, handler at `app/lib/proxies.cjs:644`, gate list `app/lib/request-gate.cjs:20` `'/news-feed'`. `architecture.md` ("same-origin routes: `POST /llm-proxy/*`, `GET /tdx-collect`, `GET /web-search`, `POST /logs`") omits it plus `/tdx-mcp`, `/billions-proxy`, `/yahoo-collect`. | 未复验 |
| 8 | ``.trellis/spec/ts/env-switches.md:20`` | EXPO_PUBLIC direct-access whitelist lists 3 sites: "webSearch.defaultSearcher / deviceCollect.DEVICE_TDX_HOSTS / settings.ts loadSettings". Actual: 11 `process.env.EXPO_PUBLIC_*` reads in 10 `src/` files — `src/llm.ts:75`, `src/mcp.ts:218`, `src/news/googleNews.ts:170`, `src/webCollect.ts:118`, `src/yahoo/webYahooCollect.ts:52`, `src/billionsClient.ts:101`, `src/log.ts:94`, `src/webSearch.ts:80,124`, `src/tdx/deviceCollect.ts:34` — plus 4 in `app/lib/settings.ts`. Header comments at `src/log.ts:17`/`src/env.ts:4` still say "现行九处". | 未复验 |

## 五、复验方式

```bash
npx tsc --noEmit          # 0 error
npx vitest run            # 全绿
node --experimental-transform-types tools/desktop-probe.mts   # 桌面接线（含设置加密）
```

真 LLM E2E 单次 600–900s，`web-e2e-hk.mjs` 请设 `SOA_E2E_ANALYZE_MS=1500000`。
