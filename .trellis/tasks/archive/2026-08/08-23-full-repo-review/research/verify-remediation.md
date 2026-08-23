# 上轮整改落地核验(VerifyRemediation)

> 范围: `.trellis/tasks/archive/2026-08/08-22-repo-review-remediation/findings_verified.md` 全部 CONFIRMED/PARTIAL 条目(~36 行,含 U32 新增3)。
> 方法: 纯静态分析。逐条对 HEAD `e4d8680` 源码定位锚点(file:line+引文),独立判定 fixed / partially-fixed / not-fixed / regressed;不采信回填表自述。
> 关联 commit: 678b3c2..e4d8680 共 33 个整改提交全部在史(git log 实证);近期补丁 b6495df(U32)/2ffe82f(E10)/abe362a(E4) 已覆盖。

## 一、核验矩阵

| ID | 原判 | HEAD状态 | 当前锚点(file:line) | 备注 |
|---|---|---|---|---|
| A3 | CONFIRMED minor | **fixed** | .github/workflows/release.yml:39-51(desktop job)+ :115-127(android job) | 双 job 硬门禁:`pkg_version="$(node -p "JSON.parse(...)")"` vs `${GITHUB_REF_NAME#v}`,不等 `exit 1`;均置于任何消费 version 的步骤前,`if: startsWith(refs/tags/)` |
| A4 | CONFIRMED minor | **fixed** | tools/configure-android-signing.mjs:146-160(base64ValidationError)、:168-176(looksLikeKeystore)、:196-215(main 校验先于写入) | 先 `replace(/\s+/g,'')` 剥空白 → 字符集/长度%4/填充正则 → 解码重编码往返比对(拦 'AAB=');JKS 0xFEEDFEED/JCEKS 0xCECECECE/PKCS12 0x30 0x82 魔数;错误消息只含 env 名不含值;死 try/catch 复活为兜底并注释说明 |
| A5 | PARTIAL→polish | **fixed** | desktop/child.mjs:170-216(STORE_OP_VALIDATORS 六 op 形状表)、:213-217(checkStoreOpArgs 白名单+形状合一)、:250-254(dispatch 前 gate) | isTicker 拒 `[\\/]`(:161/:175/:192/:199);纵深定位注释保留(:123-131);合法路径不变 |
| A6 | CONFIRMED polish | **fixed** | app/server.mjs:57-85(isLoopbackHostHeader:localhost/127.0.0.0/8/[::1] 含 v4-mapped,尾点容忍)、:88-94(isLoopbackBind)、:100-114(gate 先于路由,403 无日志) | XFH 不信任(:104);HOST=0.0.0.0 远程契约保持(loopback bind 才启用,:105-107) |
| B1 | CONFIRMED major | **fixed** | yahooClient.ts:47-52(YAHOO_REQUEST_TIMEOUT_MS=40s<45s)、:55-71(fetchWithTimeout 手写 setTimeout+abort,Hermes 兼容)、:222-236(_request 接线,timeout 归一 YahooApiError('timeout',null));deviceYahooCollect.ts:66(obtainA3)、:148(fetchChartWindow);测试 test/yahoo-collect.test.ts:581-635(挂死 fetch→abort 断言 signal.aborted) | 单请求 ≤40s settle → 代理锁必在有限时间释放(分页 N 窗口最坏 N×40s,有界);504 定时器语义未动(app/lib/proxies.cjs:315-319) |
| B2残余 | 主项REFUTED+残余一行 | **fixed**(残余) | yahooClient.ts:196-216:_obtainA3 先 `parseA3FromSetCookie(resp.headers.get('set-cookie') ?? '')`(:207-208)状态码无关,有 A3 即返回;无 A3 且 !resp.ok 才走 _errorFrom(:211-212) | 测试 yahoo.test.ts:159-172(404+Set-Cookie→成功且带 AbortSignal,U5×U4 组合)、:175+(404 无 cookie→原 404 语义);主项 null 哨兵维持不修(deviceYahooCollect.ts:57-73,失败写回 null=下次重抓,正确) |
| B3 | CONFIRMED minor | **fixed** | applyYahooCollectedToStore.ts:52-62(mergeOverview 字段级合并)、:64-68(isUsableOverviewValue:Number.isFinite(0 合法)/字符串非空)、:83-97(putStock 合并,name 同规则 `payload.name \|\| existing?.name \|\| payload.ticker`) | skipDaily 时 lastDataUpdate 保旧(:93-95);测试 yahoo-collect.test.ts:637+(好数据保留/0 合法/缺键保旧) |
| B4 | CONFIRMED minor | **fixed** | deviceYahooCollect.ts:186-208(prevCloseOf:`if (lastIsToday) return bars.length >= 2 ? bars[bars.length-2].close : NaN;` :207) | 注入门 !Number.isFinite → compose 与 CN overview.ts:84 对齐;CheckU7 已记录的残余边(chartPreviousClose 恰等于首根 close → change_pct=0)注释明示(:204-206),非本轮范围 |
| E9 | CONFIRMED minor-polish | **fixed** | app/lib/proxies.cjs:22(`require('../../src/yahoo/webYahooCollect.ts')` 取 yahooMarketOfTicker)、:255-264(isYahooMarket try/catch adapter,非法/cn→false) | 测试 proxies.test.ts:325-385(真值表+与分类器一致性+gate 集成 _collect 注入);doYahooCollect 注释同步为「状态码无关解析」(:277-281) |
| C1 | CONFIRMED major | **fixed** | src/events.ts:185-193(catch:`emit({type:'error'})` + `running=false` + `return undefined`,零 rethrow,注释引 error-handling.md 契约);契约原文 .trellis/spec/error-handling.md:38-39;test/events.test.ts:118-141(断言 resolve undefined + error 事件 + 无 done,不再钉 rethrow) | 调用方适配实证:tools/probe.mts:68-72(`if (!report)` 分支)+:199-203(error 事件打印);控制器侧 catch 降为防御性兜底 analysisController.ts:401-405;「分析结束:耗时」仅成功打(:397-400) |
| C2/D10 | CONFIRMED minor | **fixed** | src/events.ts:81-83(`let running=false` 实例级)、:120-127(run() 入口任何 await 前 `if (running){emit busy error;return undefined} running=true`)、:183(done 复位)、:192(catch 复位);test/runner.test.ts:61-150(busy 拒绝/失败终态复位/完整运行复位回归) | __soa.start(App.tsx:91-92)直调被实例级守卫覆盖;busy 拒绝不改状态 |
| C3 | CONFIRMED minor(影响≈0) | **fixed** | src/store-idb.ts:249-273(close():同步置 closed 拦后续 enqueue → 清理任务挂写穿队列尾 = pending 写先落盘再清镜像/关连接);test/store-idb.test.ts:207-226(enqueue 后立即 close 不丢写,hydrate 可见) | StoreLike 同步 close():void 契约保持(spec stores 一致) |
| D1 | CONFIRMED→minor | **fixed** | app/App.tsx:54-59(`useEffect(...measureInWindow..., [showMarketMenu,width,height])` 菜单开着时 resize 重测) | native 旋转锁 portrait,effect 无害 |
| D2ghost(上轮新增) | 新增 minor | **fixed** | app/App.tsx:177-180(`animationType={Platform.OS === 'web' ? 'none' : 'fade'}`,native fade 走系统层无穿透);指南行 guides/cross-platform-thinking-guide.md:76(D2 反向结论入档) | |
| D4 | CONFIRMED minor | **fixed** | app/App.tsx:309-327(MENU_GAP=4;menuGeometry:maxLeft 右缘 clamp(:318-319)、下方放不下上翻(:321-325)、极端短视口贴顶注释) | 不选 maxHeight 截断的理由注释(:306-308,RNW Modal 无滚动条) |
| D5 | CONFIRMED→polish | **fixed** | app/App.tsx:346-347(`marketModalMenu: { position:'absolute', maxWidth:280 }`,注释 D5 与 clamp 同源) | |
| D6 | CONFIRMED minor | **fixed** | app/screens/SettingsPanel.tsx:45-52(mountedRef effect 置位/清理)、:58-61(update() 内 seqRef+=1 + setReach('idle'),卸载防御)、:83-88(saveAndCheck:`const seq=++seqRef.current` 先于 await;回调 `!mountedRef.current \|\| seq!==seqRef.current` → 丢弃) | 后发者胜/卸载丢弃/双击检查三竞态全闭合 |
| D7 | PARTIAL | **fixed** | app/lib/settings.ts:154-159(注释改述真实行为:POST 最小 chat/completions,ping+max_tokens:64,计费调用;不用 GET /models 的理由:覆盖不到推理链路)、:211-214(CORS 文案改「浏览器请求失败(CORS 或网络不可达)」,覆盖 Failed to fetch 双成因) | 零逻辑改动 |
| D8 | CONFIRMED→polish | **fixed** | app/screens/DataScreen.tsx:58-60(`today: bars.length ? bars[bars.length-1].date : asiaToday()`),字面量 '2026-08-10' 全仓清零 | 与 pipeline/gates 今天单源同源 |
| D9 | CONFIRMED minor | **fixed** | app/lib/analysisController.ts:269-274(onSettingsChange:`if (!this.st.running) this.st.error = null;` 运行中保留横幅) | 测试 analysis-controller.test.ts:365+ |
| D11 | CONFIRMED minor | **fixed** | app/modules/soa-keepalive/android/.../SoaKeepAliveModule.kt:17-20(每进程一次标志)、:63-80(maybeRequestNotificationPermission:TIRAMISU+ 未授权且有前台 Activity 时 requestPermissions,不等待结果不阻塞 FGS);AndroidManifest.xml:7 权限声明保持 | TS 侧静默降级语义不变(index.ts:30-33);运行时请求在 Kotlin 层落地 |
| D12(PARTIAL) | polish | **fixed**(范围内) | app/App.tsx 全文件 grep stopPropagation = 0 命中(冗余内层 onPress 已删);stale zIndex 注释替换为 DOM 顺序描述(:151-152:「与全屏点击层均未设 zIndex——命中顺序靠 DOM 顺序」) | 焦点陷阱 REFUTED 维持不修(RNW ModalFocusTrap 内建) |
| D13 | CONFIRMED polish | **fixed** | ReportContent.tsx:82(key={slot.title},静态双槽 title 互异);DataScreen.tsx:139(key={b.date})、:162(key={`${r.period}:${r.metric}`})、:180(key={r.report_date}) | 渲染输出/样式零改动 |
| D14 | CONFIRMED polish | **fixed** | IndicatorChart.tsx:138-141(createChart 加 `autoSize:true`,RO 驱动宽度回流,高度仍 CHART_HEIGHT 容器固定 :349) | web 分支生效;native WebView 分支不受影响 |
| D15 | CONFIRMED polish | **partially-fixed** | hasDone 生产链就绪:analysisController.ts:282-291(start 重置)、:450-451(done→true)、:452-455(error→false);useAnalysis.ts:53-54(暴露);但 App.tsx:269-275 「✓ 分析完成」仍仅 `progress.length>0 && !a.running`,hasDone 全仓零消费点 | 回填表称「✓分析完成仅 done 后显示」与 HEAD 不符;详见第二节 #1 |
| a11y#15 | CONFIRMED minor | **fixed** | App.tsx:137-139(触发键 accessibilityRole="button"+aria-expanded)、:200-201(容器 role='listbox')、:206-209(选项 role="option"+aria-selected) | 视觉/交互零改动 |
| E1 | CONFIRMED major | **fixed** | app/lib/analysisController.ts(纯 TS DI 控制器,零 RN 依赖)+ app/hooks/useAnalysis.ts:59-132(薄胶水 deps 接线);test/analysis-controller.test.ts(bootstrap 恢复/start 编排含北交所拦截与市场文案/事件归约/D9/D15/C1 侧,假 runner 驱动) | 对外 UseAnalysis 契约逐一保留+hasDone additive;web/native 三分支采集分派等价留在 glue(useAnalysis.ts:80-99) |
| E2+E3 | CONFIRMED minor | **fixed** | test/store-update-overview.test.ts:updateOverview 四实现矩阵(SQLite :memory::28-56 / InMemory:58-86 / FileStore:126-154 / Idb:195-222,各含 存在覆盖/不存在无操作/整体替换语义)+ listStocks/listMetaKeys(:156-174) | 15 用例级规模与回填一致 |
| E4 | CONFIRMED(nuanced) | **fixed** | test/yahoo-collect.test.ts:367-369(device+finnhub 签名核对)、:393(无 key 对照)、:408(degrade don't raise)——device×finnhub 组合 3 用例(abe362a) | 补的是 implement.md 计划遗漏行,非函数级缺口(上轮已定性) |
| E5 | CONFIRMED minor | **fixed** | test/proxies.test.ts:363-385(handleYahooCollect 400 gate 不触 _collect / 200 参数透传,_collect 注入缝) | 随 U8 d1cb50a 一并关闭 |
| E6 | CONFIRMED minor | **fixed** | test/settings-env-fallback.test.ts:62-96(env 三键补齐/已存键优先/缺键不误填/损坏存储兜底后 env 仍生效,4 用例) | release-config 依赖经动态 import+mem storage 解耦 |
| E7 | PARTIAL(逐符号) | **fixed** | src/ 全域 grep:makeInvestmentDecision/envDisabledBool/overviewNeedsRefresh/FetchScope 均 0 定义命中(switches.ts:7、:37 仅历史语义注释,fromEnv 替代 :39+) | 连带测试删除;.env.example 无残留提及 |
| E8 | PARTIAL(两条属实) | **fixed** | hk-us-data.md:15(§2 签名「去一前导零」)+:102-109(§7 pitfall 重写自洽,'00988' 反例/'09988' 正例);agents-tools.md:49-62(接线链更新至 useAnalysis deps 形态);chart-ui.md:21-27(financialTrendSeries 第三参 market 及币种标签) | 但 U13 引入一处新 spec 漂移,见第二节 #4 |
| E10 | CONFIRMED polish | **fixed** | src/market.ts 无 lotSize(全域 0 命中);spec 镜像同步(hk-us-data.md:12 MarketInfo 无 lotSize 字段) | promptRules 占位按设计保留 |
| E11 | PARTIAL(表述漂移) | **fixed** | test/demo-llm.test.ts(buildLlm(null) 兜底契约 :26-48 + PHRASES 路由矩阵 :51-105 含包裹形态/human 不参与/共存取更早者/内容块/无 system/缺 messages);safe() 家族契约入档 error-handling.md:90-92 | |
| 上轮新增3(suite 并行脆弱) | — | **fixed** | vitest.config.ts:8(testTimeout:15_000,注释载 2026-08-22 并发假超时实证);testing.md:13-14 入档 | |

### 统计

- 核验条目:**36**(A:4,B:5,C:3,D:14,E:9,新增3/U32:1)
- **fixed: 35 · partially-fixed: 1(D15)· not-fixed: 0 · regressed: 0**
- 整改引入的新问题(P3 文档/规格漂移):**3**(见第二节 #2/#3/#4);P2 缺口 1(D15 UI 消费缺失)
- REFUTED/investigated-not-bug 项(A1/A2/B2 主项/C4/D2 原/D3/D12 焦点陷阱/a11y#16)零代码改动复核通过:A1 的 startsWith(DIST) 守卫原样(server.mjs:44-47),B2 null 哨兵原样,C4 done-only 写缓存原样(analysisController.ts:447-451)。

## 二、partially-fixed / 新发现详述

### 1.(P2)D15「✓ 分析完成」未消费 hasDone —— 回填表声明与 HEAD 不符
- 回填表(findingss_verified.md 关闭表):「D15(U15 吸收)|U13|360681b|✓分析完成仅 done 后显示」。U13 任务书原文亦为「暴露 hasDone…App.tsx 将由 U16 消费」,而 U16 实际只做了 D1/D4/D5 几何,消费端从未落地。
- HEAD 证据:app/App.tsx:269-275
  ```tsx
  {progress.length > 0 ? (
    <View style={styles.progressBar}>
      {a.running ? (<Text>⏳ …</Text>) : (
        <Text style={styles.progressLine}>✓ 分析完成({progress.length} 步)</Text>)}
  ```
  失败链路(C1 后):error 事件 → s.error+s.hasDone=false(analysisController.ts:452-455)→ finally running=false(:410-412)→ 只要 ≥1 条 progress,横幅区同时呈现「✓ 分析完成(N 步)」+ 错误横幅 —— 与上轮 D15 描述的缺陷逐字相同。
- hasDone 全仓消费点 grep:仅 useAnalysis.ts/analysisController.ts/analysis-controller.test.ts,**app/ 渲染层 0 处**。
- 影响面:采集后 LLM 失败场景(有 progress)用户看到矛盾状态;原判 polish,维持 P2(因属「声称已关闭而实际未关」的验收缺口)。
- 修法(两行级):`{a.running ? … : a.hasDone ? (<Text>✓ 分析完成…</Text>) : null}`(或以 error 优先的三态渲染);App.tsx 为唯一消费点。

### 2.(P3)deviceYahooCollect.ts:9 头注残留 U5 前行为描述
- `// 但仍带 Set-Cookie A3(YahooClient 内部 fc 请求遇非 2xx 抛错)→ 预取后经 cookieProvider 注入`
- U5(b7ceafd)后 yahooClient._obtainA3 已改为状态码无关先解析 Set-Cookie(yahooClient.ts:205-212),「遇非 2xx 抛错」不再成立(仅确无 A3 时抛)。括号注与实现矛盾,误导后来者以为回落路径遇 404 必炸。
- 修法:括号内改为「YahooClient 回落自身 fc 请求,同样状态码无关解析(见其 _obtainA3)」。

### 3.(P3)proxies.cjs:315-316 Yahoo 定时器注释「底层无 AbortSignal 支持」已被 U4 过时化
- `// W4 同款:超时 timer 仅提前回 504 通知客户端,不打断采集(底层无 AbortSignal 支持);…`
- U4(cf3d42e)后 Yahoo 链每一请求经 fetchWithTimeout 以 AbortController 40s 自 abort(yahooClient.ts:55-71、deviceYahooCollect.ts:66/:148);「底层无 AbortSignal 支持」对 /yahoo-collect 已不成立(TDX 侧 :219-220 同款注释仍准确,TdxClient 确不支持)。设计本身(504 仅通知、锁保到真 settle)无需变,仅注释依据失真。
- 修法:改为「底层单请求 40s 自 abort(B1),但整链多请求串行,45s timer 仍仅提前回 504,锁保持到 _collect 真正 settle」。

### 4.(P3)chart-ui.md §UI 编排 未随 U13 抽取更新(新 spec 漂移)
- .trellis/spec/ts/chart-ui.md:74-79:「UI 编排(app/hooks/useAnalysis.ts + app/App.tsx…)— 分析编排(状态/启动链/runner 订阅/start 编排/设置保存)在 useAnalysis.ts」;frontmatter paths 亦无 app/lib/analysisController.ts。
- U13(360681b)后编排核心在 analysisController.ts,useAnalysis 仅 deps 接线+订阅转发(useAnalysis.ts 头注自述);该节描述 08-16 旧架构,违反「spec 与代码漂移算发现」基线。
- 修法:该节改述双层结构(controller=编排/glue=React 桥),paths 补 app/lib/analysisController.ts。

## 三、Verified-clean 抽检(≥3)

1. **A1 traversal 守卫未被整改波及**:server.mjs:44-47 `if (!file.startsWith(DIST)) { 403 }`(decode→join→startsWith 链原样);上轮实证否决结论仍有效。
2. **SSRF W2/W4 防线原样**:proxies.cjs normalizeBaseUrl(scheme/userinfo/host 校验)+isPrivateAddress 私网黑名单,LLM 代理转发前校验(:37-72 区域);与上轮 Good-coverage 抽检一致。
3. **R4「失败不写 lastRun」设计保持**:analysisController.ts done 分支才写缓存(:447-451),error 分支只置横幅不写;C4 investigated-not-bug 结论未被破坏。
4. **events 顺序断言未削弱**:events.test.ts ordering 用例保留(roleStatus 18 断言等 :100-116),C1 改动仅替换 error 路径用例(:118-141),其余未动。

## 四、未覆盖面声明

- 纯静态分析:未运行 vitest/tsc/expo export/Android 构建(客观基线由任务头给定:typecheck 0 错误,vitest 580+1skip);RNW Modal 动画/Kotlin 权限弹窗实机表现、web 打包产物未实测。
- desktop/main.mjs 的 pendingOp 协议与 preload 桥仅抽查(A5 聚焦 child 侧校验);desktop-ci 其余 clean-list 未重抽。
- tools/probe.mts 对 no-throw 契约的适配已核实(:68-72),但其 hk/us 全链运行行为未执行验证。
- 上轮 Verified-clean 清单(D 域十余条)仅抽 4 条复核,未逐条重验。
