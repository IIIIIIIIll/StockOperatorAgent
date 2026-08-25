# 全库审查发现与对抗复核记录(2026-08-25)

> 来源:2026-08-25 全库评审(master 工作区干净)。12 个分区 reviewer 零重叠覆盖
> src/(48 文件)+ app/(30)+ desktop/ + tools/ + 配置/CI + test/(56 文件)。
> F01–F06 已由主会话逐条对照源码预核验;随后 8 个并行 trellis-check agent(严格只读)
> 对全部 60 条发现做对抗复核:**54 CONFIRMED / 6 PARTIAL / 0 REFUTED**,判定与严重度
> 校准见文末「对抗复核报告」节,各条严重度标记已按复核结论更新。
> 本文件为唯一权威记录(整合原 findings-low 与 verification 两份)。

## 方法与客观门禁基线

- 分区评审:CoreOrchestration(0 发现)、StorageFamily、DataLayer、VendorClients、AppLib、
  AppUI、AppInfra、DesktopShell、ToolScripts、ConfigCI、TestQualityA(47 测试文件)、
  TestQualityB(9 测试文件);完整输出见各 agent 工件(agent://<id>)。
- 客观门禁:tsc --noEmit(root/app)通过;vitest = 55/56 文件、627 passed、1 skipped
  (Tavily HTTP 432 / LLM 429 stderr 为测试路径预期告警)。
- 密钥卫生:git ls-files 确认 release.keystore/.env/*.apk|aab|exe/database/*.fs/
  probe-output 均 gitignored。
- FP 过滤:按 .trellis/spec/guides/index.md rubric;reviewer 已证伪并压制大量嫌疑项,
  见文末「已证伪不立项」。

严重度:critical=破坏正确性/安全/数据丢失;major=现实路径错误行为、泄漏、竞态、吞错;
minor=边缘 bug、误导文案/注释、死代码;nit=风格/笔误/文档漂移。

---

## Major(F01–F06)

### F01 analysisController.start() 无重入守卫 【major|复核确认】
- 位置:app/lib/analysisController.ts:285-296
- 断言:start() 入口无条件清空 s.events/finalDecision/stockInformation/error/partials/
  statuses/lastRunAt/hasDone 并 notify,唯一守卫在 runner 内部(C2,src/events.ts:120-126),
  到达前 start#2 已重跑 applyCapabilitySwitches、keepAliveStart、完整 d.collect()+fetchIntel
  网络往返;随后 busy 错误事件把健康 run 覆盖为 s.error 且 hasDone=false,start#2 finally
  提前 stopKeepAlive()+running=false(Android 前台保活被中途关、按钮提前解禁),this.mode
  被覆盖致 run#1 saveLastRun 打错标签。入口可达:window.__soa.start(app/App.tsx:92 无检查;
  按钮禁用挡不住程序化调用)。主会话核验:285-296 确无 running 检查。
- 修法:入口 if (s.running) return。

### F02 代理请求体逐 chunk 解码损坏 UTF-8 【major|复核确认】
- 位置:app/lib/proxies.cjs:96-104(handleLlmProxy);同模式 handleYahooCollect(~279-287);
  app/lib/logs-server.cjs:63-71(handleLogs)
- 断言:for await 收 Buffer,body += chunk 对每 chunk 独立 toString('utf8'),跨 socket 读
  边界的多字节 CJK 序列变 U+FFFD。>64KB 中文终审 prompt 是文档化常态负载,单请求高概率
  命中,损坏 prompt 无错转发给 LLM;/logs 把 mojibake 落盘 soa-ts.log 或 JSON.parse 失败
  400 丢行。主会话核验:96-104 确认裸 body += chunk、无 setEncoding。
- 修法:parts.push(chunk)+Buffer.concat 后一次解码,或 req.setEncoding('utf8');三处同改。

### F03 RN 日志轮转 moveSync 缺 overwrite:true,首转后日志永久失效 【major|复核确认】
- 位置:src/log.ts:134-142
- 断言:file.moveSync(...) 未传 options;仓库声明 src/expo-file-system.d.ts:15-18 注明
  SDK 57 默认 overwrite:false 目标存在即抛错(store-file.ts:60-63 正因此显式传)。
  首转生成 soa-logs.log.1 后每次写入都在轮转抛错被裸 catch 吞掉(size 停在 ≥5MB),
  RN 沙盒文件日志整 session 死亡;与「对齐 server 轮转语义」注释矛盾(logs-server.cjs:53
  renameSync 可覆盖)。主会话核验:137 行无 options + d.ts 默认值确认。
- 修法:传 {overwrite:true},放宽 RnFileLike.moveSync 类型。

### F04 IdbStore/FileStore 记忆化 promise rejection → 整 session 持久化黑洞 【major|复核确认】
- 位置:src/store-idb.ts:142(readyPromise ??=)、152(dbPromise ??=)、enqueue 198-206;
  同型 src/store-file.ts:42,93
- 断言:open/hydrate 失败一次(隐私模式 IDB 拒绝、配额、连接断开)rejection 被缓存且无复位
  路径;enqueue 每写过 this.ready(),catch 仅 logError。内存照常更新、getter 正常、界面可用,
  此后所有写永不落盘——违反「失败仅记录不阻断后续写(决策 C)」本意(C 允许失败不该放弃
  重试)。bootstrap 仅 analysisController.ts:208-213 报一次初始错误。主会话核验:
  142/152 ??= 记忆化、135-213 无复位。
- 修法:rejection 时清空记忆化 promise 使下次写重试打开。

### F05 FinancialTrendChart 因 series 身份不稳每个父渲染全量重建 【major|复核确认】
- 位置:app/screens/DataScreen.tsx:30,33,43-45
- 断言:reports(store.getPerformanceReports)与 profit(parseIndicatorSection)每 render
  内联重算,四个 StoreLike 均返回新数组(store-memory.ts:72-74/store-file.ts:254-256/
  store-idb.ts:357-359/store.ts:221-227)→ financialSeriesData memo deps 每渲染必新,
  FinancialTrendChart effect [series,theme] 每次 chart.remove()+异步重建整个实例。App 每
  流式进度事件/击键 re-render → 财务趋势挂载期间全程闪烁,正是 DataScreen:42-44 注释与
  chart-ui.md「避免流式重渲染重建图表」给 IndicatorChart 防掉的问题。主会话核验:
  27 行 bars 有 useMemo,30/33 裸调用,45 deps 含二者。
- 修法:reports/profit 像 bars 一样 useMemo([ticker,dataVersion])。

### F06 年报语句污染季度序列,YoY/QoQ 比率算错并持久化 【major|复核确认】
- 位置:src/yahoo/deviceYahooCollect.ts:287-294(normalizeIncomeStatements annual 并入
  季度池且 push 最后)+ src/yahoo/composeYahooReports.ts:139-164
- 断言:byDate=new Map(rows.map(...))(142)last-write-wins——日历财年公司 Q4 止 12-31
  与年报键冲突时 Map 存年报行:(1) 年末季 YoY prevKey 解析到上年全年营收/净利,比率失真;
  (2) rows[i-1] 相邻 QoQ 在年报行后一段对全年数算(~-70% 垃圾值)。store 按 report_date
  幂等去重在 compose 之后,错误率已持久化;test/yahoo.test.ts 只喂纯季度数据测不到。
  主会话核验:289-294 合并顺序 annual 最后;142 last-wins;144-163 两段算法确认。
- 修法方向:annual 不并入季度池(compose origin-aware),或单独追加年报行置 NaN 率,
  保 HK 年度兜底而不污染环比数学。

---

## Medium(F07–F24)

### F07 child.mjs 启动窗口期成为孤儿进程 【medium|复核确认】
- desktop/child.mjs:145,188-193:disconnect/SIGTERM/SIGINT/message 监听在 await
  store.ready()(123)与 listen(138)完成后才注册。父进程此窗口退出/崩溃 → shutdown
  消息与 disconnect EOF 双双无人接,子进程孤儿持有 userData 目录与 HTTP 端口;单实例锁只管
  主进程,下次启动双写同一 <ticker>.json/meta.json(正是锁要防的并发撕裂写)。
- 修法:模块顶层先注册 disconnect/signal(message 可选),gracefulShutdown 判空容错。

### F08 gracefulShutdown 期间到达的 op 被应用后丢弃 【medium|复核确认】
- desktop/child.mjs:83-93,145:shuttingDown 置位后 await store.flush() 挂起,message
  handler 无 shuttingDown 门继续处理新 op(内存生效+入队),close() 清 map+exit(0) 丢弃;
  ack 竞态由 main 出口 sweep 拒绝。违反 main.mjs:339-341「kill -TERM/Ctrl+C 不丢写」承诺。
- 修法:message handler 开头 if (shuttingDown) return/reject。

### F09 生产包 DevTools 可打开,注释声称不可 【minor|复核降级】
- desktop/main.mjs:291-296:未 Menu.setApplicationMenu(null) 也未 devTools:false,默认菜单
  含 View→Toggle Developer Tools 与 Ctrl/Cmd+Shift+I;293 注释「no visible devtools by
  default」与事实相反。风险受控(renderer 沙盒+contextIsolation+127.0.0.1),属加固/注释漂移。
- 修法:setApplicationMenu(null) 或 devTools:!app.isPackaged,改正注释。

### F10 FileStore.close() 丢 pending 写、可复活,背离四端 close 语义 【medium|复核确认】
- src/store-file.ts:174-181:不清队列、不置 closed;close 前已入队 op 在旧链续跑,
  readyPromise 被清触发整盘 re-hydrate 回填已清 map,再基于陈旧状态重写 payload——已 ack
  变更丢失、closed store 继续活。IdbStore.close()(store-idb.ts:262-284)排空+拒新写。
  现产线唯一调用方 desktop/child.mjs:87-93 先 flush 故为潜在;desktopBridge 文档声称
  「镜像语义与 FileStore 完全一致」。

### F11 addDatas 去重基准 SQLite 与其余三端双向分歧 【medium|复核确认】
- src/store.ts:128-136:阈值取 stocks.lastDataUpdate;File/Idb/Memory 用最后 bar 日期。
  (a) applyYahooCollectedToStore 盖 lastDataUpdate=marketToday(
  src/yahoo/applyYahooCollectedToStore.ts:96-105)后增量 addDatas 在 SQLite 被拒(0 写)
  三端接受;(b) stocks 行缺失时 INSERT OR REPLACE 全量重写返回 bars.length≠0,违反接口契约
  「0=全部重复不写」(store.ts:74、stores.md)。现调用方都先 putStock,潜在分歧。

### F12 nodeFsAdapter.readFile 把所有 fs 错误当文件缺失 【medium|复核确认】
- src/store-node.ts:27-35:bare catch return null,EACCES/EBUSY/EISDIR 同 ENOENT。
  hydrate(store-file.ts:127-128)text==null continue 跳过且不走 stores.md F1 承诺的
  logError;该 ticker 下次 persist 反向覆盖磁盘为近空 payload。expo adapter(52-54)传播读
  错误走有日志跳过路径,node adapter 更 lossy。修法:仅吞 ENOENT,其余 errno 重抛。

### F13 collectViaProxy 对 200+坏 JSON 返回 null,消费端 TypeError 【medium|复核确认】
- src/webCollect.ts:94-98:res.json().catch(()=>null) 只服务 !res.ok 分支;200 但截断/非 JSON
  或无 bars 数组时 null 直通 runner.collectForWeb → applyCollectedToStore 的
  payload.bars.length(webCollect.ts:51)抛 'Cannot read properties of null',违反自身
  「失败抛错(调用方应中止分析)」契约,裸崩溃而非采集错误文案。
- 修法:校验 body 非 null 对象且 Array.isArray(body?.bars),否则按 !ok 分支抛描述性 Error。

### F14 TDX 日 K 日期在 TZ≤UTC-9 主机整体 +1 天 【medium|复核确认】
- src/tdx/quoteClient.ts:38-39:node-tdx-market decodeDayTime 以宿主本地时间构造
  Date(y,m-1,d,15:00)(dist/protocol/encoding.js:123-132),fetchDailyBars 用
  toISOString().slice(0,10) 还原 → 本地 15:00 在 UTC-9 以西越过 UTC 午夜,每根日 K +1 天,
  污染 daily_bars 键、qfq 对齐输入、freshness 比较。阿拉斯加/夏威夷等设备可触发。
- 修法:直接从解码整数格式化 Y-M-D,不经 toISOString 往返。

### F15 ewmAlpha 实为 ignore_na=True,与声明的 pandas 语义不符 【medium|复核确认】
- src/indicators.ts:17-30:模块头(indicators.ts:2)声明对齐 pandas ewm(adjust=False),
  默认 ignore_na=False(gap 感知 y=(1-α)^gap·y_prev+α·x),实现对中间 NaN 只做一次 (1-α)
  衰减。真实触达:calcKdj rsv 在 9 窗高低相等(连续一字板)产 NaN,K/D/J 此后偏离 Python
  参考;indicators.test.ts fixture 无一字板窗测不出。
- 修法:记 lastValid 索引升衰减为 Math.pow(1-alpha,t-lastValid),或改头部声明承认偏差。

### F16 configure-android-signing 非 ASCII 机密被 ISO-8859-1 解码损坏 【medium|复核确认】
- tools/configure-android-signing.mts:138-141:escapePropertyValue 只转义 反斜杠/换行/CR,
  文件 UTF-8 落盘;Gradle keystoreProperties.load(InputStream) 按 java.util.Properties 规则
  ISO-8859-1 解码 → 非 Latin-1 的 ANDROID_KEYSTORE_PASSWORD/ALIAS/KEY_PASSWORD(keytool
  接受)签名期静默误报模糊密码错误;值前导空格亦丢。
- 修法:补 [\u0080-\uFFFF]→\uXXXX Unicode 转义。

### F17 缺 key 提示指向不存在的「模型与密钥」设置节 【minor|复核降级】
- app/App.tsx:69-70(gateNotice)与 app/lib/analysisController.ts:266(log 串):
  SettingsPanel 实际标题为「LLM(大模型)」与「外部服务密钥(可选)」,用户被指引到不存在
  的节名;两处一起改。

### F18 换手率 capital memo 缺 dataVersion,同 ticker 二次采集显示陈值 【medium|复核确认】
- app/screens/DataScreen.tsx:36-39:deps 只有 [ticker],兄弟 memo 都带 dataVersion。
  webCollect 采集中 setMeta(capitalKey(...))(src/webCollect.ts:65-67),controller 随后
  dataVersion+=1(app/lib/analysisController.ts:365)。同 ticker 重采集(demo 600036 二跑)
  时 ticker 不变 memo 不重算,换手率列持续用采集前(可能 null)股本文本直到切 tab 重挂载。

### F19 checkLlmReachability 把上游真实 404 误判为代理缺失 【medium|复核确认】
- app/lib/settings.ts:188-191:status!==502 && status!==404 才认代理成功;但 /llm-proxy
  原样透传上游状态(proxies.cjs:129)。Base URL 缺 /v1 或模型名不存在 → 真 404 送进浏览器
  直连回退,CORS 必败后报「…本环境无 /llm-proxy 代理」——代理明明正常,掩盖 404 精准诊断。
- 修法:仅 fetch reject 或代理标记体才回退,不以透传状态码判定路由缺失。

### F20 分析上下文 today 用 UTC 日历日,违背北京时间契约 【medium|复核确认】
- app/lib/analysisController.ts:259,391,397:d.isoNow().slice(0,10)(UTC);
  composeOverview 契约「YYYY-MM-DD(北京时间今天)」用于 lastBarIsToday 盘中量额门控与
  ytdBaseClose 选年(src/overview.ts:45-54,68)。北京 00:00–08:00 UTC 日落后一天,上一交易
  日收盘 bar 被「当日盘化」;同参 DataScreen.tsx:60 用 asiaToday()(pipeline 同款)。
- 修法:asiaToday()/marketToday('cn') 或注入 tz-aware clock。

### F21 三套全图测试跑真实外网搜索(无离线隔离) 【medium|复核确认】
- test/query-content.test.ts:71-77、test/events.test.ts:65,145,155,181,198、
  test/runner.test.ts:111-118:beforeEach 只删 BILLIONS_*DISABLED 四键,未设
  WEB_SEARCH_DISABLED='1' 未删 BILLIONS_API_KEY(committee/agents.test 有正确范式)→
  默认 env 每次跑真实 DDG/Tavily 请求;机器有 key 时烧真实配额;20s fetchWithTimeout vs
  15s testTimeout 有 flake 窗口;离线靠占位降级假绿。

### F22 events.test env 还原把 undefined 写成字符串 "undefined" 【minor|复核降级】
- test/events.test.ts:126-129:finally 里 process.env.LLM_API_KEY=saved.LLM_API_KEY,key
  本未设(CI 常态)时 Node 强转 'undefined' 字符串污染 worker;兄弟套件
  (settings-env-fallback/switches/agents/committee)均有正确的 undefined→delete 分支。

### F23 live.integration.test bare require 在 ESM 下即崩 【medium|复核确认】
- test/live.integration.test.ts:71:vitest 4 ESM(type:module,无 setupFiles)无 require
  全局;SOA_LIVE=1 npx vitest run 该文件 71 行 ReferenceError:require is not defined,
  AC7 真链探针从未实际可用(skipIf 默认跳掩盖)。修法:顶部 import readFileSync。

### F24 llm.test 测试名与断言相反的同义反复 【minor|复核降级】
- test/llm.test.ts:45-47:'createLlm rejects without config' 断言
  expect(()=>createLlm({apiKey:'',...})).not.toThrow();createLlm 无任何校验(校验在
  readLlmEnv/MissingLlmConfigError),断言永真钉不住契约,名字宣称反面。


---

## Low / Nit(F25–F60)

### 正确性边缘

### F25 decodeDdgUrl 对 uddg 双重百分号解码 【low|复核确认】
- src/webSearch.ts:129-133:URLSearchParams.get 已解码一次,再 decodeURIComponent 二次 →
  目标 URL 解码后仍含 %XX(编码 CJK 路径、%25)被破坏('a%2520b'→'a b');畸形序列抛错落
  return full 返回 DDG 跳转页而非文章 URL。修法:直接返回 uddg。

### F26 toNum('万'/'亿') 裸单位返回 0 而非 NaN 【nit|复核确认】
- src/f10.ts:19-21:t.slice(0,-1)==='' 时 Number('')===0,注入假 0 值而非 NaN 缺失约定;
  现实未见裸单元 cell,理论边缘。修法:乘前校验 Number.isNaN。

### F27 parseSectionBlock 行短于表头时 value_raw 存 undefined 【nit|复核确认】
- src/f10.ts:72-73:string 字段收 undefined(toNum(undefined)→'' 安全);value_raw 无产线
  消费者(仅测试构造),纯类型契约疣。修法 cells[1+i] ?? ''。

### F28 serveStatic 遍历防护用未锚定前缀匹配 【low|复核确认】
- app/server.mjs:43-48:urlPath 在 WHATWG 点段归一后才解码,'/%2f..%2fdistX%2fsecret' 解码
  为 '//../distX/secret' 经 path.join 归一出 DIST,join 结果仍以 DIST 为前缀通过 startsWith
  检查 → 可读 DIST 兄弟 dist* 目录(现树不存在,潜伏)。canonical 修法:
  path.relative(DIST,file).startsWith('..') 拒绝,或锚定 DIST+path.sep。

### F29 serveStatic ReadStream 无 error 监听可崩进程 【low|复核确认】
- app/server.mjs:49-54:existsSync/statSync 后 createReadStream().pipe(res) 无 error
  handler;stat 与 open 之间文件消失(expo export 重写 dist 时真实)→ unhandled 'error' →
  uncaughtException 杀整个生产 server(静态+全部代理同死)。修法:s.on('error')→500+destroy。

### F30 三处裸 new URL(req.url) 可崩生产 server 【low|复核确认】
- app/lib/proxies.cjs:~197(handleTdxCollect)/~296(handleYahooCollect)/~343(
  handleWebSearch):WHATWG 解析失败的畸形 request-target(curl --request-target 可造)
  同步抛出穿透 http.createServer listener → uncaughtException;serveStatic 对同一解析有
  C1 防(400 不崩),三处违反既定健壮性契约。修法:各包 try/catch 回 400。

### F31 空 series 渲染提前 return,承诺的「仅渲染图例」从不执行 【nit|复核降级·双镜像】
- app/lib/chartHtml.ts:86-91 与生成器镜像 tools/build-chart-view.mts:163-168(另 194-196
  建图失败 catch 分支同病):!hasData||!LWC 直接隐藏 #chart/#empty 并 return,位于图例渲染
  循环(chartHtml 185+/mts 259-330)之前;两处头注与 build-chart-view.mts:58 契约均承诺
  空数据仍渲图例。
- 复核修正(nit 降级依据):产线链路不可达用户可见空白——financialTrendSeries 三处
  if(length) 守卫(src/chartData.ts:101-104)保证 series.length>0 必有 hasData=true;
  DataScreen.tsx:105 已守 klineBars.length>1。剩余触达仅 !LWC 加载失败等异常态。
- 修法:图例渲染上提到 early-return 之前,或空 series 时显示 #empty。

### F32 punycode shim 缺 Unicode 点分隔符归一 【low|复核确认】
- app/lib/punycode-shim.ts:126-133:头称与 npm punycode@2 一致,但上游 mapDomain 先把
  [\x2E\u3002\uFF0E\uFF61] 归一为 '.' 再分 label(v2.3.1 已核);shim 只按 ASCII '.' split →
  'www.example。com'(中文文档经 markdown-it normalizeLink 可达)被编码成单个横跨全域的
  xn-- label,链接损坏。修法:split 前归一 \u3002\uFF0E\uFF61。

### F33 inflate 接受不完整 Huffman 表,注释声称 zlib 同款 【low|复核确认】
- app/lib/zlib-shim.ts:64-70:真 zlib inflate_table 直接拒不完整 code-length 与 literal/
  length 表(distance 表仅单符号例外);shim 全接受 → 损坏流 zlib 报 invalid literal/
  lengths set 而此处可能解出伪造符号(多数被 Adler-32 兜住,漂移限于报错差异与罕见构造流)。
- 修法:执行 zlib 规则或改注释。

### F34 MAX_MESSAGE_BYTES 按 UTF-16 code unit 计数,非字节 【low|复核确认】
- app/lib/logs-server.cjs:97-99:常量名与注释「4KB 截断」,cleanMessage.length 实为 char 数
  → 纯 CJK 消息可到 ~12KB UTF-8,三倍于声明上界,扭曲 5MB 轮转数学。
- 修法:改名 MAX_MESSAGE_CHARS 或按 Buffer.byteLength 截断。

### F35 US ticker 失败报港股专属错误文案 【nit|复核确认】
- src/yahoo/deviceYahooCollect.ts:355:candidate 探测任意市场通用,穷尽后恒抛
  「无法解析港股代码」→ 美股退市/改名时用户看到港股解析错误。修法:按 detectMarket 选文案。

### F36 meta 缓存键 name:${ticker} 绕过 metaKeys.ts 单源 【nit|复核确认】
- src/tdx/quoteClient.ts:77:f10:/capital: 都在 src/metaKeys.ts,name: 是唯一散落模板;
  architecture 断言5 META_PATTERNS 未覆盖故无门禁报警。修法:metaKeys.ts 导出 nameKey。

### F37 console.* 直连绕过 src/log.ts 统一出口 【nit|复核确认】
- app/lib/desktopBridge.ts:106-108(enqueueOp catch)、220(setItem catch);
  app/modules/soa-keepalive/index.ts:28-34(五处 __DEV__ 门 console.log/warn)。spec 文本
  禁第二出口(契约7 针对 lib/log 回潮,此处属同旨);desktopBridge 的 FileStore 镜像路径
  (store-file.ts enqueue catch)走 logError,桌面侧持久化失败在聚合日志面不可见。

### F38 bootstrap 无条件打印「演示数据载入」 【nit|复核确认】
- app/lib/analysisController.ts:220-221:loadDemoData() 有持久数据时静默返回,日志行却用
  d.store.getDatas(DEMO_TICKER).length 打印——实数来自真实采集数据,诊断误导。
  修法:仅在确实插入时打。

### F39 setStore() 不重绑 Yahoo store,模块加载期绑定假设被注入打破 【nit|复核确认】
- app/lib/runner.ts:42-55:setYahooStore(store) 仅模块加载跑一次(注释「与 runner 同一
  store 实例」),setStore(s) 只换 runner store。文档化注入路径 tools/desktop-probe.mts:167、
  test/store-node.test.ts:80 注入后,hk/us 采集写进被丢弃的初始实例。产线 Electron 不受影响
  (desktop 分支 49-52 先于 55)。修法:setStore 内加 setYahooStore(s)。

### UI/可访问性(nit)

### F40 硬编码 '#fff'/'#000' 绕过 theme.ts 【nit|复核确认】
- app/App.tsx:351(shadowColor '#000'),358(startButtonText '#fff'),362(marketBadge
  '#fff');app/screens/SettingsPanel.tsx:209(buttonText '#fff')。视觉当前无碍,破坏主题
  单源规则。修法:提升 ThemeColors token(onPrimary/shadow)。

### F41 主要交互控件缺 accessibilityRole 【nit|复核确认】
- app/App.tsx:105(hamburger 有 label 无 role),147(开始分析无 role/label),231(侧栏
  关闭无 role),244(主 tabs 完全无 a11y 属性);app/components/ReportContent.tsx:83(
  初稿/对抗修订 expander 无 role 且 aria-expanded 缺失,▾/▸ 视觉状态不达屏幕阅读器)。
  市场下拉(App.tsx:137-139)已有 a11y#15 正确范式。

### F42 亿信调用上限清空输入立即吸成 0 【nit|复核确认】
- app/screens/SettingsPanel.tsx:184-187:Number('')===0 经 Math.max(0,floor()) 提交,
  受控值回显 "0",用户无法看到空输入重输。修法:v.trim()==='' 时 return,或本地暂存 blur 提交。

### F43 观点 tab 切换 expander 展开状态串扰 【nit|复核确认】
- app/components/ReportContent.tsx:44,80-83 + app/App.tsx:287:expanded 按槽位索引存,
  ReportContent 渲染无 key → 看涨↔看跌切换同一实例存活,A tab 的展开状态带到 B tab。
  修法:key={activeRole.stateKey!} 强制重挂载。

### 配置 / CI / 文档

### F44 根 .env.example 缺三个实际消费键 【low|复核降级】
- .env.example:4-7 一带:TAVILY_API_KEY(src/webSearch.ts:100)、TDX_HOST(
  src/tdx/deviceCollect.ts:34)、TDX_MCP_ENABLED(src/mcp.ts:197,优先级高于 TDX_MCP_
  DISABLED 且与头注「DISABLED 即全部开关面」矛盾)。.env.example 是 Node/probe 用户的
  canonical env 面,无法发现这些覆盖项。修法:补三行注释条目+一行语义。

### F45 LANGSMITH_TRACING=true 未注释,注释却称「遥测未接入」 【medium|复核确认】
- .env.example:47-50:langsmith 是 @langchain/* 活跃传递依赖(metro.config.js:16),
  @langchain/core 恰以这两个 env 名自动启用 trace 导出(Node/probe/server 路径);仓库自证:
  async-hooks-shim.ts:5「LangSmith tracing 自动降级…」。照抄示例即每次 LLM 调用带占位 key
  导出尝试(重试噪音),粘贴真 lsv2 key 则静默外传完整分析 trace 到 smith.langchain.com。
- 修法:两行注释掉,或改正注释说明现状即生效。

### F46 app/.env.example 缺 EXPO_PUBLIC_LOG_ENDPOINT 【nit|复核确认】
- app/.env.example:6-13:src/log.ts:78 真实消费(RN 远程日志上传端点);其余 EXPO_PUBLIC_*
  键全列,唯漏此键。修法:补注释条目。

### F47 死依赖 string_decoder 【nit|复核确认】
- package.json:19:src/app/tools/test 零 import;node-tdx-market 仅 iconv-lite;
  node_modules 全树无包声明依赖它(Node 核心模块解析不受影响),纯惰性重量。修法:删。

### F48 README 工件表缺 soa-<version>.aab 行 【nit|复核确认】
- README.md:110-117:release.yml:167-169 上传 apk+aab 双模式且 release 正文提及 AAB,表格只
  列 apk「可直接安装」。修法:补 Play 提交包行。

### F49 release.yml android job 缺 setup-node npm cache 【nit|复核确认】
- .github/workflows/release.yml:110-113:desktop job(33-37)配了三 lockfile 的
  cache-dependency-path,android job 同样跑两次 npm ci 却无 cache 配置,疑似遗漏而非克制。

### F50 双 TypeScript 大版本并存未记录理由 【nit|复核确认】
- package.json:26(^7.0.2)vs app/package.json(~6.0.3);root tsc 只盖 src/test/tools,
  无任何 script 校 app/** → 同一份 ../src/*.ts 在仓库门禁吃 TS7 诊断、编辑器(app/)吃 TS6。
  或受 Expo SDK 57 模板钉版约束,但未像 lib 差异那样记录理由(ts spec 有先例)。
- 修法:app/package.json 记录钉版理由或对齐。

### F51 根 package.json 死 main 字段与空模板元数据 【nit|复核确认】
- package.json:4-5:"main":"index.js" 指向不存在文件(无 bin/库消费);"description":""/
  "keywords":[] 模板残留。修法:删或填实。

### F52 app/package.json 保留 Expo 模板身份 【nit|复核确认】
- app/package.json:2-4:name "expo-template-blank-typescript"、description 为模板文案
  (对本 app 事实性错误)、license "0BSD" 几乎必非本意。功能无损(electron-builder 身份取自
  desktop/electron-builder.yml),纯误导。修法:name soa-app + 真实 description/license。

### tools

### F53 probe.mts 头部 SOA_LIVE=1 用法过期 【nit|复核确认】
- tools/probe.mts:1-2:「SOA_LIVE 端到端探针」「运行:SOA_LIVE=1 npm run probe」;grep 证实
  probe.mts 从不读 SOA_LIVE(唯一消费者 test/live.integration.test.ts:10),探针现无条件跑
  真链(gate 在 mjs→mts 移植时丢失,08-09-ts-rewrite-m3 归档描述旧行为)。变量无害 no-op,
  文档漂移。

### F54 probe.mts 输出路径 cwd 相对,兄弟脚本均锚 ROOT 【nit|复核确认】
- tools/probe.mts:193-194 及 report.json 三处写(80,135-138,166-170):字面量 'probe-output'
  相对 cwd;README 示范 repo root 运行没问题,他目录运行静默散落产物。兄弟
  build-chart-view.mts:66/check-chart-view.mts:22 均 import.meta.url 锚 ROOT,
  check-chart-view 头注明说工作区污染顾虑。

### 测试质量(low)

### F55 yahoo-collect 分页断言依赖真实时钟,2034-06 起必炸 【low|复核确认】
- test/yahoo-collect.test.ts:222(及 61,221,324,372 注释「分页 3 个 10 年窗口」):
  fetchFullDailyBars 自 Date.now() 向 fixture firstTradeDate(≈2004-06)回翻,今日恰 3 窗
  (+1 range=5d 探测 =4 次 chart call)被断言钉死;now 过 firstTradeDate+30y(~2034-06-19)
  需 4 窗 5 call,断言齐炸。修法:vi.setSystemTime 冻结时间。

### F56 device-collect 断言 IPv4 但吃环境 TDX_HOST 覆盖 【low|复核确认】
- test/device-collect.test.ts:88-90:DEVICE_TDX_HOSTS[0] 解析
  process.env.EXPO_PUBLIC_TDX_HOST ?? envValue('TDX_HOST')(src/tdx/deviceCollect.ts:35),
  开发机设 hostname 值则 expect.stringMatching(/^\d+\.\d+\.\d+\.\d+$/) 困惑性失败;
  vitest.config.ts 无 env 隔离。修法:beforeEach vi.stubEnv 清两键(见复核修正:此处方无效,
  需 vi.resetModules 或改函数化 host 解析)。

### F57 yahoo-collect 内联日期注释与常量差 6 天 【nit|复核确认】
- test/yahoo-collect.test.ts:61:注释称 firstTradeDate 1_087_929_600 = 2004-06-16(腾讯
  HKEX 上市日),实际解码 2004-06-22T18:40Z;无害(任取 2004 年中值都 3 窗到 2034)纯注释错。
  修法:改常量为 1_087_713_600(2004-06-16T00:00Z)或改注释(见复核修正:正确常量应为
  1_087_344_000)。

### F58 yahoo.test 死导入 vi 【nit|复核确认】
- test/yahoo.test.ts:4:import { vi } 全文未用(makeFetch 用普通闭包)。删。

### F59 pipeline.test 死局部 makeStore() 【nit|复核确认】
- test/pipeline.test.ts:64-66:'overview 首块字段与格式' 里 const store=makeStore()(SQLite
  :memory:)建完即弃,formatStockOutput 收显式 bars/reports 参数;误导读者以为输出源于
  store;对照 77-78 行同类行是真实消费的。修法:删。

### F60 store-node.test setStore(fake) 往返缺 try/finally 保护 【nit|复核确认】
- test/store-node.test.ts:80-86:setStore(fake) 后两个 expect 再 setStore(original);
  任一 expect 抛出 restore 不执行,共享单例残留 fake 至 worker 结束(本文件后续无消费者,
  影响小)。套件其余全局/env 还原均 try/finally 范式。修法:包裹 try/finally。

---

## 需设备实测的存疑项(两切片独立指出,不立案)

- EXPO_PUBLIC_LOG_ENDPOINT 经 envValue() 别名读取(src/log.ts:78):按 architecture 契约6
  Metro 内联规则(仅直读成员活过 release 构建)RN release 可能解析为空 → 远程日志上传疑在
  设备不可用。需真机验证;log.test.ts 只钉 node侧行为。

## 已证伪不立项(reviewer 追踪后压制,防重复上报)

- AbortSignal.timeout 在 billionsClient/mcp:Hermes 安全(expo winter
  installAbortSignalPatch,yahooClient.ts:70-74 文档化)。
- spawn 参数注入(desktop):数组形式无 shell:true、userData 路径固定 productName。
- preload 通道面:恰 4 个固定通道均有 ipcMain 接收方;五类主↔子消息双侧穷尽处理
  (settings-saved 为有意 cache-first no-op)。
- prompt.ts/pipeline 动量区分档(±200 vs ±150):git 历史溯源 Python 原源,忠实移植非漂移。
- langgraph addMessages 字符串强转 / concat 字符串块语义 / Promise.withResolvers Hermes
  支持:逐一核实兼容。
- RSI avg_loss===0→100:仅全平自上市史可达,实际不可达。
- skipDaily 下 prev_close 回退 chartPreviousClose(~5 日陈旧):代码注释明确接受的 CheckU7
  minor,不重复立项。
- SSRF lookup 式设计、413 不排空:spec 文档化的有意行为。
- polyfill import 顺序:app/index.ts:3 首导入,顺序正确。
- chartHtml 图例渲染 textContent/style 赋值:无注入点。
- architecture.test.ts 七条白名单与现实精确吻合(ConfigCI 逐条核对)。

## 覆盖声明

全覆盖:src/ 48 文件、app/ 30 文件、desktop/ 5 文件、tools/ 6 脚本、根配置×6、CI workflows、
test/ 56 文件。有意不在范围:node_modules、数据产物(database/logs/probe-output)、二进制
发布物、app/android 原生工程细节(签名工具链 F16 已涉)、.trellis 内部实现。

---

# 对抗复核报告(2026-08-25)

> 8 个并行 trellis-check agent(CheckAppCore/CheckInfra/CheckStorage/CheckData/
> CheckDesktop/CheckConfig/CheckTestsA/CheckTestsB,严格只读)对本文件上方全部 60 条
> 发现逐条独立验证。方法:先读真实源码再下结论,不轻信原文行号与机制描述;REFUTED 需
> 可追溯反证链(file:line + 推理)。完整证据在各 agent 工件(agent://Check*)。

## 总判定

| 判定 | 数量 | 占比 |
|------|------|------|
| CONFIRMED(机制+位置+严重度均准确) | **54** | 90% |
| PARTIAL(问题真实,严重度/可达范围修正) | **6** | 10% |
| REFUTED | **0** | 0% |

首轮评审质量远超 guides/index.md 预设的 ~35% FP 预算;无一条被推翻。

## PARTIAL 明细(6,均为严重度校准,机制全部属实)

| ID | 原判 | 校正 | 校正理由(复核证据要点) |
|----|------|------|------|
| F09 生产 DevTools 可开 | medium | **minor** | 沙盒 renderer 无权限边界穿越(will-navigate/open 外跳已禁),本质=加固建议+一条误导注释;另 macOS 默认加速键为 Alt+Cmd+I 非 Cmd+Shift+I |
| F17 「模型与密钥」文案 | medium | **minor** | 纯文案指向错误,按本清单自身 rubric(minor=误导文案)定级;缺键提示出现时侧边栏已开且「LLM(大模型)」是第一节 |
| F22 env 还原 "undefined" | medium | **minor** | vitest threads 池 isolate 隔离使污染不跨文件;本文件后续用例均显式传 stub llm,opts.llm ?? makeLlm() 短路使污染值永不被读——纯潜伏地雷 |
| F24 llm.test 名实相反 | medium | **minor** | 纯测试质量缺陷;拒绝契约在 readLlmEnv 已有充分覆盖(llm.test.ts:16-21),无产线影响 |
| F31 空 series 图例死承诺 | low | **nit** | 代码层断言全属实(chartHtml.ts:86-91 先于图例循环 return),但产线调用链不可达用户可见空白:financialTrendSeries 三处 if(length) 守卫保证 series.length>0 ⇒ hasData=true;DataScreen:105 已守 klineBars.length>1。剩余触达仅 !LWC 异常态 |
| F44 .env.example 缺 3 键 | medium | **low** | 纯文档缺行,对照同文件标尺(F25 数据破坏=low、F28 路径绕过=low) |

## CONFIRMED 中的关键精度修正(采纳修复时须注意)

1. **F55**:翻转点精确为 **2034-06-13T18:40Z**(窗口按 3650d 计不吃闰日,比原估 ~06-19 更早);断言钉死处在 yahoo-collect.test.ts:222/325/372 的 toHaveLength(4)。
2. **F57**:原文建议的替换常量 1_087_713_600 本身错(解码 2004-06-20T06:40Z),正确值 **1_087_344_000**(2004-06-16T00:00Z)。
3. **F56**:原修法(beforeEach vi.stubEnv)无效——DEVICE_TDX_HOSTS 是模块加载期顶层 const,先于 beforeEach 固化;有效修法需 vi.resetModules + 动态 import,或把 host 解析改为函数。
4. **F02**:三处同模式中 /yahoo-collect 的 body 仅 {ticker} ASCII 短体单 chunk,实践不可触发;major 由 /llm-proxy 单点支撑。/logs 的「JSON.parse 失败 400」子句不可达——编码撕裂只产生 U+FFFD 不破坏结构字节,mojibake 落盘是唯一后果。
5. **F14**:阿拉斯加仅冬半年(AKST=UTC-9)触发,夏令时 AKDT=-8 不触发;夏威夷 HST=-10 全年触发。
6. **F04**:close() 字面上确有置空记忆化 promise,但 IdbStore.close 同时 closed=true 永久禁写、FileStore.close 清 map 触发自毁式 re-hydrate——均非恢复路径,黑洞性质不变;触发器中「隐私模式 IDB open 拒绝」精确命中(openDb onerror reject 被永久缓存),配额/断连通常只毒化单次事务。
7. **F23**:「探针从未可用」过头——:17-70 的连接/getQuote/日K/xdxr/F10/qfq 会真实执行,永不可用的是 :72-77 fixture 对账块;崩溃点在拉取 ~9000 根日 K 之后,SOA_LIVE=1 全程必以失败告终。
8. **F21**:events/runner 两套连 beforeEach 都没有、零 env 隔离,实际比断言更差;「Tavily HTTP 432」stderr 即测试真打 Tavily 的旁证。
9. **F18**:首次采集显示正确(lastRunTicker 在 dataVersion 自增后才变,ticker 变化恰好触发重算);实际触达面=同 ticker 二跑及 meta 由无到有场景。
10. **F01**:危害比描述更早——即使 start#2 未达 runner.run(采集失败提前 return),入口重置 :289-296 也已摧毁 run#1 进度展示。
11. **F06**:冲突不限日历财年公司——任何财年末季度(endDate=财年最后一期)都撞键,US 链同样受累(:287 读 incomeStatementHistory 不分市场);Map last-wins 存年报行 vs store keep-first 留季度行的语义不一致本身也是坑。
12. 行号微偏(不影响实质):F12 hydrate ticker 分支 null-continue 实在 125-126;F54 兄弟脚本锚 ROOT 在 build-chart-view.mts:65/check-chart-view.mts:23;F37 keepalive console 调用跨 :25-40。

## 复核后严重度分布

| 级别 | 数量 | ID |
|------|------|----|
| major | 6 | F01-F06 |
| medium | 13 | F07 F08 F10 F11 F12 F13 F14 F15 F16 F19 F20 F21 F45 |
| minor | 4(+4 由 medium 降入) | F09 F17 F22 F24 |
| low | 17 | F25 F27 F28 F29 F30 F32 F33 F34 F35 F36 F37 F39 F44 F46 F49 F55 F56 |
| nit | 余量 | F26 F31 F38 F40-F43 F47 F48 F50-F54 F57-F60 |

## 结论与修复优先级

60 条发现中 54 条完全成立、6 条成立但降级、0 条误报。建议:
1. **P0(major)**:F01 双启动竞态、F02 UTF-8 损坏、F03 RN 日志死亡、F04 持久化黑洞、
   F05 图表重建、F06 财报比率污染。
2. **P1(medium)**:桌面孤儿/丢写(F07/F08)、存储四端分歧(F10/F11/F12)、数据链
   (F13/F14/F15)、签名损坏(F16)、UTC today(F20)、测试外网隔离(F21)、LANGSMITH(F45)、
   settings 404 误诊(F19)。
3. **P2/P3**:minor/low/nit 批量清理。
