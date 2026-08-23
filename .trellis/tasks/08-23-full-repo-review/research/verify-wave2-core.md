# Wave-2 对抗复核 — CoreLogic 切片(VerifyWave2Core)

> 2026-08-23 · HEAD e4d8680 · 只读取证(read/grep),未运行 build/test/server。
> 判定标准:`.trellis/spec/guides/index.md` rubric(FP 三模式:信任边界混淆/忽略设计注释/变量误读)。
> 方法:每条独立重走代码链路取证,不接受第一波转述;锚点行号全部本次实测。

## 汇总表

| 发现 | 原判 | 复判定 | 严重度建议 |
|---|---|---|---|
| F1 FileStore hydrate 裸 JSON.parse + 非原子写 → 损坏文件后桌面启动死循环 | P1 | **CONFIRMED** | 维持 P1 |
| F2 Electron 无 requestSingleInstanceLock,双开并发整文件覆写丢更新 | P2 | **CONFIRMED** | 维持 P2 |
| C2 FinnhubClient.companyProfile2 裸 fetch 无超时 | P2 | **CONFIRMED** | 维持 P2 |
| C3 obtainA3 模块级缓存无失效,A3 吊销后永久降级至重启 | P2 | **CONFIRMED** | 维持 P2 |
| AL2 toolLoop 收尾轮不校验 tool_calls → 空最终报告标 done | P2 | **CONFIRMED** | 维持 P2 |

---

## F1 — FileStore 零容错 hydrate + 非原子写(P1)→ CONFIRMED

三个待验子命题逐条实证:

**(a) parse 真无容错 ✓**
- `src/store-file.ts:107` `const rows = JSON.parse(text) as Record<string, string>;`(meta.json)与 `:115` `const data = JSON.parse(text) as TickerFile;`(<ticker>.json)均为裸解析,hydrate(:100-127)全函数无 try/catch;仅 `text == null`(文件不存在)有守卫,:106/:114 `if (text == null) continue;` —— 截断/损坏文本直接 SyntaxError 抛出。
- 抛出后沿 `ready()`(:91-93 `this.readyPromise ??= this.hydrate();`)缓存 rejection。
- 加重因素:hydrate 按 listDir 顺序迭代,**首个坏文件即中断整个循环** —— 单个 ticker 文件损坏 = 全库不可读。

**(b) 写入真非原子 ✓**
- `src/store-file.ts:145` `await fs.writeFile(joinPath(baseDir, \`${ticker}.json\`), JSON.stringify(payload));`、`:152` meta 同款 —— 整文件覆写语义。
- Node 后端 `src/store-node.ts:24-26`:
  ```ts
  async writeFile(path, data) {
    await fsWriteFile(path, data, 'utf8');
  },
  ```
  直接 open('w')+write,**无 tmp+rename、无 fsync**。进程 SIGKILL/掉电落在截断后写入完成前 → 磁盘留半截 JSON。(expo 后端 :54-57 `f.write(data)` 同为整文件直写,RN 侧同暴露面。)
- 触发面评估:正常退出路径已优雅化(child.mjs gracefulShutdown flush 后退;main.mjs SIGTERM/SIGINT 路由),但分析期间每次 putStock/addDatas/updateOverview/setMeta 都入队整文件重写(store-file.ts:171/:179/:189/:229/:246),kill -9/掉电命中写窗口的概率随使用时长累积,非理论边角。

**(c) child 崩溃 → app 整体退出且重启复现 ✓**
- `desktop/child.mjs:220-221`:
  ```js
  store = createNodeFileStore(storeDir);
  await store.ready();
  ```
  main() 内裸 await,无局部 catch → `main().catch`(:294-297)`console.error('[child] fatal:', err); process.exit(1);`
- `desktop/main.mjs:157-158`(child.on('exit')):`if (!quitting) console.error('[main] child exited unexpectedly — quitting'); app.quit();`
- 重启链:损坏文件仍在盘上 → 下次启动同一序列重演。**无任何隔离/跳过坏文件/备份恢复逻辑**,用户不手动删 `<userData>/store/*.json` 则永远起不来。

**FP 排查**:store-file.ts:128 注释「失败仅记录不阻断(决策 C)」只覆盖 enqueue 落盘失败(enqueue :132-134 catch logError),hydrate 解析无任何设计注释背书零容错 —— 不属「忽略设计注释」FP;损坏数据是本机磁盘真实故障态,非信任边界混淆。

**判定:CONFIRMED。严重度维持 P1**(触发概率中低但后果为「应用砖化 + 全量数据不可达,需手工修盘」,且 RN 移动端共享同一 hydrate/写入模式,移动端进程被杀远比桌面频繁)。

---

## F2 — 无单实例锁,双开 split-brain 丢更新(P2)→ CONFIRMED

**(a) 全仓确无单实例锁 ✓**:grep `requestSingleInstanceLock|second-instance` 于 desktop/app/src/tools 四目录 **零命中**(仅 .trellis 文档提及该词)。

**(b) 双开真共享同一 userData 子目录 ✓**
- `desktop/main.mjs:278-283`(app.whenReady):`const userData = app.getPath('userData'); const storeDir = path.join(userData, 'store'); ... spawnChild(...)` —— 无 `app.requestSingleInstanceLock()`、无 `app.setPath` 改写、无实例互斥;Electron 默认 userData 按产品名固定,同应用两实例必然同目录。
- 两 child 均 `server.listen(0)`(child.mjs:236 一带)**随机端口,互不冲突**,双双正常就绪 —— 双开不会被端口撞死,split-brain 静默成立。
- 各自 `createNodeFileStore` 独立内存 Map(store-node.ts:33-36)+ 整文件覆写(store-file.ts:145/:152)→ 同一 `<ticker>.json`/`meta.json` 后写者以自身内存镜像整体覆盖前者的更新,经典 lost-update;且并发写放大 F1 的撕裂窗口。

**判定:CONFIRMED。严重度维持 P2**(需用户双击双开才触发;后果静默丢数据,Windows 场景常见度高)。

---

## C2 — Finnhub companyProfile2 裸 fetch 无超时(P2)→ CONFIRMED

**(a) 确无 signal/timeout ✓**
- `src/finnhub/finnhubClient.ts:56-57`:
  ```ts
  try {
    resp = await this._fetch(url);
  ```
  fetch 无任何 options(无 signal/AbortController);全文件通读无超时包装;构造器 `fetchImpl ?? globalThis.fetch` 生产路径即裸全局 fetch。对照 U4 刚建立的同仓标准(yahooClient.ts:64-65 注释「采集链任何单次请求最迟 40s 内 settle」+ fetchWithTimeout :78-95),此为 B1 同款残余。

**(b) 调用在采集主干 await 链上 ✓**(两端均实证)
- web:`src/yahoo/webYahooCollect.ts:83-84` `await mergeFinnhubIndustry(payload, market, finnhub ?? null); return applyYahooCollectedToStore(store, payload, market);` → mergeFinnhubIndustry 内部 `:27 await new FinnhubClient(finnhub.apiKey).companyProfile2(payload.ticker);` —— 在 applyCollectedToStore **之前**。
- 真机:`src/yahoo/deviceYahooCollect.ts:398-400` `const payload = await collectYahooPayload(...); await mergeFinnhubIndustry(payload, market, finnhub ?? null); return applyYahooCollectedToStore(...)` —— 同样在入库前的主干上。

影响边界核对(与原判一致,无夸大):黑洞连接时 start() 卡在 mergeFinnhubIndustry 直至平台层兜底(web Chrome ~300s / RN OkHttp 私有默认值);最终 `catch → warn('Finnhub 公司画像合并失败,跳过…')`(:37-39)降级不崩。修复建议成立:yahooClient 已导出 fetchWithTimeout(deviceYahooCollect.ts:66 在用),零新依赖;注意勿用 `AbortSignal.timeout`(C1:Hermes 未补丁)。

**判定:CONFIRMED。严重度维持 P2**(低频、有平台兜底、降级不崩,但违背刚建立的「采集链每请求有界」标准)。

---

## C3 — obtainA3 模块级缓存无失效机制(P2)→ CONFIRMED

**(a) 缓存形态与失效缺失 ✓**
- `src/yahoo/deviceYahooCollect.ts:58` `let firstSetCookie: string | null = null;`;obtainA3(:63-72):
  ```ts
  if (firstSetCookie !== null) return firstSetCookie;
  ...
  firstSetCookie = setCookie(res);   // :67 成功即永久缓存
  ...
  firstSetCookie = null;             // :69 仅网络失败哨兵(下次可重试)
  ```
  非 null 即永远短路返回;**无 TTL、无失效回调**。全仓 grep `invalidateA3|firstSetCookie`:赋值点仅 :67/:69,**无任何清缓存调用点**。

**(b) 401 自愈取回的正是同一模块缓存值 ✓**
- `src/yahoo/yahooClient.ts:170-171`(quoteSummary 401 分支):`this._crumb = null; this._a3 = null;` —— 只清**实例**字段。
- 自愈刷新走 ensureCrumb(:193-194 `const a3 = await this._obtainA3();`)→ `_obtainA3` :210-214 **provider-first**:
  ```ts
  if (this._cookieProvider) {
    const v = this._cookieProvider();
    if (v !== null && v !== '') return v;
  }
  ```
- 三个生产注入点的 provider 闭包全部捕获同一模块缓存值:deviceYahooCollect.ts:396-397 `const a3 = await obtainA3(); new YahooClient(undefined, () => a3);`、proxies.cjs:269-270 同款、tools/probe.mts:154-155 同款。「每 collect 新建 YahooClient」(collectors.md verified-clean #7)只重置实例 crumb 缓存,**provider 返回的死 A3 跨 collect 存活**。

**(c) 后果链 ✓**:Yahoo 集中吊销 A3 后:getcrumb 可能仍成功(crumb 端点对旧 A3 宽容)但 quoteSummary 二次尝试仍 401 → `YahooApiError('crumb', 401)`(yahooClient.ts:180-184)→ quoteSummaryOrNull 降级(warn,概览仅剩 chart meta 字段);此后每次采集重复同一循环,直到 App/server 进程重启。与 yahooClient.jsdoc 自述「crumb 失效可自愈一次」(:160-162 一带)的文档意图相悖 —— 自愈通道被 provider-first 短路,非有意设计(无任何注释承认此局限)。

**判定:CONFIRMED。严重度维持 P2**(数据质量退化非丢失;触发依赖 Yahoo 侧吊销节奏,频率低但一旦发生不可自愈,重启才能恢复)。

---

## AL2 — toolLoop 收尾轮不校验 tool_calls,空报告标 done(P2)→ CONFIRMED

**(a) 收尾轮确实无校验、tool 结果被静默丢弃 ✓**
- `src/toolLoop.ts:107-113`:
  ```ts
  // 轮数耗尽且模型仍在要工具：追加收尾轮（有界 +1 次 LLM 调用,同样流式）
  if (response !== null && ((response as { tool_calls?: Array<unknown> }).tool_calls?.length ?? 0) > 0) {
    safeProgress(progressUpdater, '搜索轮数已用尽，正在整理最终回答。。。');
    messages.push(['human', FINAL_ROUND_INSTRUCTION]);
    const final = await roundCall({ query: messages });
    return { response: final, messages: [...messages, final as BaseMessage] };
  }
  ```
  `final.tool_calls` 零检查;若收尾轮仍带 tool_calls:**既不执行工具也不回流 ToolMessage**,与循环内分支(:80-105 有完整 执行+回流)形成不对称。FINAL_ROUND_INSTRUCTION(:14-15)只是提示词约束,模型可不服从(头注「强约束不再调用」是对意图的描述而非保证,不构成设计豁免)。

**(b) 空 content 真入 report 事件与 lastRun ✓**(端到端实证)
- `src/agents.ts:163-166`(completeWithTools,manager/trader 共用):
  ```ts
  const content = typeof response.content === 'string' ? response.content : String(response.content);
  pushReport(this.progressUpdater, stateKey, content);
  safePushStatus(this.progressUpdater, nodeName, 'done');
  ```
  无空串/tool_calls 守卫。
- InvestmentManager 即 completeWithTools 且 stateKey='final_decision'(committee.ts:92 `kind: 'manager', stateKey: 'final_decision'`)→ events.ts pushReport(:99-102)emit `{type:'report', content:''}`;FinalReport.final_decision 取原始 state 值(:179 `typeof values.final_decision === 'string' ? values.final_decision : ''`),opinions 组装(:172-178)**无空内容过滤**。
- done 事件 → `app/lib/analysisController.ts:442-451`:`s.finalDecision = report.final_decision;`(空串照收,日志还打印「最终决策 0 字符」:444)→ `saveLastRun(d.store, report, ...)`(:449)—— **空最终决策被持久化进 lastRun**,error 不写缓存的 R4 保护对此无效(done 是成功终态)。恢复侧仅有 chips 半守卫(:239-240 `last.final_decision.trim()` 才置 done)——恰好反证运行时无兜底。

**(c) 测试缺口 ✓**:`test/tool-loop.test.ts` 「rounds exhausted → final round instruction appended」用例(约 :110-122)scriptedLlm 第三轮返回合规 `AIMessage({content:'收尾回答'})`;**无不服从场景**(收尾轮仍返 tool_calls)的用例。中间轮的不服从有完整测试覆盖,唯独最后一跳裸奔。

**判定:CONFIRMED。严重度维持 P2**(触发需模型违反指令,概率低但真实存在——尤其弱模型/工具偏置强的模型;后果为用户可见空「最终结论」且被缓存,下次启动还原空决策,manager chip 与内容不一致)。

---

## 结论

5/5 CONFIRMED,零 REFUTED/PARTIAL;未发现 FP 三模式误报。第一波 CoreLogic 相关清单可信,全部建议进入修复排期;严重度均无需调整。修复优先序建议:F1(砖化+数据丢失)> C3/C2(采集质量/挂起)> AL2(边缘空报告)> F2(需双开才触发,但实现成本极低——一行 lock)。
