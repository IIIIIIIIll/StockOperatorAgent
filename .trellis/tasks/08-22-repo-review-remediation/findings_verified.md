# 全仓 Review 发现 — 复核结论(2026-08-22 验证轮)

> 输入: `temp_findings` / `temp_findings_2`(五路 AI reviewer 抢救稿)。
> 方法: 6 个只读验证 agent 按域并行复核,逐条对当前 HEAD(7545b0c)源码取证(file:line + 引文),
> 并按 `.trellis/spec/guides/index.md`「Verifying AI Cross-Review Results」rubric 判定
> (35% FP 预算;三类已知 FP:信任边界混淆 / 忽略设计注释 / 变量误读)。
> 结论格式: CONFIRMED / PARTIAL / REFUTED / MISLOCATED;附严重度调整与修正锚点。

## 汇总统计

- 复核条目: ~40(A:6 + B:5 + C:4 + D:18 + E:11)
- **完全否决(REFUTED): 7** — A1, A2, B2, D2, D3, D12(2/2 部分), a11y#16
- **部分成立(PARTIAL): 6** — A5, D7, E7, E8, E11, D12
- **成立(CONFIRMED): ~27**(8 条严重度下调)
- FP 率 ≈ 15% 完全否决 + 15% 局部降级,在 35% 预算内;且**原始 P0 优先级排序需重排**(见文末)

---

## A. 安全/CI(DesktopTooling)

| ID | 原判 | 复核 | 结论 |
|---|---|---|---|
| A1 traversal | major | **REFUTED(含实证)** | `server.mjs:36-42` 先 `decodeURIComponent` 再 `path.join(DIST, urlPath)`(`..` 被 join 归一化),`startsWith(DIST)`(:43-47)正确拒绝逃逸。实证: 真实 `createAppServer` + `app/dist` 下 curl `--path-as-is` 全部编码变体(`..%2f`、`%2e%2e%2f`、`..%5c`、双重编码、4 级渗透)→ **403**;所有 200 均为 SPA fallback 的 index.html。原稿「empirically got 200」= 只看了状态码、未看响应体 → FP 模式 #3(变量误读 join/decode 顺序) |
| A2 release.yml 注入 | major | **REFUTED** | `version="${GITHUB_REF_NAME#v}"`(:127/132)是 bash 参数展开,展开结果**不会被重新解析为 shell 语法**;workflow 内 `run:` 块无任何 `${{ }}` 表达式;`permissions: contents:write` 存在但仅影响触发该 workflow 的推送者自身。git 2.43 实证 `v$(id)`、`v1;2` 等标签合法 → 只产出字面文件名,**无代码执行**。残余: 标签含 `/`(如 `v1.2/3`)→ `cp` 路径断裂(自我造成的可用性问题,非注入) |
| A3 version↔tag | minor | **CONFIRMED**(minor) | `desktop/package.json:3` 钉死 `1.0.0`;electron-builder `artifactName` 全用 `${version}` → 每次发布都叫 1.0.0;全仓无版本同步脚本 |
| A4 base64 宽松 | minor | **CONFIRMED**(minor) | `tools/configure-android-signing.mjs:159` `Buffer.from(...,'base64')` 从不抛错(已验证);失效 try/catch,仅捕获空结果(:163-165) |
| A5 child.mjs 未校验 | minor | **PARTIAL → polish** | 机制属实(`child.mjs:148-152` 仅 typeof-function 校验后 `store[op].apply`),但触发面仅 renderer(preload 桥、可信 bundle;HTTP 无 store 端点;child 绑定随机 loopback 端口),且上游 `src/market.ts:85-98` `normalizeTicker` 正则剔除 `/` `\` → `store-file.ts:145` 文件名路径不可达。纯纵深防御 |
| A6 Host 头 | polish | **CONFIRMED**(polish) | server 仅 loopback 监听(:86-94)(有注释背书),无 Host 校验,DNS rebinding 面极小 |

**Clean-list 全部复核通过**: webPreferences sandbox/contextIsolation=true、nodeIntegration=false、will-navigate/window-open 拒绝、preload 恰 4 方法、STORE_OPS 6 操作白名单 + 15s 超时、child 随机端口、dist 无密钥(仅 env 变量名)、app/.env 不进包;npmmirror registry 存在于 3 个 lockfile。

## B. 数据源(DataSource)

| ID | 原判 | 复核 | 结论 |
|---|---|---|---|
| B1 Yahoo 无超时 + 锁永占 | major | **CONFIRMED**(major) | 每环证实: `yahooClient.ts:198` 裸 `await this._fetch(url,{headers})` 无 AbortSignal;`deviceYahooCollect.ts:65`(obtainA3)/`:146`(fetchChartWindow)裸 fetch;`proxies.cjs:297-300` 429 门禁、`:302` 上锁、`:312-314` 504 定时器**只回 504 不清锁**、`:320-323` finally 仅在 `await _collect` settle 后释放;`server.mjs:61` 无 requestTimeout/headersTimeout 兜底。`src/yahoo` 全链零 AbortSignal。严重度措辞修正: 「永久 429 直到重启」是**最坏情形**(Node undici 默认 ~300s 会兜住静默 socket;RN 走系统超时);缺陷(无超时、无取消、504 早于放锁)本身完全成立。**同款返回**: `handleTdxCollect`(:219-234)同模式,`:310-311` 注释称「W4 同款」= 有意为之 |
| B2 cookie 空哨兵 | minor-major | **REFUTED** | FP **#3 变量误读**(方向搞反): `deviceYahooCollect.ts:58` `firstSetCookie: string\|null = null` — **null 即「未取过」哨兵**;`:62-70` `if (firstSetCookie !== null) return` → 失败则写回 null = 哨兵,下次**重新抓取**(正确重试行为);「缓存 null 永续」不存在。缓解声明属实: `yahooClient.ts:178-187` cookieProvider 为 null/'' 时回落自取 fc cookie,且实例每次 collect 新建(proxies.cjs:265) = 真正 per-request。残余(小): ① 无负缓存/退避,失败 fc 每次重抓;② **一行不对称**: obtainA3 状态无关地解析 Set-Cookie(:65-66),而回落 `if (!resp.ok) throw`(:183-184)——fc.yahoo.com 文档化返回 404 但带 A3 cookie(deviceYahooCollect.ts 头注 2026-08-20),404 场景回落抛错而非解析已带的 A3。记录为 investigated-not-bug + 一行修复机会 |
| B3 degrade 覆盖好数据 | minor | **CONFIRMED**(minor) | `applyYahooCollectedToStore.ts:71-74` putStock **整槽覆盖**无字段合并;`composeYahooOverview.ts` 空 summary 时 PE/PB `firstFinite`→NaN(:141-150)、`change_percent_60d` NaN(:117-120);`pipeline.ts:226-234` 槽覆盖 spread 后无任何恢复。细节: crumb 失败抹 PE/PB/eps/52w/market_cap;skipDaily 抹 change_percent_60d,且经 chartPreviousClose 还污染 prev_close |
| B4 prevCloseOf 单条边 | minor | **CONFIRMED**(minor) | **锚点修正**: 逻辑在 `deviceYahooCollect.ts:187-194`(单条今日 bar → prevClose=今日收盘)+ `:333-336` 注入;`overview.ts:84` 只是 CN 侧。IPO 日边: HK/US 得 change_pct=0,CN 得 NaN,不对称属实 |
| E9 isYahooMarket 重复 | minor | **CONFIRMED**(minor-polish) | `proxies.cjs:253-257` 与 `src/yahoo/webYahooCollect.ts:43-47` 同基址正则+detectMarket 核心;proxies.cjs:15-24 已 require src .ts 模块 → 统一可行;细微差异: 布尔谓词 vs 抛错分类器 |

## C. 核心/事件(CoreLogic)

| ID | 原判 | 复核 | 结论 |
|---|---|---|---|
| C1 events 抛错契约 | major | **CONFIRMED**(major,措辞修正) | `src/events.ts:168-172` emit error **且 rethrow** 属实。**契约位置修正**: 原文称 events-streaming.md,实际在 `.trellis/spec/error-handling.md:26-40`(「runner never throws past event boundary」);events-streaming.md 无此承诺。双重面属实但是**一条相同 banner + 两条日志**(无 toast)——严重度按「规范矛盾 + 重复上报」定 major,但用户可见重复轻于原文描述。`test/events.test.ts:118-129` 把 rethrow **钉进测试**(错误路径: 缺 LLM key → error 事件 + throw)→ 代码与规格、测试三方矛盾,是契约争议点 |
| C2 单例无并发守卫 | minor | **CONFIRMED**(minor) | 锚点修正: 单例在 **`app/lib/runner.ts:77`**(src/runner.ts 不存在);`useAnalysis.start()`(:209-248)**无任何 running 守卫**(强制重置 :210-214);App.tsx `__soa.start`(:74-82)直调;唯一守卫是 UI `disabled={a.running}`(:130)。AppRN/D10 同款交叉一致 |
| C3 store-idb close 丢队列 | minor | **CONFIRMED**(impact 下调) | `store-idb.ts:257-265` close 不 flush(:146)丢弃 pending 队列属实;但 **全仓无生产调用者**(仅测试 teardown;desktop/child.mjs:89 的 close 是另一 Node store)→ 实际影响≈0 |
| C4 中途失败丢部分结果 | design note | **CONFIRMED as-design** | 错误路径只发 `error`,无 `done`/失败态事件;lastRun 仅在 done 时保存(`useAnalysis.ts:189-192`)→ 全有或全无;但 `src/lastRun.ts` 注释 R4「分析失败不写 → 旧缓存保留」= **有意设计**,记为 investigated-not-bug,入 doc 防再翻 |

## D. RN App 层(AppRN)

| ID | 原判 | 复核 | 结论 |
|---|---|---|---|
| D1 菜单锚点过期 | major | **CONFIRMED → minor** | 机制实: `App.tsx:116-120` 仅 open onPress 时 measureInWindow 一次;全仓无 resize/orientation 监听、无重测 effect;RNW measureInWindow=setTimeout(0)+getBoundingClientRect 一次性快照(`UIManager/index.js:78-89`)。但**触发面仅 web 窗口缩放/缩放中菜单开着**;native 旋转被锁 portrait(`app/app.json:6`);重开即重测自愈。后果: 菜单短暂错位(可喂 D4) |
| D2 web fade 死点击窗 | major | **REFUTED(反向)** | RN W 0.21.2 `ModalAnimation.js:66-69/85-89/141`: fade-out 全屏 zIndex-9999 容器保留 ~250ms **但带 `pointerEvents:'none'` 且继承全子树**(Pressable 仅动 cursor/touchAction;App.tsx:167 box-none 只是移除自己行为)→ **是点击穿透而非阻塞**。原稿自己的括号注释就与结论矛盾。**新发现**: 反向真实缺陷(minor)— fade 期间菜单区域可视但穿透,点击落到下层(通常正好是市场按钮 → 菜单立即重开,或「开始分析」)= ghost-click |
| D3 双击测量竞态 | minor | **REFUTED** | 无守卫机制存在但无现实触发/无可观察后果: 两次回调幂等;二次点击需落在首个回调前的 0-16ms 窗口;open 后全屏 click-catcher(:164)盖住按钮;setTimeout-0 回调 FIFO 不可能乱序。「回头重开」需 close 先于 measure 回调,而 close 相关元素首回调后才有 → 不可能。investigated-not-bug |
| D4 菜单底部出屏 | minor | **CONFIRMED**(minor) | `App.tsx:169-170` 无 flip/clamp/maxHeight/右边距约束;菜单≈114px,仅视口高<~280px 或 D1 锚点过期时出屏;~320px 窄窗右溢。RNW Modal 无 ScrollView,溢出直接裁掉 |
| D5 无 maxWidth | minor | **CONFIRMED → polish** | `App.tsx:290` 无 maxWidth 属实,但内容为固定 3 个短标签(`market.ts:10-14`),无现实触发;与 D4 同根(同一 styles 对象),应随 D4 一起加 |
| D6 saveAndCheck 无卸载守卫 | minor | **CONFIRMED → 降 minor 措辞** | 位置修正: **`app/screens/SettingsPanel.tsx:65-71`**(非 components/);无 useEffect/cleanup;条件挂载(`App.tsx:204`)→ 卸载后 `setReach` 在 React 18+ 是静默 no-op(警告已移除);**真实残余 = 旧 key 竞态**(update() :48-51 中途置 idle,旧 promise 可覆盖)+ 输入仍可编辑 |
| D7 文档/付费调用 | minor | **PARTIAL** | **位置确认**: `app/lib/settings.ts:154-211`(reviewer grep 两度跳过是漏检,非符号不存在)。(a) 属实: 注释 :154-155 写「GET /models 最轻量端点」,实际 :180 `fetch('/llm-proxy/chat/completions',POST)` + :191 `${base}/chat/completions` POST(含 messages + max_tokens:64)→ **付费调用**,每次 save 即触发(:95 仅 keysComplete 守卫)。(b) **不成立**: native 相对 URL 拒绝在 try/catch 内(:179-186)→ 仅 warn 后直连退路可用;desktop 经 child.mjs:132-139 由 localhost 服务托管,相对路径可解析;「桌面/原生坏掉」不成立。残余: CORS 提示(:207-209)按 `msg.includes('fetch')` 门控,RN「Network request failed」不含 → RN 误导性提示 |
| D8 硬编码 2026-08-10 | minor | **CONFIRMED → polish** | `DataScreen.tsx:57` 硬编码属实,但 bars 空时所有 today 派生值已由 `bars.length` 门控为 NaN → 常量**功能上死支**(指向 `overview.ts:67-75` 等),仅观感陈旧 |
| D9 onSettingsChange 清横幅 | minor | **CONFIRMED**(minor) | `useAnalysis.ts:202-207` 每次设置编辑 `setError(null)`;失败后改一次设置即永久抹掉错误横幅;运行时编辑掩盖进行中错误。**与 D15 复合**: 失败运行可能看起来完全成功 |
| D10 __soa.start 绕过 | minor | **CONFIRMED**(=C2) | `App.tsx:74-82` 直调无守卫;仅 debug 钩子(app.tsx:75 注释 headless 验证用);正解在 C2(start()/runner 守卫),D10 不单独修 |
| D11 POST_NOTIFICATIONS | minor | **CONFIRMED**(minor) | `AndroidManifest.xml:7` 声明了权限,但全仓 grep 无任何 `requestPermission*` 调用(TS + Kotlin 均无);start() 仅 startForegroundService。Android 13+ 下 FGS 通知不可见(UX 瑕疵),保活本身仍工作。`index.ts` catch + `.catch(()=>{})` **静默吞掉**模块拒绝 → 放大器 |
| D12 stopPropagation/焦点陷阱 | polish | **PARTIAL** | (1) stopPropagation 冗余属实: click-catcher(:164)是菜单 View(:166)的**兄弟**而非祖先;RNW PressResponder 恒在 onPress 前 stopPropagation(`PressResponder.js:302-315`,:310)→ 无害。(2) **焦点陷阱 REFUTED**: RNW ModalFocusTrap 内建(双 FocusBracket + document 级 focus 监听,Tab 无法逃出;ModalContent 提供 Escape 关闭)。仅剩风评: 无操作的样式清理 |
| a11y#15 角色缺失 | minor | **CONFIRMED**(minor) | `App.tsx:114-123` 触发键仅 accessibilityLabel 无 role/aria-expanded;:166-172 菜单容器无 role;:174-183 选项无 role/aria-selected → 读屏报「泛化控件」,开合状态与选中不可发现。修复形: role='button'+expanded / role='listbox'+aria-selected |
| a11y#16 aria-modal 缺失 | minor | **REFUTED** | RNW ModalContent 自带 `aria-modal:true` + `role:dialog`(active 时);App.tsx:164 的 marketModalRoot 是**透明点击捕手**,不是对话框根 → 原稿把背景元素误当 modal 根(FP #3 命名误读)。残余: role 在 fade-in ~250ms 后才有 |
| D13 索引 key | polish | **CONFIRMED**(polish) | `ReportContent.tsx:79-82` 静态长度 2;DataScreen tail/profit chips/reports 均无状态展示行(≤4 条静态),无状态丢失风险 |
| D14 IndicatorChart 无 resize | polish | **CONFIRMED**(polish,补充) | nuance: `useWindowDimensions` **有**(:110)但只驱动 narrow<560 legend 旗标;chart 创建 `createChart(el,{height...})` 无 width/autoSize/ResizeObserver;容器 width:100% 固定高 → canvas 不随窗口重排。修法: autoSize:true 或显式 width 入参 |
| D15 错误也显示✓分析完成 | polish | **CONFIRMED**(polish) | `App.tsx:240-244`: `!running && progress.length>0` → 「✓ 分析完成」;错误路径 catch → setError + finally setRunning(false)(useAnalysis ~:338-344)→ 失败运行 ≥1 progress 时**同时**显示 ✓ 与错误;采集阶段失败(无 progress)则横幅隐藏。条件应要求 done 事件 |

**Verified-clean(D 域)**: Android back onRequestClose OK(:161)、Escape 关闭 OK(RNW closeOnEscape)、click-catcher 顺序 OK(捕手先渲染,菜单可命中;陈旧注释「zIndex 之下」与实现不符——DOM 顺序起效)、选项点选设置市场并关闭(:182)、开始前关闭菜单(:130)、卸载清理 OK、WebView 契约 OK。

## E. 测试/规范卫生(TestSpec)

**基线实证**: 串行重跑 `npm test`(vitest run,22:09)= **46 文件: 45 通过 + 1 跳过;512 测试: 511 通过 + 1 跳过** ← 与复核时点「511 passing」**完全吻合**。
(6 agent 并行时刻的 502/9F/1S 全部为 5s 超时,系负载所致;并行为环境噪声,非回归。)

| ID | 原判 | 复核 | 结论 |
|---|---|---|---|
| E1 useAnalysis 编排零测试 | major | **CONFIRMED**(major) | test/ 仅 `architecture.test.ts:285-286` 注释提及;无 React 测试基建(renderHook/act/@testing-library 全仓 0)。覆盖的是: lastRun 模块(last-run.test.ts:1-43)、events runner、pipeline、market 表、committee 图——**编排本身(start :209 / restore :116-139)零测试** |
| E2 updateOverview 无测 | minor | **CONFIRMED**(minor) | store-memory.ts:61-65 / store-file.ts:225-228 / store-idb.ts:328-331 / store.ts:174-177 均无方法级测试;desktopBridge.test.ts:153-154/283-298 是不同实现(DesktopStore 桥) |
| E3 listStocks | minor | **CONFIRMED**(minor) | store-file.ts:251-253;消费者仅 child.mjs:100 + tools/desktop-probe.mts:83-95(探针);test/ 零命中 |
| E4 mergeFinnhubIndustry device 支 | minor | **CONFIRMED**(nuanced) | `deviceYahooCollect.ts:374-389`,merge 在 :387;device 测试全部无 finnhub 参数 → 仅 null 路径;web+finnhub 有覆盖(yahoo-collect.test.ts:416-425)。缺失的是 device+finnhub 组合,不是整个函数 |
| E5 handleYahooCollect | minor | **CONFIRMED**(minor) | proxies.cjs:269;proxies.test.ts 全读 321 行: 只测 llm/tdx/websearch/C2;`_collect` 注入缝存在(与 tdx 同法 :185,195)→ 补测成本低 |
| E6 settings env 回落 | minor | **CONFIRMED**(minor) | settings.ts:88-96;注释 :88-92 有 babel-preset-expo 只在 release 内联的实测说明;settings-store.test.ts:132-136 删 3 键保确定性但从不设键 → 分支从未执行 |
| E7 死导出 | minor | **PARTIAL**(逐符号) | `makeInvestmentDecision`(committee.ts:188-204)**真死**(零调用零测试)。`overviewNeedsRefresh`(gates.ts:33-36)/`FetchScope`(gates.ts:87-100)**无生产调用但被 store-gates.test.ts 导入测试**(:9/116-122, :5/138-142)→ 生产者视角死,测试视角活;删除需连测试一起删。`envDisabledBool`(committee.ts:48-51)**死**;switches.ts 仅是**注释**引用(:7-8,:37-38「旧 envDisabledBool 语义」),替代为 `fromEnv()`(:39-49),等价性由 switches.test.ts:55-68 钉死 → 原稿「需 case-by-case」是正确警觉,结论: 按定义点判死,注释红鲱鱼 |
| E8 spec 漂移 | minor | **PARTIAL**(仅两条属实) | (a) hk-us-data.md **§7** 「去全部前导零」vs 代码 `market.ts:99-104` `slice(1)`=去一前导零 — 但**同一 spec §2** 注释与代码一致(去一前导零)、§7 实例 ['9988.HK','09988.HK'] 也与代码一致(被 market.test.ts:59 钉死)→ 是 spec 内部 §2↔§7 措辞矛盾,仅 ≥2 前导零(如 '00988')分歧。(b) agents-tools.md:49 链大部分准确,唯第一环过时: BillionsClient 现于 `useAnalysis.ts:329-330` 构造(08-16 hook 重构,App.tsx:4-5 注释印证)。(c) chart-ui.md:21 **STALE 属实**: `financialTrendSeries(reports, profit)` 缺第三参 `market: Market = 'cn'`(chartData.ts:67-71,S5 币种标签 :99-103)。→ 均为 polish 级文档 |
| E9 见 B 域 | minor | CONFIRMED | 同 B 表 |
| E10 lotSize 未用 | polish | **CONFIRMED**(polish) | `market.ts:21/32/40/48` 仅 market.ts + market.test.ts:126-156 期望字面量;零生产读取;删除需同步测试。promptRules 为注明占位(market.ts:22-23「S4 填充,本切片恒空串占位」)→ 按设计保留 |
| E11 兜底分支无测 | polish | **PARTIAL**(表述漂移) | events.ts **无** fallback/demo 分支(grep 0);最近似真实缺口: `runner.ts:171-174` demoLlm 兜底(未测)+ events.ts:139 `?? makeLlm()`(throw 路径已测)。pipeline `safe()` 吞异常(`pipeline.ts:261-266`「进度丢失不阻断」)**仅内联注释**,无 spec 级文档(spec grep 只中 Python 时代归档)→ polish |

**Good-coverage 抽检**: market 真值表(market.test.ts:7-124,含 4/8→null :14-17、'09988' 钉 :59)、events 顺序(events.test.ts:60-167,含重试 ~100-131、退订 :134)、gates 时区(gates.test.ts:17-51,固定 EDT 跨日 :24-36、asiaToday :46-51 + store-gates.test.ts:107-165)、proxy SSRF W2/W4(proxies.test.ts:35-49 413 / :57-118 400-403 / :216-243 504→锁 429→200)、yahoo 候选探测(yahoo-collect.test.ts:218-220)——**全部确认存在**。

---

## 复核后修正的优先级(替代原「P0/P1」共识)

原稿 P0/P1: A1 traversal、B1 timeout+lock、C1 error double-report、D1 stale anchor、E1 orchestrator tests、A2 CI injection。

**修正后**:
- **移除**: A1(REFUTED,实证 403)、A2(REFUTED,注入不成立)。
- **保留 P1**: **B1**(Yahoo 全链无超时 + 504 早于放锁 → 429 锁死窗口;顺手修 lock 尽早释放/加 AbortSignal,TDX 同款)、**C1**(events 契约矛盾: error-handling.md 规定的边界 vs 代码+测试钉死 rethrow;需定契约后统一)、**E1**(useAnalysis 编排零测试,major 覆盖缺口)。
- **P2**: B3(degrade 抹好数据)、C2/D10(runner 并发守卫)、D6 竞态、D7 文档/付费调用、D11 通知权限、A3(版本一致)、A4(签名脚本)、B4、E7 死导出清理、E8 文档漂移、a11y#15。
- **P3/polish 批量**: D1+D4+D5+D2 反向 ghost-click(同一 styles/动画根因一次性修)、D8、D9+D15 复合(错误可见性)、D14、A5、A6、E2-E6、E10、E11。

## 新增发现(原稿无)

1. **D2 反向 ghost-click(minor)**: fade 期菜单区域点击穿透,点击落到底层(通常=市场按钮 → 菜单立即重开)。与 D2 同根因,建议同一处修(web `animationType` 处理)。
2. **B2 残余一行不对称**: obtainA3 状态无关解析 Set-Cookie vs 回落 `!resp.ok` 抛错;fc.yahoo.com 404 带 cookie 场景,回落会错丢已带的 A3(仅 obtainA3 已失败后激活,chart 路径不受影响)。
3. **suite 并行脆弱性**: 6 并发 agent 时 9 个 5s 超时;串行全绿。CI/开发若并行跑测试需注意(测试超时 5s 余量不足,`testTimeout` 可上调)。

## Investigated-and-cleared(记入文档防再 churn)

- A1 / A2(B 域安全,实证否决)
- B2(哨兵方向误读;唯一残余是 404 不对称)
- C4(失败不写 lastRun 是 R4 设计,旧缓存保留)
- D3(双击竞态不可触发)
- D12(2/2): 焦点陷阱 RNW 内建
- a11y#16(aria-modal RNW 自带;背景捕手非 dialog 根)
- E7 gates 两个符号「死但测试活」→ 删除需连带测试;envDisabledBool 的 switches.ts 提及为注释
- D8(常量死支,功能上无影响)
- 原稿「D15 收到时 vs code」已修正(见 D15 行)

---

## 关闭状态(2026-08-23 整改完成回填)

> 执行模型:串行单元制(U1-U33),每单元 trellis-check approve → 全量回归矩阵(vitest + root tsc + app tsc + Web 打包;Kotlin 单元加 Android gradle)→ 独立 commit。
> 最终基线:580 通过 / 1 跳过(原基线 511;+69 测试用例,skip 数不变);root/app tsc 0 诊断;`:app:assembleRelease` 签名构建成功。

### 已修复(In Scope 全关闭)

| ID | 单元 | Commit | 说明 |
|---|---|---|---|
| A3 | U9 | edcb382 | release.yml 版本↔tag 双 job 硬门禁 |
| A4 | U10 | 88d519e | 严格 base64 + keystore magic(JKS/JCEKS/PKCS12) |
| A5 | U11 | d3d884d | child.mjs store-op 入参形状校验(纵深) |
| A6 | U12 | 6e2dfaf | Host 头校验(loopback 连接时;XFH 不信) |
| B1 | U4 | cf3d42e | Yahoo 链全链路 40s abort(fetchWithTimeout,Hermes 兼容) |
| B2-残余 | U5 | b7ceafd | fc 回落状态码无关解析 Set-Cookie A3 |
| B3 | U6 | d5e183a | putStock 字段级合并(isFinite 门,缺键保旧) |
| B4 | U7 | 626c401 | prevCloseOf 今日单 bar → NaN,与 CN 对齐 |
| E9 | U8 | d1cb50a | isYahooMarket 去重单源(try/catch 分类器)+ 附带 handleYahooCollect 测试(E5 一并关闭) |
| C1 | U1(+U13 收口) | 678b3c2 / ec0d9f2 / 360681b | run() 错误只发 error 事件不再抛出;probe 可观测性;useAnalysis 防御 catch |
| C2(=D10) | U2 | f5a46bb | createPipelineRunner running 守卫(busy → error 事件) |
| C3 | U3 | f4d4281 | IdbStore.close() 先排空写穿队列再清理 |
| D1+D4+D5 | U16 | 08a467b | 菜单几何:resize 重测/右缘 clamp/上翻/maxWidth 280 |
| D2-ghost(新增) | U17 | d456d21 | web Modal animationType='none' 消穿透;平台差异清单追加 |
| D6 | U20 | 5e2b017 | SettingsPanel mountedRef + seq token 竞态守卫 |
| D7 | U21 | 70399a0 | checkLlmReachability 注释对齐 POST chat/completions + CORS 措辞 |
| D8 | U22 | 0f626f7 | DataScreen 死字面量 '2026-08-10' → asiaToday() 单源 |
| D9(U14 吸收) | U13 | 360681b | hasDone/运行中不清错误横幅(控制器内) |
| D11 | U25 | f968a77 | Kotlin POST_NOTIFICATIONS 运行时请求(每进程一次,不阻塞 FGS) |
| D12(PARTIAL) | U18 | 52d182e | 冗余 stopPropagation 删除 + stale zIndex 注释(焦点陷阱 REFUTED 不修) |
| D13 | U23 | 2e9b785 | 稳定 React keys(date/period:metric/report_date/slot.title) |
| D14 | U24 | d612cb5 | IndicatorChart autoSize:true(RN 5.2.0 RO 回流) |
| D15(U15 吸收) | U13 | 360681b | ✓分析完成仅 done 后显示 |
| a11y#15 | U19 | 0689554 | 菜单 ARIA button/listbox/option + aria-expanded/selected |
| E1 | U13 | 360681b | useAnalysis 抽离 AnalysisController(DI)+ analysis-controller.test.ts 12 用例 |
| E2+E3 | U26 | d89823f | updateOverview 四实现矩阵 + listStocks/listMetaKeys(15 用例) |
| E4 | U33(计划缺口补) | abe362a | collectYahooForDevice × finnhub 组合 3 用例(implement.md 原表遗漏行,主会话补派) |
| E5 | (随 U8) | d1cb50a | handleYahooCollect 400 gate 双分支 + 注入 _collect 透传测试(proxies.test.ts +71 行) |
| E6 | U27 | 8e46638 | EXPO_PUBLIC_LLM_* env 兜底分支 4 用例 |
| E7 | U29 | a9d1a91 | 死导出删除 ×4(+连带测试;.env.example stale 提及同步) |
| E8 | U30 | 47288a3 | 三处 spec 漂移修正(hk-us-data §7 重写自洽/agents-tools 接线链/chart-ui 签名) |
| E10 | U31 | 2ffe82f | MarketInfo.lotSize 删除(+spec §2 镜像同步) |
| E11 | U28 | a3bb8d5 | demoLlm PHRASES 路由 18 用例 + safe() 契约入 error-handling.md |
| 新增3(suite 并行脆弱性) | U32 | b6495df | vitest.config.ts testTimeout 15s(假超时未再现) |

### 不修(REFUTED / investigated-not-bug,零代码改动)

A1、A2、B2 主项(null 即哨兵)、C4(R4 设计)、D2 原「死点击窗」、D3、D12 焦点陷阱、a11y#16 — 论证见上文各表与 Investigated-and-cleared 节。

### 规格同步汇总(AC5)

- guides/cross-platform-thinking-guide.md:web fade 穿透行(U17)
- error-handling.md:pipeline safe()/safeProgress 家族契约条(U28)
- ts/hk-us-data.md:§7 候选序措辞重写自洽 + §2 lotSize 镜像同步(U30/U31)
- ts/agents-tools.md:亿信/mcp 接线链更新至 useAnalysis deps 形态(U30)
- ts/chart-ui.md:financialTrendSeries 第三参 market(U30)
- testing.md:testTimeout 15s 记录(U32)
- error-handling.md C1 契约措辞:复核无需改动(代码已向规格收敛)

### Backlog(非阻塞,记录防丢)

- FinancialTrendChart.tsx 同款 createChart 无 autoSize(D14 范围外;如需同修参照 U24 两行改法)
- U12 F2 socket 层 server 集成测试(可选纵深)
- events.test.ts 低频 load-flake:U32 上调 testTimeout 后未再现;若复发按 break-loop 另立任务

### AC 核验(2026-08-23)

- AC1 ✅ In-Scope 全关闭(上表);REFUTED 项零改动
- AC2 ✅ vitest 580/1 skip 全绿(新增 69 用例,无意外 skip)
- AC3 ✅ root + app tsc 0 诊断
- AC4 ✅ architecture 七断言绿;proxies 504→锁→200 语义保持;events 顺序断言绿(C1 更新后)
- AC5 ✅ 规格同步见上节
- AC6 ✅ 串行单元制执行;每提交前 trellis-check approve + 全量回归;全程无未审合入
