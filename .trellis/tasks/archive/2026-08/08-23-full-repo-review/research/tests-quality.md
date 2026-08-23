# test/ 51 文件质量与覆盖缺口评审(tests-quality)

- **范围**: `test/` 全部 51 文件(581 用例)四维评审——断言强度 / 覆盖缺口 / mock 保真度 / suite 健康度;对照 `src/`(41 文件)+ `app/lib|hooks`(14 文件)导出面与 08-22 整改窗口新增代码(U1-U33)。
- **方法**: 纯静态分析。逐文件清点 `it/describe` 标题与 import 面(51/51);精读关键测试体(runner/analysis-controller/yahoo×2/proxies/market/store-update-overview/qfq/gates/store-gates/collector/settings-env-fallback/demo-llm 等 ~20 文件的断言正文);对照生产实现分支(events.ts busy 守卫、analysisController finnhub/web 分支、store-file enqueue、child.mjs 校验器、server.mjs Host gate、metro shim 接线);mock 结构与真实 API 契约(Yahoo chart/quoteSummary `{raw,fmt}`、finnhub profile2、billions `result[].content[]`)比对。
- **HEAD**: e4d8680(master)。基线: vitest 580 通过 + 1 跳过(live.integration, SOA_LIVE 门控),root/app tsc 0 诊断(已实证,未重跑)。
- **判定纪律**: 已过 findings_verified.md(REFUTED/investigated-not-bug 不重报:E1-E11 均已关闭,本报告只报**新缺口或整改后残留面**)与 spec/guides 三类 FP 模式。

## 四维总结论

| 维度 | 结论 |
|---|---|
| (a) 断言强度 | **优秀**。全仓零 snapshot;`toBeTruthy()` 12 处全部伴随更强断言(final_decision/字段级 toBe/toBeCloseTo(…,6));核心行为均被可观察断言钉住(busy 消息逐字、事件计数恰 N、NaN 用 toBeNaN 而非 truthy)。 |
| (b) 覆盖缺口 | 主力路径覆盖密(src/ 几乎每模块有直接单测;08-22 整改项均有针对性回归用例且非 tautology)。残余缺口集中在: **平台/finnhub 分支**(controller 恒 native harness)、**desktop 层全无 vitest**、**tools 校验逻辑**、**RN shim 层**。 |
| (c) mock 保真度 | **高**。Yahoo mock 用真实 `{raw,fmt}` 包装形态,HK_QUOTE_BODY 注明「HK 实测形状(2026-08-20)」并复刻 quarterly 键名差异(`incomeStatementHistory` vs `...Quarterly.incomeStatementStatements`);finnhub PROFILE 与 profile2 顶层字段逐一对应;chartBody meta 含 exchangeTimezoneName/firstTradeDate(分页契约)。无发现因 mock 形状偏差而掩盖的解析 bug。 |
| (d) suite 健康度 | testTimeout 15s 已落(vitest.config.ts:7,注释含实证背景);fake timers/env 全部 afterEach 还原(gates/yahoo-collect/committee 先例一致);live.integration `skipIf(!SOA_LIVE)` 干净跳过(即唯一 skip)。残余风险见 TQ3/TQ5/TQ6/TQ8。 |

## 发现表

| ID | 严重度 | 标题 | 证据(file:line + 引文) | 影响 | 建议修法 | 置信度 |
|---|---|---|---|---|---|---|
| TQ1 | P2 | us+finnhub 采集绑定链零测试(controller 绑定分支 + glue 三分派) | app/lib/analysisController.ts:341-344 `const finnhub = m === 'us' && s.settings.keys.finnhubApiKey.trim() ? { apiKey: … } : null`;test/analysis-controller.test.ts:240 仅负向断言 `expect(h.collectCalls[0].finnhub).toBeNull(); // 非 us → 无 finnhub`,全文件 grep 无 `'us'` start 用例;app/hooks/useAnalysis.ts:100-107 webImpls.us 闭包捕获 finnhub + :108-114 device 直取分支均在无 React 测试基建的 glue 内 | 回归(键 trim 笔误/市场门写反/us 闭包漏捕获)→ 美股 industry 富化静默消失或采集错路,**无任何失败信号**;E4 只护住了链路最末端(collectYahooForDevice × finnhub) | controller 测试加 2 例:`start('AAPL','us')` + settings 带 finnhubApiKey → 断言 collectCalls[0].finnhub 非空且值 trim 过;glue 的三分派逻辑若保持不可测则至少在 collectorSelection 或文档锚定(现 selectCollector 本身已有 5 用例) | 0.85 |
| TQ2 | P2 | desktop/child.mjs STORE_OP_VALIDATORS(A5 纵深校验)零自动化测试 | desktop/child.mjs:170-217 `const STORE_OP_VALIDATORS = { putStock(args) { if (args.length !== 1) return '…' } …}`、:213-216 `checkStoreOpArgs`、:250-253 gate 调用点;glob `desktop/**/*.{test,spec}.*` = 空(desktop 无任何 vitest 文件,vitest 默认 include 可扫到但不存在) | U11 新增的安全校验(形状白名单 + 路径分隔符拒绝)回归无守门:误拒合法 op → 桌面端所有写操作坏;漏放恶意形状 → A5 纵深失效;child↔main 协议(pendingOp/ack)也无契约测试 | child.mjs 是纯 Node ESM,可直接进根 vitest(checkStoreOpArgs 导出或 `import { createChildForTest }`);最小做法:抽 validators 表为可导入纯函数 + test/desktop-child-validators.test.ts 真值表(合法 6 op / 非数组 / ticker 带 `/`/`\` / args.length 边界) | 0.9 |
| TQ3 | P3 | server.mjs Host 头校验函数模块私有且零测试(createAppServer 整体无请求级测试) | app/server.mjs:61-62 `function isLoopbackHostHeader(host)`(不导出,d.ts 注释「纯入站策略,不导出」)、:89-92 `isLoopbackBind(addr)`、:110-113 gate `if (isLoopbackBind(req.socket.localAddress) && !isLoopbackHostHeader(req.headers.host)) { res.writeHead(403)…}`;test/server-static.test.ts 仅覆盖 serveStatic 畸形 URL 三例 | U12 安全硬化的边界变体(`localhost.`尾点/`LOCALHOST`大小写/`[::1]:8090`/`127.0.0.1:70000`端口越界/`foo.localhost` rebinding 后缀)无回归网;重构时静默破坏只能靠人工走查。注: 该项已在 findings_verified Backlog 记录(U12 F2 socket 层集成测试),此处为确认其现实性 + 给出更低成本方案 | 两函数为纯函数:导出(或经 `createAppServer` 注入)后加真值表测试;或仿 proxies.test.ts 注入模式做 createAppServer + fetch Host 变体冒烟(覆盖 backlog 的「socket 层集成」诉求的一半成本) | 0.8 |
| TQ4 | P3 | tools/configure-android-signing.mjs 严格 base64+keystore magic 校验零测试 | tools/configure-android-signing.mjs(U10 改造,:159 区域严格校验 + JKS 0xFEEDFEED/JCEKS/PKCS12 magic);glob `tools/**/*.{test,spec}.*` = 空;release.yml:144-145 直接 `node tools/configure-android-signing.mjs` 于发布日执行 | 校验规则回归(URL-safe base64、>64KB keystore 的 DER 长度字节 0x83 边界、trim 行为)只能在 CI 发布日暴露,失败形态=发布红或坏签名入库 | 抽 validate 函数为可导入纯函数 + 真值表用例(合法 32B base64 过/garbage 拒/截断拒/三 magic 各一例/0x30 0x83 大 keystore 决策显式化) | 0.75 |
| TQ5 | P3 | live.integration.test.ts 钉死 xdxr 条数与最近分红事件 → 真实分红后探针恒假红 | test/live.integration.test.ts:31-35 `const xdxr = await getXdxrInfo(client, 1, '600036'); … expect(xdxr.length).toBe(67); … expect(\`${lastDiv.year}…\`).toBe('20260710'); expect(Math.abs(lastDiv.fenhong! - 10.03)).toBeLessThan(1e-6)` | 600036 下一次分红除权(预计 2027 中期)后,SOA_LIVE=1 手工探针必失败且失败点在数据新鲜度而非被测代码 → 探针失去回归价值,倾向被直接删除 | 断言改结构性:`expect(xdxr.length).toBeGreaterThanOrEqual(67)` + 日期单调递增;fixture 逐位比对保留在 qfqAdjust 段(该段用历史窗口,天然稳定) | 0.9 |
| TQ6 | P3 | 全仓无 CI 测试门:唯一 workflow 为 release 构建,vitest/tsc 从不在 CI 执行 | glob .github/workflows/* = release.yml 仅此一个;其 step 清单(:26-96 desktop 构建矩阵、:106-189 android 构建)**无 npm test / typecheck 步骤** | 581 用例 + 双 tsc 门只在开发者本地跑;回归可无声合入 master(release 时 expo export/gradle 只能拦编译错,拦不住行为回归) | 加 push/PR workflow:`npm ci && npm test && npm run typecheck`(+可选 `cd app && npx tsc --noEmit -p tsconfig.json`);无需 secrets,分钟级 | 0.9 |
| TQ7 | P3 | RN 运行时 shim 层 ~646 行零测试(punycode-shim 含完整 RFC 3492 实现) | app/lib/punycode-shim.ts:1-3 「实现 RFC 3492 的完整编码/解码算法」、:38 `export function encode`、:86 decode、:137 toASCII;接线于 metro.config.js:60-62 `'punycode' → lib/punycode-shim.ts`(markdown-it@10 normalizeLink 消费);net-shim 77 行/zlib-shim 251 行/async-hooks-shim 42 行同零测试 | punycode 编解码 bug → RN 端报告渲染(markdown-it 链接 IDNA 归一化)对非 ASCII 域名出错;此类算法码是典型「一次写对、回归无感」面,标准 punycode@2 有公开测试向量可平移 | 平移 punycode@2 官方测试向量(RFC 3492 附录样例 + 中文域名)~15 用例即可全覆盖 encode/decode/toASCII;net/zlib shim 属传输胶水,优先级低 | 0.7 |
| TQ8 | P3 | vitest 下 runner 单例 FileStore 持久化静默失效:「端到端」用例实际只验证内存镜像语义 | app/lib/runner.ts:38 `export let store = detectPlatform() === 'web' ? new IdbStore() : new FileStore()`(Node/vitest → FileStore 无 fs 适配器);src/store-file.ts:95-97 `backend(): if (this.fs) …; return getExpoBackend(this.baseDir)`(动态 import('expo-file-system'));实测根目录 UNRESOLVABLE;src/store-file.ts:136-141 enqueue `.catch((err) => logError('FileStore 落盘失败:…'))` 吞掉 | store-gates.test.ts:198-/yahoo-collect.test.ts 引 runner store 的用例中,每次 putStock/addDatas 的落盘 op 都走 catch 记日志(内存镜像正确所以断言全绿):持久层回归在这些文件不可见;且每用例产生 logError 噪声 | 测试内 `setStore(new InMemoryStore())`(setStore 已有且 store-node.test.ts:64-87 已验证 live binding)替代裸单例;或在 runner.ts 提供 `createNodeFileStore(tmpdir)` 缺省,使 e2e 用例真正覆盖落盘读回 | 0.75 |

## 覆盖缺口 top10(按风险降序)

1. **us+finnhub 绑定链**: analysisController:341-344 绑定 + useAnalysis:100-114 三分派 —— 零断言正向路径(TQ1)。
2. **AnalysisController web 平台分支**: makeHarness 恒 `platform:'native'`(analysis-controller.test.ts:78),`proxyBase=location.origin+'/llm-proxy'`(:329-331)与 `platform!=='web' → injectDeviceStore`(:217)从未执行;web 打包回归仅靠 verify 阶段手工矩阵。
3. **desktop/child.mjs STORE_OP_VALIDATORS**: 安全纵深零测试(TQ2)。
4. **server.mjs Host gate + createAppServer 请求路由**: 私有纯函数零测试(TQ3;已知 backlog)。
5. **useAnalysis 胶水整体**(141 行): deps 接线(useMemo [] 闭包新鲜度、applyCapabilitySwitches 映射、订阅先于 bootstrap 的时序承诺)无任何锚 —— E1 关闭后有意留下的残余面,建议至少一条「deps 形状」架构断言纳入 architecture.test.ts。
6. **tools/configure-android-signing.mjs 校验逻辑**(TQ4)。
7. **RN shim 层**(punycode/net/zlib/async-hooks,TQ7)。
8. **desktop/main.mjs + preload.cjs 整层**(窗口创建/preload 恰 4 方法/协议转发): 零测试 —— 结构性既有缺口(preload 白名单曾入上轮 clean-list 人工核验),维持人工走查现状可接受,记录防丢。
9. **src/env.ts + progress.ts safe 家族直测缺失**: envValue 5 行、safe* 4 函数 —— 间接覆盖存在(agents.test.ts:306 spy-updater-throws 用例 + architecture 契约 6 静态扫描),风险最低,补直测属 polish。
10. **live.integration 探针腐烂**(TQ5)—— 覆盖存在但会过期失效。

## Verified-clean 抽检清单(≥3)

1. **runner busy 守卫测试确定性**(test/runner.test.ts:69-105): 同 tick 双 run 不 await → 以「'开始分析' 恰 1 条 + error 恰 1 条 + p2 resolve undefined」在同 await 前证明同步置位;token 恰 9/roleStatus 恰 18 计数钉死第二 pipeline 未启动;失败复位(done/catch/busy 三路径)各有独立用例。删守卫必红,非 tautology。
2. **market 规范化真值表**(test/market.test.ts:7-108): 北交所前缀 430047/830799→null、7 位→null、'09988'→hk 且 normalizeTicker('09988','hk')='9988.HK'(官方 4 位码钉死)、US 保留 `.`/`-`、跨市场严格校验 10 例负样本 —— 与 src/market.ts 正则逐条对齐,无遗漏边。
3. **composeYahooOverview 字段级映射**(test/yahoo.test.ts:296-380): CN 22 键逐字段断言(含 amplitude/turnover_rate 计算式 toBeCloseTo(…,6))、previousClose→chartPreviousClose 回退、`{}` 值形态 → NaN、capital 双股本 —— mock 用真实 `{raw,fmt}` 包装,保真度高。
4. **B3 字段级合并回归**(test/yahoo-collect.test.ts:637-736): NaN/空串不覆盖好槽、新有效值更新、**0 合法**(区分 isFinite 与 truthy)、缺键(60d)保旧 —— 4 例恰好覆盖 U6 设计的四条合并规则,删 mergeOverview 即红。
5. **超时链确定性**(test/yahoo-collect.test.ts:580-634): hangingFetch + fake timers advanceTimersByTimeAsync(YAHOO_REQUEST_TIMEOUT_MS) → 断言 `signal.aborted === true` 且 YahooApiError code='timeout',client 与 fetchChartWindow(device 全局 fetch)两环各一例 —— 无真实等待,无计时脆弱性。

## 待查线索(证据不足,不入发现)

- DDG html 解析(SAMPLE_HTML,web-search.test.ts:41-57)依赖 `result__a` 类名结构 —— 无法静态验证当前线上 DDG markup 是否仍匹配;若 DDG 改版,parser 会静默返回空(有占位兜底,不崩)。下次联网验证时可顺手核对。
- mcp SSE_INITIALIZE fixture 与真实 MCP 网关的 session/nonce 语义一致性: 测试自洽但真实端点行为仅有 Python 时代佐证。

## 未覆盖面声明

- 未运行任何测试/lint/tsc(任务约束;客观基线引用会话实证:580 通过+1 跳过、双 tsc 0)。
- app/components/*.tsx、App.tsx、DataScreen.tsx 等 UI 渲染层不在本切片(suite 无 React 测试基建,UI 由 verify 矩阵 + 集成 E2E 兜底;相关缺陷归 AppLibUiReview/AppRN 切片)。
- fixtures/ 数据文件的内部正确性未复核(600036_daily.json 与 Python 导出的逐位一致性已由 indicators/qfq 测试隐式钉住)。
- release.yml 构建步骤的正确性(A 系切片范围);.trellis/spec/ts/testing.md 之外的 spec 文档漂移未系统排查(E8 已修三条,未发现新增漂移)。
- Kotlin/Android 侧测试(app/android)完全未审(仓库无 Kotlin 单测目录,U25 通知权限的验证走 gradle 构建,归 DesktopToolsCi/Ci 切片)。
