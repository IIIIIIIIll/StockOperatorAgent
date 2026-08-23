# src/ 核心层评审报告(SrcCoreReview)

- **范围**: src/ 核心层 23 文件 — adjust / chartData / chartLayout / committee / env / events / format / gates / indicators / lastRun / log / market / metaKeys / overview / pipeline / progress / retry / store-file / store-idb / store-memory / store-node / store / switches(均 .ts)。
- **方法**: 纯静态审读(read/grep 全文取证);对照基线 `.trellis/tasks/archive/2026-08/08-22-repo-review-remediation/findings_verified.md`、FP 模式 `.trellis/spec/guides/index.md`、契约 spec `ts/stores.md` / `ts/events-streaming.md` / `error-handling.md` / `env-switches.md` / `core/investment-committee.md`;交叉取证 f10.ts / agents.ts / app/lib/runner.ts / app/lib/analysisController.ts / desktop/child.mjs / tools/desktop-probe.mts 的消费面。
- **HEAD**: e4d8680(master;含 08-22 整改 U1-U33 全部提交)。
- **基线规避**: C1(events rethrow)/C2(runner 并发守卫)/C3(idb close flush)/B3/B4/E7/E10/E11 均已定案或已修复,未重报;本报告只列 HEAD 上的新问题与新变体。

## 发现表

| ID | 严重度 | 标题 | 证据(file:line + 引文) | 影响 | 建议修法 | 置信度 |
|----|--------|------|------------------------|------|----------|--------|
| SC-1 | P3 | FileStore.close() 与 U3 修复后的 IdbStore.close() 行为不一致:无 closed 门闩,pending 写在镜像清空后执行会以空 payload 覆写落盘文件 | `src/store-file.ts:156-163` close() 直接清四张内存 Map 并重置队列,无任何门闩:<br>`close(): void { this.stocks.clear(); … this.queue = Promise.resolve(); this.readyPromise = null; }`;<br>`src/store-file.ts:128-135` enqueue 无 closed 检查(`this.queue = this.queue.then(() => this.ready()).then(op)…`);<br>`src/store-file.ts:137-146` enqueuePersistTicker **执行时**读内存:`{ stock: this.stocks.get(ticker) ?? null, bars: this.bars.get(ticker) ?? [], … }`;<br>对照 `src/store-idb.ts:198-199`(`if (this.closed) return`)与 `:265-287`(close 把「排空 → 清内存 → 关连接」挂队尾,U3 契约注释「先排空写穿队列…不丢写」) | 时序:putStock(T)(入队 persist T)→ 未等 flush 即 close()(Map 已清)→ 队列中 persist T 继续执行 → 读到空 Map → `<ticker>.json` 被 `{stock:null,bars:[],reports:[]}` 整文件覆写 = 落盘数据清除。当前生产唯一 close 调用方 `desktop/child.mjs:80-94` gracefulShutdown 先 `await store.flush()` 再 `store.close()`,触发面被调用方纪律规避 ≈ 0;但四实现 close 语义就此分裂(IdbStore 自愈 / FileStore 依赖调用方 / SQLite close 后再访问直接 throw / InMemory 无持久化),后续新增 close 调用点极易踩中 | FileStore 对齐 IdbStore:① 加 `private closed = false`,enqueue 首行 `if (this.closed) return`;② close() 同样把「清镜像」挂队列尾(或在头注强制「close 前必须 await flush()」并写进 ts/stores.md)。二选一即可消除空覆写路径 | 0.85 |
| SC-2 | P3 | spec/core/investment-committee.md 契约漂移:paths 与入口符号仍指向已删除的 Python 实现 | `investment-committee.md:4-7` paths:`core/investment_committee.py` / `core/role_registry.py`(仓库已无 core/*.py);`:37-40` 把 `make_investment_decision(target_ticker)` 与 `build_stock_information(ticker, progress=None)` 描述为现行组装/入口;实际 TS 侧 `makeInvestmentDecision` 已在 E7 死导出清理中删除(committee.ts 全文无此符号),组装点为 `src/pipeline.ts:211` `buildStockInformation(ticker, deps)`(deps 注入形,非 progress 可选参),入口为 `src/events.ts:119` `run(ticker, opts)` 编排。图形状部分(8/9 节点、16/19 边、4 阶段、隐式 join)经 committee.ts:104-129 buildNodeNames/buildEdges 推演**仍然准确**,且 committee.test.ts:97-113 钉死 | 按文档找接线入口的开发者会定位到不存在的 Python 符号;spec 的 description 字段宣称覆盖该域,可信度受损。属文档漂移,不影响运行时 | 重写该 spec 为 TS 视角:paths 改 src/committee.ts、src/pipeline.ts、src/events.ts;入口段改为 run()/buildStockInformation(deps) 现状;Python MCP 盘缓存段(data/tdx_cache 等)标注为历史设计溯源或删除(TS 侧 mcp 缓存语义归 agents/mcp 切片核实后措辞) | 0.9 |

## Verified-clean 抽检清单

1. **retry.ts 退避语义逐条对齐契约**(events-streaming.md / error-handling.md):RETRYABLE_STATUS {429,500,502,503,504} + message 正则 connection/timeout/network(retry.ts:14-27);指数退避 `min(base*2^(attempt-1), 8)` ×3(:70-77);warn 文案 invoke/stream 双路径共用 retryWarnMessage(R2 一致性,:29-45);streamWithRetry onRetry 在 warn 后 sleep 前(:146)、耗尽 reraise 原异常(:150)、空流返回 `{content:''}`、非对象聚合原样作 content 不丢文本(:126/:136)——全部与 spec 条文吻合。
2. **committee 图装配形状**:buildEdges 推演 = ANALYST 开 19 边 / 关 16 边(experts→START、每 trader×每 expert、trader×trader→revise 双入边 join、revise→manager、manager→END,committee.ts:118-129),与 investment-committee.md 形状描述及 committee.test.ts:97-113 断言一致;每次 makeInvestmentCommittee 新建 MemorySaver(:196),跨 run 无 checkpointer 状态残留;events.ts updater 三映射均按事件时刻 enabledRoles() 动态查表(:99-109),符合 events-streaming.md「禁止挂载闭包」规则。
3. **adjust.ts qfq 复权数学**:事件按 tradeDate 降序(:30)、比率用**原始收盘快照** closeSeries 计算(:31,:41)而非已调整值、公式 `(prevClose − 分红/10 + 配股比×配股价)/(prevClose×(1+送/配比))`(:47-51)为标准前复权式;严格 `date < tradeDate` 才调(:36-38)= ex-date 当日不复权(正确);累乘因子对更早 bar 叠加应用(:57-62)链式正确;复权后重算 changePct/amplitude(:72-76)使除权日涨跌 = 含息真实总回报,语义正确;ratioVol≤0(缩股负因子)跳过量调整有守卫(:55)。
4. **gates 时区/DST**:marketToday 经 Intl timeZone 由 ICU 处理 DST(gates.ts:8-15),gates.test.ts:24-51 以 EDT 跨日锚点钉死 cn/hk/us 三市场;getLastBusinessDay 用 `${dateStr}T00:00:00Z` UTC 日历运算(:25-31),无本地时区陷阱;latestPastQuarterEnd 8 候选降序字典序比较(:35-46)边界(y 年内未过 Q1 → 落 y-1)正确;已知缺口(无节假日日历)头注声明为有意保留。
5. **四 store 核心语义一致性**:addDatas 拒 `date <= lastDataUpdate` + 升序去重 keep-last(store.ts INSERT OR REPLACE :127-152 ≈ memory/file/idb 的 mergeBars Map 去重)、addPerformanceReports report_date 去重、replaceDatas 空输入早退不清库、缺 stock 行时 lastDataUpdate 静默不写(SQLite UPDATE 0 行 ≈ 内存族 if(stock))、updateOverview 对不存在 ticker 一致 no-op、getDatas/getPerformanceReports 四实现全返副本——逐实现比对一致,符合 ts/stores.md「11 同步方法 + 写穿队列」契约。
6. **env/switches 与 env-switches.md 零漂移**:fromEnv 八键名与 enabled 反推语义(switches.ts:39-52)、setCapabilitySwitches 显式注入 + getCapabilitySwitches 惰性读(:26-36)、envValue 单点 typeof process 守卫(env.ts:6-9)与 spec 条文逐项对应;consoleTransport debug fallthrough 为注释声明的既有行为保留(log.ts:48-56),非缺陷。
7. **pipeline safe() 家族契约收口**:safe(pipeline.ts:264-270)与 safeProgress/safePushDelta/safePushStatus(progress.ts:16-52)同契约「updater 缺失/抛错一律吞」,已由 U28 写入 error-handling.md,实现与文档一致;turnoverPct(cn 手→万股口径 vol×10⁴/L)与 indicators TURNOVER_RATE(shares=L/10⁴ 直除)数值恒等,块 1/块 2 口径无分叉。
8. **chartLayout.paneTops / chartData 币种与空数据**:paneTops 公式与抽离前两组件内联逐字节等价(chartLayout.ts:21-30,sumStretch=0 仅当全零 stretchFactor,调用方传常量不可达);financialTrendSeries 第三线毛利率全 N/A 回退 ROE、全空省线、cn 输出逐字节不变、hk/us 经 marketInfo().currency 标签化(chartData.ts:96-107),F10 period 与 fmtDate(report_date) 均 YYYY-MM-DD(f10.ts:7 DATE_CELL_RE),时间轴格式无混用。

## 待查线索(证据不足,不列为发现)

- **晚注入 setStore 不更新 runner 闭包**:`app/lib/runner.ts:38/55/67` 中 createPipelineRunner(store) 与 setYahooStore(store) 在模块初始化时捕获当时实例;setStore(desktop-probe.mts:167)仅更新 export let live binding,runner/yahoo 链闭包仍指旧实例。当前生产初始化顺序(desktop 桥注入先于 runner 创建,runner.ts:47-52)安全,探针也只验证 binding —— 若未来出现运行期切换 store 的需求即成真缺陷。
- **loadLastRun opinions 元素级校验缺失**:lastRun.ts:53 只验 Array.isArray,:60 直接 `rec.opinions as Opinion[]`;元素含 null/形状不对时 analysisController.ts:231 `o.key` 会抛 TypeError,违背 R6「损坏 → null 静默降级」的字面承诺。仓内写入方(saveLastRun)恒良构,仅外部篡改 meta 可触。
- **indicators ewmAlpha 中段 NaN 语义**:现实现(recurrence 不因 NaN 间隔追加衰减,indicators.ts:19-33)对应 pandas `ignore_na=True`,而 pandas ewm 默认 `ignore_na=False`(间隔按位置计衰减)。store 数据面(OHLC NOT NULL / JSON 无法携带 NaN)使其当前不可达。
- **events.run() 复位时序**:done/catch 路径均为先 emit 后 `running=false`(events.ts:178-181/:190-192);订阅者在 done/error 回调内**同步**再入 run() 会被 busy 拒绝。现有订阅方(useAnalysis/analysisController/探针)均为异步状态驱动,不可达。
- **内存族对象别名**:getStock 返回内部引用、putStock/updateOverview 浅拷贝共享 overview 子对象(store-file/idb/memory 同形),与 SQLite 每次重建对象不同;spec(stores.md)仅要求 datas/reports 副本,疑为有意取舍,未发现现实突变调用方。

## 未覆盖面声明

- 域外文件仅作交叉取证未做全文审读:src/yahoo/*、src/finnhub/*、webCollect.ts、collector.ts、tdx/deviceCollect.ts、mcp/billions*/webSearch/toolLoop/agents/llm/prompt/f10/reports(collectors 切片负责);app/、desktop/、tools/ 层(各自切片负责)。
- 纯静态分析,未运行任何测试/构建/服务;Hermes Intl 时区在 Android 真机的实际行为、IndexedDB 浏览器真实事务语义、better-sqlite3 WAL 行为均未实测。
- investment-committee.md 中 Python MCP 盘缓存/TDX 开关段的 TS 侧等价性核实移交 agents/mcp 相关切片(SC-2 修法需其结论)。
