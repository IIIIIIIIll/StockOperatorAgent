# 整改计划实施前审计(plan-audit)— 2026-08-23

- **对象**: `.trellis/tasks/08-23-review-remediation`(prd.md / design.md / implement.md)全部单元;HEAD `7543f6c`(计划后无代码改动,锚点即评审 HEAD `e4d8680` 现状)。
- **方法**: prd → design → implement → 00-review-report + 各切片报告(agents-llm / collectors / desktop-tools-ci / tests-quality / app-lib-ui / verify-wave2-core / verify-wave2-rn)读毕后,逐单元对当前源码 read/grep 取证;判定过 `.trellis/spec/guides/index.md` FP 三模式(问题不实/已覆盖=DROP、修法过度=ADJUST)。
- **只读声明**: 本审计未修改任何产品代码与计划文件;唯一写入为本文件。

## 判定汇总表

| 单元 | 判定 | 核心证据(file:line) | 设计调整 | 风险 |
|---|---|---|---|---|
| F1 hydrate 容错 + tmp/rename 原子写 | **NECESSARY**(细节 ADJUST) | 裸解析 `src/store-file.ts:107`/`:115`(hydrate :100-125 无 try/catch,首坏文件中断全循环);非原子写 `src/store-node.ts:24-26` 直写、`src/store-file.ts:145`/`:152` 经适配器整文件覆写 | 见 §1 | 低 |
| F2 requestSingleInstanceLock | **NECESSARY** | `desktop/main.mjs:281-306` whenReady 直接 mkdir/spawn,无锁;`createWindow :257-277` win 为局部变量 | 见 §2 | 低 |
| C2 finnhub 接超时 | **NECESSARY** | `src/finnhub/finnhubClient.ts:57` 裸 `this._fetch(url)` 无 signal;采集主干 await 入库前 | 见 §3 | 低 |
| C6 webSearch 直连超时 | **NECESSARY** | `src/webSearch.ts:45`/`:143`/`:157`/`:174` 四处裸 fetch;server 侧仅 `app/lib/proxies.cjs:335`/:356-361 有 20s race 且不取消底层 | 见 §3 | 低 |
| C3 invalidateA3Cache | **NECESSARY**(方案选择 ADJUST) | 缓存无失效:`deviceYahooCollect.ts:58`/:63-72;401 只清实例字段 `yahooClient.ts:170-171`;provider-first 短路 `:210-214`;三注入点 `:396-397`/`proxies.cjs:269-270`/`probe.mts:154-155` 捕获同一陈旧闭包值 | 见 §4(**闭包捕获陷阱**) | 中(选型不当则修复无效) |
| AL2 收尾轮兜底 | **NECESSARY**(修法取舍 ADJUST) | `src/toolLoop.ts:107-113` 收尾轮零校验;下游 `src/agents.ts:163-166` 直接 pushReport+done | 见 §5 | 低 |
| D15 hasDone 消费 | **NECESSARY** | 生产链就绪 `analysisController.ts:162`/:290/:451/:455;App 零消费 `App.tsx:269-277`;**restore 置位点不存在**(hasDone 写点 grep 仅上述四处,:223-246 无) | 见 §6 | 低 |
| TQ1 us+finnhub 正向用例 | **NECESSARY** | 注入缝现成:`test/analysis-controller.test.ts:70`(collectCalls 记录器)/`:81`(settings 可注入)/唯一断言 :240 为负向 cn | 直接可做 | 极低 |
| TQ2 validators 真值表 | **NECESSARY**(方式 ADJUST) | `desktop/child.mjs:170-217` 校验表;**:54-62 argv 门 `process.exit(1)` + :294 `main()` 顶层执行 → 直接 import child.mjs 会杀死测试进程,独立文件为必选项** | 见 §7 | 中(tsconfig/模块解析) |
| TQ5 live.integration 结构化 | **NECESSARY** | `test/live.integration.test.ts:32-35` 钉死 `toBe(67)`/'20260710'/fenhong=10.03 | 直接可做 | 极低 |
| CI 测试门 workflow | **NECESSARY**(触发器 ADJUST) | `.github/workflows/` 仅 release.yml(`on: push: tags v*`,:3-6),无测试步骤;脚本实证 `package.json:7-8` | 见 §8(双跑协调) | 低 |
| 漂移清理 + 死导出 | **NECESSARY**(计数勘误) | configError 定义 `app/lib/runner.ts:176-179` 全仓零消费;proxyUsed `settings.ts:182` 写 :190 后零读取;注释失真逐条证实(§9) | 见 §9 | 极低 |

**总判定: 9 单元全部 NECESSARY,零 DROP,零 FP;其中 6 单元带必须落实的设计调整(C3 选型、AL2 取舍、TQ2 方式、CI 触发器、F1/D15 细节)。计划可直接执行。**

---

## §1 F1 — 锚点成立;expo API 支持原子替换;与 enqueue 无冲突

**(a) 锚点复核 ✓**
- hydrate 裸解析: `src/store-file.ts:107`(meta)/`:115`(ticker 文件),循环体无 try/catch,首个坏文件抛出沿 `ready()`(:85-88 `readyPromise ??=`)**缓存 rejection**,此后每次 ready 复现。
- 写路径非原子: ticker/meta 均经适配器 `fs.writeFile`(:145/:152)整文件覆写;Node 后端 `store-node.ts:24-26` 直接 `fsWriteFile(path, data, 'utf8')`;expo 后端 `store-file.ts:54-58` `f.write(data)` 同为直写。评审 F1 的「坏文件 → child fatal exit(:220-221 裸 await ready)→ main.mjs :157 app.quit() → 重启复现」链路各环节与当前源码一致。

**(b) expo-file-system 实际 API 支持 ✓**
- SDK 57 真包 `app/node_modules/expo-file-system/build/internal/NativeFileSystem.types.d.ts:186`/:194:`copySync(dest)`/`moveSync(destination, options?)` 在 PublicFile 上存在。
- `build/File.types.d.ts:17-23`:`RelocationOptions = { overwrite?: boolean }`,**默认 false** → tmp→dest 替换必须显式 `{ overwrite: true }`(否则目标已存在时抛错——实现最易踩的坑)。design 提的「delete+move」退路有一瞬文件缺失窗口,劣于 overwrite 原子替换,不作首选。
- 本地镜像声明 `src/expo-file-system.d.ts:15` 目前是 `moveSync(destination: File): void`(**无 options 参数**)→ 实现时需按真包签名扩写镜像(该文件头注明示允许:「镜像 SDK 57 真实 API 中我们用到的面」)。

**(c) 与 enqueue 队列语义不冲突 ✓**
- 原子化放在**两个生产适配器内部**(store-node 的 nodeFsAdapter.writeFile / store-file 的 expo writeFile),`FileFsAdapter` 三方法签名不变 → 串行队列、失败仅记录(决策 C)、以及既有注入 fake(`test/store-file.test.ts:16-36` nodeAdapter/flaky adapter)**全部零改动**。
- tmp 命名 `${path}.tmp.${pid/random}` 不以 `.json` 结尾 → hydrate 的 `name.endsWith('.json')` 分支(:111)与 META_FILE 精确匹配(:104)自然跳过残留 tmp,无需清理也安全(可选在 hydrate 顺带清扫,非必需)。

**(d) 测试落点提示**
- hydrate 容错: FileStore + 注入 adapter 构造截断 JSON → 跳过 + 其余文件可用(logError 断言),缝已备好。
- **tmp+rename 断言只能落在 store-node 侧**(直调 `nodeFsAdapter(dir).writeFile` 后断言终态文件存在且无 tmp 残留);expo 分支 vitest 解析不到真包(d.ts 仅为类型面),只能 tsc 对镜像 + 走查——implement.md 回滚点已预此降级,符合现实。

## §2 F2 — 两处结构适配点;whenReady 流程无实质冲突

- 锁获取位置: design 说「whenReady 最前」。可行,但**更稳是模块顶层(app 导入后立即)**: 第二实例连 mkdir/spawnChild 都不执行,也是 Electron 文档的标准 pattern。放 whenReady 内亦正确(该回调先于 :286 mkdirSync 与 :288 spawnChild,失败 quit 无任何残留物)。二选一皆可,**硬约束只有一个: 先于 :286-288 的目录创建与 child 启动**。
- 适配点 ①: `createWindow`(:257-277)的 `win` 是局部变量 → `second-instance` 要聚焦已有窗口,需提为模块级引用(如 `let mainWindow`,`closed` 时置 null)。小重构,无行为影响。
- 适配点 ②: 锁失败分支 `app.quit()` 早于 child/window 创建,shutdownChild/window-all-closed 均无可清理物,SIGTERM/SIGINT handler(:316-317)对 null child 已容错 → 无冲突面。
- 验收注意: AC2 允许「测试或手动验证记录」;desktop 层无 vitest(TQ2 已证)→ 本单元实际交付形态应为**手动双开验证记录**,implement.md 未写明,建议补一句防验收争议。

## §3 C2/C6 — fetchWithTimeout 已导出可直接复用;20s 合理但两处措辞级修正

**(a) 导出形状 ✓ 无需新导出**
- `src/yahoo/yahooClient.ts:73-91` `export async function fetchWithTimeout(fetchImpl, url, init?, timeoutMs = YAHOO_REQUEST_TIMEOUT_MS)`;`deviceYahooCollect.ts:25`/`:66` 已有消费先例。finnhubClient/webSearch 新增 import **无环**(yahooClient 不反向依赖两者;纯 TS fetch-only,进 metro 图安全)。
- C2 即把 `finnhubClient.ts:57` 改 `fetchWithTimeout(this._fetch, url)`(默认 40s 对齐采集链标准);超时异常落 companyProfile2 的 catch(:58-61)归一为 FinnhubApiError(status_code=null) → 调用方降级语义不变。

**(b) ADJUST-1: 超时文案硬编码「Yahoo 请求超时」**
- `yahooClient.ts:85` 抛 `YahooApiError('timeout', null, 'Yahoo 请求超时(…s)')`。接到 finnhub/DDG 后会产出「Finnhub 请求失败：Yahoo 请求超时」「web 搜索失败：Yahoo 请求超时(20s)」类误导文案(server /web-search 502 body 直透 err.message,`proxies.cjs:364`;agent 占位文本同样携带)。低成本选项: ① 调用方 catch 内识别 `exc instanceof YahooApiError && exc.code === 'timeout'` 重写消息;② fetchWithTimeout 加可选 label 参数。任取其一,**不可不改**(用户可见面)。

**(c) ADJUST-2: 「webSearch 20s 与 server race 一致」表述精确化**
- server 的 20s race(`proxies.cjs:335` SEARCH_TIMEOUT_MS=20_000,:356-361 Promise.race)是**整个 searcher 调用**的上界;ddgSearcher 直连链最多串 3 个请求(html → vqd → news.js,`webSearch.ts:172-183`)→ 每请求 20s 的内部上界 = 全链最坏 ~60s。仍满足「有界 settle」目标,server 路径客户端依旧 20s 得 504(race 先到),行为可接受;文档措辞应写「每请求 20s,量级对齐 server race」,避免「与 race 一致」的字面歧义。
- makeProxySearcher(web 同源代理分支)不加超时是正确的——server race 已兜底;四处改造点确认为 tavilySearcher :45 / fetchVqd :143 / ddgNewsSearcher :157 / ddgSearcher :174,与 design 一致。
- Hermes 兼容 ✓: 手写 setTimeout+AbortController,遵守 PRD「禁 AbortSignal.timeout」约束。

## §4 C3 — 必修;一个关键陷阱 + 方案推荐 B′(比设计两案都简)

**(a) 陷阱(无论选哪个方案都必须解决)**
三处注入均为 `const a3 = await obtainA3(); new YahooClient(undefined, () => a3)`(`deviceYahooCollect.ts:396-397`、`proxies.cjs:269-270`、`probe.mts:154-155`):闭包捕获的是**当时的值**。只加 invalidate 回调清掉模块变量 `firstSetCookie`,provider 再被调用仍返回捕获的旧 `a3` → **修复无效**。provider 必须改为失效后重读缓存的 getter;失效后 `_obtainA3` 对 null/'' 本就有自身 fc 回退(`yahooClient.ts:211-214`),天然配合。

**(b) 方案对比**
- **案 A(provider 升级 `{get, invalidate}`)**: 形变既有第二参数类型 → 三个生产点 + 5 个测试注入点(`test/yahoo-collect.test.ts:293/:320/:603/:628`、`test/yahoo.test.ts:247`)全部迁移,另需改 spec 签名行(`spec/ts/hk-us-data.md:25` `new YahooClient(fetchImpl?, cookieProvider?)`)。侵入最大,与 PRD「不改公共 API 形状」张力最大。**不建议**。
- **案 B(可选第三参数 invalidate)**: 既有 provider 闭包合法保留,仅三个生产点加一参;但如 (a) 所述,**必须同时把 provider 从 `() => a3` 换成重读缓存的 getter**,否则无效。
- **推荐 B′(案 B 的完整形态,净删代码)**: deviceYahooCollect 导出同步对 `getCachedA3(): string|null` 与 `invalidateA3Cache(): void`;三处注入简化为 `new YahooClient(undefined, getCachedA3, invalidateA3Cache)`,**删除预取行**(await obtainA3 不再需要——ensureCrumb 时 provider 返回空 → client 自身 fc 取 A3;代价与今天的预取完全等价,还消除今天「预取失败→client 再试一次」的双请求路径)。quoteSummary 401 分支(:168-178)刷新 crumb 前调 `this._invalidateA3?.()` → 重取走新 A3;跨 collect 自愈: 下次 collect 读到 null → fc 重取回填缓存。改动面最小、无 API 类型破坏。
- 无论何者须同步: quoteSummary jsdoc「自愈一次」(:156-157)、`hk-us-data.md:27` 行;AC3 测试全用 fetchImpl stub 可钉住「二次 401 触发失效 → fc 重取 → 成功」。

## §5 AL2 — 合规路径不受影响;建议不执行收尾轮工具

- 锚点 ✓: `toolLoop.ts:107-113` 收尾轮 `final` 零校验(tool_calls 不回流也不检查,content 空串照返);`agents.ts:163-166` `String(content)` 直接 pushReport+done 无守卫;invokeWithTools 唯一生产消费方即 completeWithTools(:149)→ 在 toolLoop 层修即单 choke point,agents.ts 零改动。
- **合规路径不破坏 ✓**: `test/tool-loop.test.ts:106-119` 收尾轮返回 `{content:'收尾回答'}` 且无 tool_calls;守卫只在 `final.tool_calls?.length > 0` 或内容为空时触发 → 该用例与其余 ordering/onDelta/onReset 断言不动。新增「不服从」负例(scriptedLlm 收尾轮仍返 tool_calls)+「空 content」负例即可。
- **ADJUST: 放弃「执行该轮工具并要求再一轮纯文本」分支**。它与 :107 头注「有界 +1 次 LLM 调用」及 spec `agents-tools.md:23-24` 收尾轮契约冲突(+2 次调用),且工具回流后再要一轮仍是「模型可不服从」的同款不确定性,无收敛保证。推荐: 收尾轮返回后若 tool_calls 非空 → warn/logError + 以占位 content 的响应对象替代 final 返回(messages 保持真实轨迹);content 归一化(`String(...).trim()`)后为空 → 同样占位。done 照发但结论可见、lastRun 缓存非空(与恢复侧 chips 半守卫 analysisController:240 衔接)。
- 占位文案策略合理性 ✓: 两态分开更可诊断——tool_calls 不服从 → 「搜索轮数已用尽，未能生成最终回答」;空 content → design 的「（本轮无结论输出）」。注意空判定要用 String().trim() 归一(顺带覆盖 content blocks 数组/空白串形态)。
- 小注: 若收尾轮流出了部分 token 后仍返 tool_calls,替代后的 UI partial 由 report 事件归约清除(controller report 清 partial),无需额外 onReset;实现顺手补一行 onReset 也无害。

## §6 D15 — 消费侧小改;restore 置位点**当前不存在**,须随本单元补

- 生产链就绪 ✓: `analysisController.ts:162`(init false)/`:290`(start 重置)/`:451`(done→true)/`:455`(error→false);接口暴露于 useAnalysis.ts:53。
- App 零消费 ✓: `App.tsx:269-277`,内层判据 `a.running` 反相(:271);错误横幅独立渲染于 :166 → 失败运行「✓ 分析完成(N 步)」与「✗ 错误」同屏成立。
- **restore 置位缺失**: grep 全部 hasDone 写点仅上述四处;bootstrap 恢复段(:223-246)未置 hasDone → design 说「确认 lastRun 恢复路径同步置 hasDone」实为**需要新增**,建议挂 :240 经理 chip 同款条件 `Boolean(last.final_decision.trim())`。现有 bootstrap 测试(test/analysis-controller.test.ts:145-182)未钉 hasDone → 加置位零回归。
- **影响面澄清(防过度预期)**: 恢复路径只产 report 型事件(测试 :167 实证),App 的 progress 派生(:83 `filter(type==='progress')`)为空 → :269 整块本就不渲染。即 restore 置 hasDone 当前**无 UI 效果**,仅为状态一致性;不要为此扩大改动(让恢复后显示完成条属新需求,不在本轮)。
- ADJUST: :269-277 外层 `progressBar` 样式含 paddingVertical+borderBottom(styles :375)——若仅内层三元改三态,失败终态会渲染一条**空的带边框横条**。应整体改门(如 `{progress.length > 0 && (a.running || a.hasDone) ? … : null}`),或内层三态 + 外层条件同步收紧。

## §7 TQ1/TQ2/TQ5 — 注入缝均在;TQ2 必须「抽取」而非「副本」

- **TQ1 ✓ 缝现成**: makeHarness collectCalls 记录器(test/analysis-controller.test.ts:70/:85-93)与 settings 注入(:81);加 `start('AAPL','us')` 带 finnhubApiKey → 断言 `collectCalls[0].finnhub` 非 null 且 trim 过,加空白 key/cn → null 负对照。controller 层零生产改动。
- **TQ2 ADJUST(方式定死)**: child.mjs **不可直接 import**——顶层 argv 门 :56-62 缺参即 `process.exit(1)`,:294 无条件 `main()` → vitest 里 import 即杀 worker。「抽到可 import 位置」是唯一正解;design 的「或以副本导入方式」应删除(测副本≠测生产,tautology 反模式)。校验表 :132-217(PATH_SEP_RE/isPlainObject/isTicker/isBar/isReport/checkTickerAndBars/STORE_OP_VALIDATORS/checkStoreOpArgs)纯函数零依赖,抽取无阻力。落点建议**纯 TS 模块**: child.mjs 已有 strip-types import .ts 先例(:36 import '../src/store-node.ts');放 `src/` 则根 tsconfig include(src/test/tools)与 vitest 扫描零配置变更;留在 `desktop/*.mjs` 则 test/*.ts import 在根 tsc(无 allowJs,tsconfig.json:1-24)报 cannot-find-declaration,还得配 .d.mts——徒增仪式。真值表面按 TQ2 原文(合法 6 op / 非数组 / ticker 带 `[\\/]` / args.length 边界 / unknown op)。
- **TQ5 ✓**: :32-35 三条钉死断言改 `toBeGreaterThanOrEqual(67)` + 日期单调递增;qfqAdjust 段 fixture 位比对(历史窗口,天然稳定)保留。纯测试改动。

## §8 CI 门 — 必要;push 触发器**必须 branch 过滤**防发布日双跑

- 现状 ✓: `.github/workflows/` 仅 release.yml;触发 `on: push: tags: ['v*']`(:3-6)+ workflow_dispatch,步骤清单(desktop matrix + android)无 vitest/tsc。
- 协调点: GitHub Actions 的 `on: push` **不带过滤时对 tag push 同样触发** → ci.yml 若写裸 `on: push`,每次推 v* tag 会与 release.yml 并行双跑(资源浪费 + 红绿噪音混在发布窗口)。修法: `on: { push: { branches: [master] }, pull_request: }` ——branch 过滤天然排除 tag ref,release push 只跑 release.yml,零双跑。可选 concurrency group 取消同类排队。
- 命令面 ✓: `npm test`=`vitest run`、`npm run typecheck`=`tsc --noEmit`(package.json:7-8);npm ci 只需根 lockfile,无 secrets。可选增强(app 层 tsc、expo export 编译门,TQ6 曾提及)本轮不做可接受,建议 ci.yml 注释里记一句防遗忘。

## §9 漂移清理 + 死导出 — 全部锚点证实;计数勘误一处

**(a) 死导出 ✓ 零消费证实**
- `configError`: 定义 `app/lib/runner.ts:176-179`(export function);全仓 grep(app/src/desktop/test/tools)命中仅定义与文档,App 门禁实际走 missingLlmKeys → 删除安全,无测试引用。
- `proxyUsed`: `app/lib/settings.ts:182` 声明、:190 赋值后即 return,全函数再无读取点 → 删变量+赋值,分支语义由 return/warn 表达已完备。

**(b) 注释失真逐条证实(PRD 列 4 条代码注释,任务书说「五处」——以 PRD 为准并勘误)**
1. `deviceYahooCollect.ts:8-9` 头注「YahooClient 内部 fc 请求遇非 2xx 抛错」— U5 后 `_obtainA3` 状态码无关解析 Set-Cookie(`yahooClient.ts:215-224`),仅确无 A3 才抛 → **失真 ✓**。
2. `app/lib/proxies.cjs:315-316` 「底层无 AbortSignal 支持」— U4 后底层全链有 40s abort(yahooClient _request/fetchChartWindow)→ 理由句失真(timer 不打断采集本身仍是事实,W4 语义保留)→ **失真 ✓**。
3. `tools/probe.mts:152-153` 「YahooClient 自身 fc 请求遇非 2xx 会抛,crumb 链断」— 同 1,U8 修正漏改此处 → **失真 ✓**。
4. `yahooClient.ts:67-69` 「AbortSignal.timeout 静态 API 在 Hermes 未打补丁、不可靠」— wave2 已 REFUTED(expo@57 winter 启动期补 timeout/any 静态)→ **失真 ✓**(修法按 wave2 建议: 说明手写模式保留理由=平台中立冗余,可在 rn-runtime.md 记一行依赖事实)。
- 第「五处」勘误: 任务书的「五处注释失真」与 PRD In-list(4 代码注释 + 2 spec)不符。评审中另有两条已证实的相邻漂移**不在本轮范围**: `proxies.cjs:86` 「补 CORS 头」(实现从未设 CORS 头,grep Access-Control 零命中)与 settings.ts「会话级」文案/theme.ts 暗色板(PRD 明确 Out)。因 :86 与本单元同文件同波,顺手一并修正成本≈0,建议 Wave C 顺带(需主会话点头,属 scope 微扩非阻塞)。

**(c) 两份 spec 漂移 ✓ 证实**
- `chart-ui.md:74-84` §UI 编排: 仍称「分析编排…在 useAnalysis.ts;App.tsx 是纯渲染层」「hook 内订阅 effect 空依赖数组」— U13 后编排主体在 app/lib/analysisController.ts,useAnalysis 为薄胶水,订阅在控制器构造期 → **漂移 ✓**(章节日期戳 08-16 早于 U13)。更新时顺带补 hasDone/D15 消费一句。
- `core/investment-committee.md`: frontmatter paths `core/investment_committee.py`/`core/role_registry.py`(:3-5)、标题与正文引用 test/core/test_role_registry.py、utils/billions_config.py 等 Python 时代路径,实现已删 → **漂移 ✓**。按 review 建议「重写 TS 视角」或至少 paths/入口指向 src/committee.ts、src/agents.ts、src/prompt.ts、src/billionsTools.ts 与 test/ 对应文件。
- 连带提醒: C2/C3/C6 落地会改 `hk-us-data.md` 的 YahooClient 构造签名行与 fetchWithTimeout 相关描述;AL2 落地可顺带在 `agents-tools.md` 收尾轮契约行补占位语义——均属「随修复清理漂移」原则,归对应单元而非 Wave C。

## FP / 过度设计专项标注

- **FP**: 无。九单元的问题陈述全部与当前源码吻合(FP 三模式逐条过筛: 无信任边界混淆、无不实行为断言、无变量误读);唯一曾濒临 FP 的相关项(AbortSignal.timeout/Hermes)已在评审阶段拦截,本轮只处理其文档残渣(yahooClient 注释)。
- **过度设计风险(3 处,均已给出收敛建议)**:
  1. C3 案 A(provider 对象升级)迁移面 ~9 点含 5 个测试点与 spec 签名,收益不比案 B′ 多 → 用 B′。
  2. AL2「执行收尾轮工具再要一轮」破坏有界调用契约且不收敛 → 改占位兜底。
  3. TQ2「副本导入」测的是副本不是生产 → 单源抽取。
- **预期管理(1 处)**: D15 restore 置 hasDone 无当前 UI 效果(progress 门),勿扩为恢复后显示完成条的新需求。

## 结论

整改计划问题识别全部成立,可直接进入实施;但以下 6 项调整应在派发 implement 前落入单元指令,否则轻则文案误导/验收争议,重则(C3 闭包捕获)修复无效:

1. F1: expo moveSync 需带 `{overwrite:true}`;扩写 src/expo-file-system.d.ts 镜像签名;tmp 后缀避开 `.json`;原子写单测落 store-node 层(expo 侧走查+tsc)。
2. F2: 锁先于 mkdir/spawn(顶层或 whenReady 最前);mainWindow 提模块级供 second-instance 聚焦;交付手动双开验证记录。
3. C2/C6: 处理 fetchWithTimeout 硬编码「Yahoo 请求超时」文案(label 参数或调用方归一);文档措辞改「每请求 20s」。
4. C3: 采用 B′(导出 getCachedA3/invalidateA3Cache 对 + 可选第三参,删预取);严禁保留捕获式 `() => a3` 闭包;同步 hk-us-data.md 签名行。
5. AL2: 不执行收尾轮工具;toolLoop 层占位兜底(两种文案);trim 归一空判定。
6. CI: push 触发加 `branches: [master]` 防 tag 双跑。

TQ1/TQ2/TQ5、D15、漂移清理按计划直接执行(TQ2 记住抽取而非副本)。
