# 采集链全新审读(Collectors)— 2026-08-23, HEAD e4d8680

## 范围与方法

**范围**: src/yahoo/ 六文件(deviceYahooCollect / yahooClient / webYahooCollect / applyYahooCollectedToStore / composeYahooOverview / composeYahooReports)、src/finnhub/finnhubClient.ts、src/tdx/ 四文件(quoteClient / xdxr / f10Client / deviceCollect)、src/billionsClient.ts、src/billionsTools.ts、src/collector.ts、src/f10.ts、src/mcp.ts、src/webCollect.ts、src/webSearch.ts。关联面延伸阅读: app/lib/proxies.cjs(代理锁/超时语义)、app/lib/runner.ts + app/hooks/useAnalysis.ts + app/lib/analysisController.ts(亿信/MCP/Finnhub 接线)、app/lib/polyfill.ts(Hermes 面)、app/lib/settings.ts(开关默认)。

**方法**: 纯静态通读全部目标文件全文(read,非节选);对照 spec(ts/hk-us-data.md、ts/tdx-data.md、core/data-acquisition.md、ts/rn-runtime.md)与上轮基线 findings_verified.md(REFUTED/investigated-not-bug 不重报);任务点名项逐一核验(B1/B3 修没修 + 同款模式全仓扫、cookie/A3/crumb 生命周期、finnhub key 缺失路径、tdx 连接超时、SSRF 面、billions 错误映射);运行时依赖实证(node_modules/react-native@0.86.2 与 abort-controller 包源码 grep 取证)。未运行任何 build/lint/test/server。

## 上轮修复核验(任务点名项先行回答)

- **B1 已修**: `yahooClient._request`(:229-241)全部出网经 `fetchWithTimeout`(40s,`YAHOO_REQUEST_TIMEOUT_MS=40_000`:65,< 代理 504 定时器 45s);`fetchChartWindow`(deviceYahooCollect:139-146)同常量;Hermes 兼容手写 setTimeout+AbortController(yahooClient:78-95)。TdxClient 全部创建点带 `connectTimeout: 8000, requestTimeout: 12000`(proxies.cjs:166、deviceCollect.ts:131、tools/probe.mts:87)。504 早答+锁到 settle 的 W4 语义保持(proxies.cjs:225-241 / :309-325)。
- **B2 残余已修(U5)**: `_obtainA3` 先状态码无关解析 Set-Cookie(yahooClient:215-221),fc.yahoo.com 404 带 A3 不再抛;确无 A3 才按 HTTP 语义抛错。
- **B3 已修(U6)**: `mergeOverview` 字段级合并(applyYahooCollectedToStore:47-56)+ `isUsableOverviewValue`(:58-63,Number.isFinite 数值门——0 合法;空串字符串门);putStock 走合并(:92-97),name 同字符串规则(:94);skipDaily 保 lastDataUpdate(:99-103);reports 批内 report_date 去重(:107-119)+ PK 幂等。**变体排查未发现新洞**: CN 链 putStock overview 恒 null(webCollect.ts:47,契约注明);capital 只进 run opts 不落槽;reports append-only 无覆写面;DataScreen 写路径上轮已证伪(仅展示)。
- **E9 已修(U8)**: proxies.cjs `isYahooMarket` adapter 单源 `yahooMarketOfTicker`(:254-261),gate 双校验(:297)。

## 发现表

| ID | 严重度 | 标题 | 证据(file:line + 引文) | 影响 | 建议修法 | 置信度 |
|---|---|---|---|---|---|---|
| C1 | **P1** | billionsClient/mcp 用 `AbortSignal.timeout` —— RN 真机(Hermes)恒 TypeError,亿信/TDX-MCP 功能在 Android 整体静默失效 | ① src/billionsClient.ts:124 `signal: AbortSignal.timeout(timeoutMs)`(_post 唯一网络出口);② src/mcp.ts:95 `signal: AbortSignal.timeout(this.timeoutMs)`、:139 `AbortSignal.timeout(10_000)`;③ src/yahoo/yahooClient.ts:67-69 同仓已实证约束「AbortSignal.timeout 静态 API 在 Hermes 未打补丁、不可靠 → 手写 setTimeout + controller.abort()」;④ app/lib/polyfill.ts:97-102 仅补 `throwIfAborted`,无 timeout 补丁;⑤ 运行时实证: app/node_modules/react-native/Libraries/Core/setUpXHR.js:41-43 全局 AbortSignal 来自 `abort-controller@1.x`,该包 dist **grep 'timeout' 零命中**(无静态 timeout 方法)→ Hermes 上调用即 TypeError;⑥ 接线面全平台生效: settings 默认 tdxMcp/billionsMaster=true(app/lib/settings.ts:49-52),useAnalysis.ts:104-111 fetchIntel → makeMcpIntel/makeBillionsIntel,analysisController.ts:392 assembleTools → makeBillionsTools(runner.ts:231-234) | Android 真机一旦配置 TDX_API_KEY / BILLIONS_API_KEY(使用这些功能的前置条件): 亿信 fin_db/search/twitter/fetch 每次调用在 `_post` 内抛 `TypeError: AbortSignal.timeout is not a function`,被 cappedCall/makeBillionsIntel 吞成「查询失败」占位文本;TDX MCP 实时情报恒「查询异常」。两族功能整体失效且被降级机制掩盖(key 正确与否无关)。web(现代浏览器)/桌面(Node≥18)不受影响 | 复用 yahooClient.fetchWithTimeout 的手写 setTimeout+AbortController 模式(提共享 util 或各内联);或按 rn-runtime.md 规则在 polyfill.ts 补 `AbortSignal.timeout` 静态方法(平台中立、幂等) | 0.85 |
| C2 | P2 | FinnhubClient.companyProfile2 裸 fetch 无超时 —— B1 同款残余,U4 只覆盖了 Yahoo 链 | src/finnhub/finnhubClient.ts:57 `resp = await this._fetch(url);`(无 signal/timeout);对照项目新标准 yahooClient.ts:64-65「采集链任何单次请求最迟 40s 内 settle」。两个调用点都在采集链 await 主干上: webYahooCollect.ts:27(浏览器,collectYahooViaProxy 在 applyCollectedToStore **之前**)、deviceYahooCollect.ts:399(真机,collectYahooPayload 之后 applyCollectedToStore **之前**) | Finnhub 端黑洞连接(建连成功不回包)时分析 start() 卡在 mergeFinnhubIndustry 直至平台层兜底(web Chrome ~300s 才报错;RN 靠 OkHttp 私有默认值,无应用层契约)——与 U4 刚建立的「采集链每请求有界」标准不一致;最终 warn 忽略不崩 | 改为 `fetchWithTimeout(this._fetch, url)`(yahooClient 导出复用,零新依赖) | 0.9 |
| C3 | P2 | obtainA3 模块级缓存无失效机制 —— A3 本身失效后 401 自愈链路无效,quoteSummary 永久降级直至进程重启 | deviceYahooCollect.ts:58 `let firstSetCookie: string \| null = null;` + :63-72(非 null 即返回,仅失败回写 null 哨兵;无 TTL/无失效回调);yahooClient.ts:170-171 401 时仅清**实例**字段(`this._crumb = null; this._a3 = null`)→ :210-214 `_obtainA3` provider-first `const v = this._cookieProvider(); if (v !== null && v !== '') return v;`;provider 为 `() => a3`(deviceYahooCollect.ts:397 真机 / proxies.cjs:270 server)恒返回同一陈旧值 | Yahoo 轮换/集中吊销 A3 后: getcrumb 可能仍成功但 quoteSummary 二次尝试仍 401 → 抛 crumb 错误 → quoteSummaryOrNull 降级(warn):概览仅剩 chart meta 字段(PE/PB/eps/52w/reports 全空);此后每次采集都复用同一死 A3,自愈机制形同虚设,直到 App/server 重启。数据质量退化而非丢失、触发频率低 → P2 下界 | client 二次 401 后通知 provider 层清缓存(导出 `invalidateA3Cache()` 或 cookieProvider 升级 {get,invalidate} 形状);保持 B2 已定案的 null=哨兵语义不变 | 0.7 |
| C4 | P3 | US 无效符号报「无法解析港股代码」—— 错误文案市场错配 | deviceYahooCollect.ts:334 `if (symbol === null \|\| result === null) throw new Error('无法解析港股代码');`;US 分支 candidates=[ticker](:296-303 一带),拼错/退市美股 404 耗尽候选后走同一出口(hk-us-data.md §4 只为 HK 场景定义该文案:「HK 候选全 404 → 无法解析港股代码」) | 用户输入无效美股代码看到港股文案,误导排查;server 路径经 502 透传同一文案(proxies.cjs:321) | 按 ticker 形态分支文案(如 `无法解析代码:${ticker}` 或 hk/us 各自文案) | 0.95 |
| C5 | P3 | composeYahooOverview.amount 用 regularMarketDayVolume(量字段)当成交额,与同链 snapshot.amount=NaN 结论矛盾 | composeYahooOverview.ts:103 `const amount = firstFinite(metaRec['regularMarketDayVolume']);`;deviceYahooCollect.ts:219 `amount: NaN, // Yahoo 无标准成交额字段(chart meta 仅部分响应含,概览 same 语义)` —— 同一链路两处对「Yahoo 有无 amount 字段」结论相反;regularMarketDayVolume 即便出现也是成交量(股数)而非成交额(币) | 若 meta 出现该字段,概览「成交额」显示股数(单位错);若从不出现则恒 NaN 无实害。低置信窄触发 | 对齐 snapshot 语义置 NaN,或先实证该字段真实语义再消费(头注自称 S5 可 volume×price 估算) | 0.5 |
| C6 | P3 | webSearch 直连链(tavily/ddg html/news.js/vqd)裸 fetch 无应用层超时 | webSearch.ts:45 tavily POST、:157 news.js GET、:174 html.ddg POST、fetchVqd(:150 一带)均无 signal/timeout;server /web-search 有 20s Promise.race(proxies.cjs:335/:356-361)但底层请求不取消,defaultSearcher 非 web 分支(webSearch.ts:110-116)真机/Node 直连完全无超时 | agent 工具阶段挂起至平台 socket 兜底;server 侧客户端 20s 已得 504 但请求继续占用连接。无互斥锁,B1 的 429 连锁危害在此不存在 | 统一接 fetchWithTimeout(与 C2 同一批处理) | 0.75 |

## Verified-clean 抽检清单

1. **B1 修复实证**: fetchWithTimeout 手写模式(yahooClient.ts:78-95)含 finally clearTimeout、独立 controller/每请求;_request(:229-241)/fetchChartWindow(deviceYahooCollect:139-146)全覆盖,401 crumb 重试同样经 _request;测试钉住(test/yahoo-collect.test.ts:581 describe「B1:…40s < 45s」)。
2. **B3 修复 + 变体排查**: mergeOverview 对 incoming 缺失键 spread→undefined→保旧 ✓;0 合法(isFinite 门)✓;CN overview 恒 null 为契约注明的设计(webCollect.ts:47 注释「CN 存 null」);reports/capital 无覆写变体。
3. **U5/B2 残余修复**: _obtainA3 先 parseA3FromSetCookie 状态码无关(yahooClient.ts:215-221),注释单源指向 parseA3FromSetCookie(:55-61),与 deviceYahooCollect.obtainA3 契约呼应。
4. **SSRF 面**: /llm-proxy 双防线 normalizeBaseUrl(scheme/userinfo/hostname,proxies.cjs:57-70)+ isPublicHost(DNS all 地址私网黑名单:CGNAT/169.254/198.18/IPv6 ::1,fe80::/10,fc00::/7 等,:82-100);billions_fetch url 本地 http(s) 校验(billionsTools.ts:297-299);/tdx-collect `^\d{6}$`(:196 一带)、/yahoo-collect 正则+市场双 gate(proxies.cjs:297)。
5. **finnhub key 缺失路径**: companyProfile2 无 key 零网络返回 null(finnhubClient.ts:51-52);mergeFinnhubIndustry `market!=='us' || !finnhub?.apiKey` 早退(webYahooCollect.ts:21-24);analysisController 仅 us+trim() 非空构造(:341-344);失败 warn 忽略符合 error-handling degrade 语义。
6. **GBK/iconv 规范符合**: f10Client stripGbk iconv-lite(f10Client.ts:22-27,无 TextDecoder——tdx-data.md 契约);parseCategoryResponse 152 字节行界守卫(:31-42);parseXdxrResponse 行界 `pos+29 <= body.length` 守卫(xdxr.ts:33-35)。
7. **crumb/限频其余生命周期**: 每 collect 新建 YahooClient(server proxies.cjs:270 / 真机 deviceYahooCollect.ts:397)→ crumb 实例缓存即 per-collect,无跨采集陈旧;401 刷新重试一次有测试钉住(test/yahoo.test.ts:197-240);候选试探对 404 继续/其余中止的语义与 hk-us-data.md §4 错误矩阵一致。

## 待查线索(无充分实证,不列发现)

- handleLlmProxy 上游转发无显式超时/空闲兜底(proxies.cjs:143-160): 流式透传设计不宜硬超时,实际依赖 undici headersTimeout(~300s);是否需要 idle-timeout 属产品决策。
- f10.ts:72-73 行单元格数少于期数时 `value_raw` 为 undefined(类型标注 string): 生产代码无 value_raw 消费方(grep 仅测试构造 fixture),纯类型漂移。
- billionsClient._post 错误 code 提取 `dataObj['error'] || dataObj['code']`(:159-163): error 为对象时 String() 产出 '[object Object]'(cosmetic)。
- mcp SSE 解析不到含 result/error 的 data 行返回 {} → TdxQueryResult.code=-1/message='' → 文案「通达信 MCP 查询失败：」缺因(mcp.ts:110-121 + :259 一带)。
- toNum 不处理千分位逗号(f10.ts:16-25): 若真实 F10 文本含逗号数值则 NaN(未取得真实样本实证)。

## 未覆盖面声明

- node-tdx-market 库内部 TCP 帧/心跳/断线重连实现细节(仅核验了全部创建点的 connectTimeout/requestTimeout 参数与 polyfill 记录);
- src/llm.ts、toolLoop/agents/committee 图编排与 prompt 逻辑(属 AgentsLlmReview 切片);
- store-* 存储实现、desktop/Electron 壳、CI/workflow(其他切片);
- 实网行为: Yahoo/Finnhub/DDG/MCP 响应形状取信 research/yahoo-api-verified.md 与 spec Gotchas 记录,本次未发任何真实网络请求;
- proxies.cjs handleLlmProxy 流式转发仅静态走查,未启动服务实测。
