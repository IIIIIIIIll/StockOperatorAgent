---
description: TS 侧(web/RN)移植约定——事件协议、流式输出、LLM 调用、同源代理
paths: [src/**, app/**, test/**, tools/**]
---

# TS 侧移植约定(`src/`/`app/`)

> **状态（2026-08-14）**：Python 业务代码已分域删除完毕（任务
> `08-14-phaseout-e-py-deletion`，E1 死代码面 → E2 数据源/存储/结构面 → E3
> 工具/agent 面 → E4 编排/UI 面 → E5 收尾）。本文件是**最终唯一实现契约**；
> 仓库根已无 `main.py`/`core/`/`agents/`/`data_source/`/`data_storage/`/
> `data_structure/`/`utils/` 业务代码（`data_source/.../tdx/vendor/` 冻结保留、
> `tools/export_fixtures.py` 与 `test/fixtures/` 冻结保留）。Python 侧旧
> 分层 spec（core/data_source/data_storage/data_structure）作为历史归档保留。
> 仓库根 `.streamlit/config.toml` 为 Python Streamlit 时代残留（零 TS 消费），
> 保留待用户决策删/留。

Python 侧分层规范不覆盖 TS 移植。本层沉淀 TS 侧(web 浏览器 + RN app + Node
server)的跨层契约:事件流协议、流式输出、LLM 重试、同源代理。

## 事件流协议(src/events.ts)

`PipelineEvent` 联合类型是 App 与业务层唯一事件契约:

```ts
| { type: 'progress'; message: string }          // 扁平进度文本(不落角色)
| { type: 'report'; key; tabTitle; content }      // 节点报告——最终内容**权威来源**
| { type: 'token'; roleKey; node; delta }         // 流式文本增量(node 区分初稿/修订轮)
| { type: 'roleStatus'; roleKey; node; status }   // 角色生命周期 running|done|retry
| { type: 'done'; report: FinalReport }
| { type: 'error'; error: string }
```

- **node → roleKey 映射**:`enabledRoles().find(r => r.nodeName === node || r.reviseNodeName === node)`;查不到原样用 node。
- **权威覆盖规则**:UI 收到 `report` 即清空该 role 对应所有 node 的流式 partial——流式文本只是过程视图,报告内容永远以 `report` 事件为准。实现必须用事件时刻的 `enabledRoles()` 而非挂载闭包(设置面板中途开关角色时闭包会陈旧)。

## ProgressUpdater 协议(src/progress.ts)

```ts
export interface ProgressUpdater {
  info(msg: string): void;
  pushReport(key: string, content: string): void;
  pushDelta?(node: string, delta: string): void;    // 可选:流式增量
  pushStatus?(node: string, RoleStatus): void;      // 可选:生命周期
}
```

**扩展接口一律加可选方法**(向后兼容——committee 传 null、pipeline 用 info、
测试 fake 零改动)。调用经 `safePushDelta`/`safePushStatus` 守卫(缺失/抛错 →
no-op,图不中断,对齐 `safeProgress`)。

## 流式输出(08-11-ts-streaming-output)

### 设计决策:方案 B(agent 级流式)而非 LangGraph `streamMode:'messages'`

- **为什么**:graph messages 模式需在 events.ts 做 chunk 级
  `tool_call_chunks`/ToolMessage 状态机区分工具轮文本、依赖图回调注入、
  演示 stub 无 chat-model 事件;版本升级即碎。agent 级流式每个控制点
  (角色/轮次/重试)在源头显式、可单测。
- **要点**:`prompt.pipe(llm)` 是 RunnableSequence,`.stream()` 转发末步
  chunk;无 `.stream()` 的 llm(假件)回退 `invokeWithRetry` + 单次全量 delta。

### streamWithRetry(src/retry.ts)

`invokeWithRetry` 的流式孪生,语义必须对齐:

```ts
export async function streamWithRetry(
  llm: StreamableLlm,
  payload: unknown,
  config?: unknown,
  opts?: { attempts?; baseDelay?; onDelta?; onRetry? },
): Promise<{ content: unknown; tool_calls?: unknown }>
```

- 迭代 `llm.stream()`;聚合用 `concat`(`@langchain/core/utils/stream`,正确处理
  content 数组/tool_call_chunks);文本增量实时 `onDelta`(空/工具轮 chunk 跳过)。
- 失败(含流中途断):`isRetryable` 判定 + 指数退避(1s×2 上限 8s ≤3 次),
  退避前 `warn`(attempt/errType/delay,照 `invokeWithRetry` 模式),`onRetry`
  在 warn 后、sleep 前回调;耗尽 reraise。
- 非对象聚合(纯字符串 chunk 假件)不丢文本:原样作 content 返回。

### 工具轮与重试的复位通道

- 工具角色(交易员/经理)每轮流式;轮末 `tool_calls` 非空 → `onReset()` 回滚该轮
  已流出文本;LLM 重试 → `onRetry`。**二者共用 `pushStatus(node,'retry')` 单通道**,
  UI 收到 'retry' 即清该 node partial(避免额外 reset 事件类型)。
- 时序:agent `running`(首调前)→ 流式 → `pushReport` → `done`。

## 同源代理(app/lib/proxies.cjs)

dev(metro 中间件)与生产(server.mjs)共用**单份**实现(收敛防漂移)。路由:
`/llm-proxy`(LLM 转发)、`/tdx-collect`(采集)、`/web-search`(搜索)、
`/logs`(日志汇聚,见 lib/logs-server.cjs)。

**SSE 透传**(流式必需):`handleLlmProxy` 必须 pipe `upstream.body` 分块转发,
**禁止 `await upstream.text()` 整体缓冲**(否则浏览器一次性收到 SSE,无实时性)。

```js
if (upstream.body) {
  for await (const chunk of upstream.body) res.write(chunk);
}
res.end();
```

> **Warning**: 流式透传后 `writeHead` 之后抛错(上游断流/客户端断开)不可再
> writeHead——必须 `if (res.headersSent) { res.destroy(); return; }` 兜底,
> 否则客户端永久挂起。未 writeHead 的错误路径保持 502 JSON。

### 代理安全契约(08-13-ts-capability-completion,C1/C2/W2-W4 教训)

- **SSRF 防线(C2)**:`X-LLM-Base` 头/body.base 是浏览器端用户配置(多提供商
  透传是**设计意图**,见 llm.ts createLlm 注释)——不丢弃机制,转发前校验:
  ① scheme 仅 http(s);② 拒绝 userinfo;③ host 经 DNS 解析后任一地址落入
  私网/环回/链路本地/保留段(127.x 10.x 172.16-31.x 192.168.x 169.254.x
  0.0.0.0 ::1 fe80::/10 fc00::/7 及 ::ffff: 映射)→ 拒发;解析失败保守拒绝。
  校验失败回 400(格式非法)/403(策略拒绝)。
- **请求体上限(W2)**:/llm-proxy body 累计 >64KB → 413 终止读取(对齐
  logs-server MAX_BODY_BYTES 模式)。
- **日志净化(W3)**:/logs 的 message/platform 落盘前 `replace(/[\r\n]+/g,' ')`
  净化(防伪造日志行/终端注入)。
- **采集互斥(W4)**:/tdx-collect 45s 超时仅提前回 504,**锁保持到 doCollect
  真正 settle 才释放**(Abort 取消不了 node-tdx-market TCP——TdxClient 无
  AbortSignal 支持),timer 在 finally clearTimeout。
- **监听地址**:server.mjs `server.listen(PORT, process.env.HOST || '127.0.0.1')`
  ——默认回环,生产远程访问需显式 HOST=0.0.0.0。
- **静态服务兜底(C1)**:serveStatic 的 decodeURIComponent 包 try/catch,
  畸形百分号编码 → 400 不崩进程。

## 环境与启动约束

- proxies.cjs / logs-server.cjs 用 CJS(metro.config.js 是 CJS,server.mjs 是
  ESM,两者都能 require)。
- proxies.cjs `require('../../src/*.ts')` 依赖 Node `--experimental-strip-types`
  (dev `npm start` 与生产启动命令已带;node ≥23.6 默认开启)。
- `src/log.ts` 是全端统一日志(web 上报 `/logs` + RN 沙盒 + Node),新增
  日志调用一律经它,不新增第二日志出口。
- **持久化(08-14-ts-persistence)**:web 生产持久化 = IndexedDB
  (`src/store-idb.ts`),RN = expo-file-system 文件(`src/store-file.ts`);
  四族(Store/IdbStore/FileStore/InMemory)共用 StoreLike **同步契约**(业务层只
  依赖 `store.ts` 接口面)+ 写穿透队列(同步改内存 → 串行 Promise 链落盘,
  mutator 同步方法内不 await)。**freshness 跨会话生效**:`gates.ts` 的
  `dailyFresh`/`reportsFresh` 读持久化的 `lastDataUpdate`/最新 `report_date`
  → 同日跳过日K / 同季跳过 F10 的判定跨重启成立(非仅当次会话)。App 启动链
  `await storeReady()`(IndexedDB 打开 + hydrate / 文件读回)后
  `loadDemoData()`(仅空库载入 demo,有跨会话持久化数据则跳过)。
- **上次分析缓存(08-16-cache-last-run)**:`src/lastRun.ts` 纯函数
  (`saveLastRun`/`loadLastRun`)把最近一次成功分析的 `FinalReport`(done 事件
  完整结果 + ISO 完成时间 + `real|demo` 运行模式)写入 meta 键 `soa:last-run`
  (JSON 串,对齐 `soa:llm-config` 前缀惯例;仅 done 写,error 不写 → 旧缓存
  保留)。App 启动链 `loadLastRun` 命中 → 播种各报告 Tab/最终决策/采集数据
  ticker 与股票信息/角色 chips(经理角色按非空 `final_decision` 置 done——
  经理报告只进 `final_decision` 字段不在 opinions);未命中/损坏 JSON → 静默
  降级 demo 路径。恢复内容带时间+模式标记("已显示上次分析结果"),防误当实时
  新分析;四平台共用同一 meta 面。

## 能力接线(08-13-ts-capability-completion;Python phase out 后唯一实现)

TS 是最终唯一实现,各能力必须有**生产接线点**(防"开关存在但无效果"):

- **亿信(billions)**:`src/billionsClient.ts`(REST 4 端点,对齐 Python
  client.py:POST + X-API-KEY、BillionsApiError 归一化、不重试、超时档位
  fin_db 120s / search+twitter 25/70/120 / fetch 90s)+
  `src/billionsTools.ts`(search/twitter/fetch 三件套 LLM 工具,开关关/
  无 key → undefined 不绑定,调用硬上限 search 3 / twitter 2 / fetch 3,
  env `BILLIONS_{CAP}_MAX_CALLS` 可覆盖;settings.caps 三值
  (searchMax/twitterMax/fetchMax)经 `assembleTools` → `maxCallsByCap`
  注入**优先于 env**,非法值(NaN/<=0/非数字)回退 env/默认)+ agents.ts
  信息面分析师预抓(三源 announcement/report/web + twitter)。**key 在
  web 端 localStorage**:客户端/工具经 `apiKey` 构造注入(不读 process.env
  ——Metro 不内联非 EXPO_PUBLIC 变量)。接线:runner.ts `makeBillionsIntel`
  (pipeline 段)+ `assembleTools`(委员会工具)→ App.tsx 传入;预抓 client
  注入(App.tsx 构造带 key 的 `BillionsClient` → `runner.run` 的
  `billionsClient` → events.ts RunOptions → committee `deps.billionsClient`
  → 分析师构造第 5 参;缺省 → 无 key client 回退,亿信路径静默关闭、DDG
  兜底)。**安全**:key 仅存 client 私有字段——不落日志、不经服务端代理
  (浏览器端直连现状,不新增代理路由)。
- **mcp 实时情报**:`src/mcp.ts`(`TdxMcpClient`:JSON-RPC 2.0 + tdx-api-key
  + Mcp-Session-Id 透传 + SSE 响应解析取首个 result;`getMarketIntel`:
  TDX_MCP_DISABLED/ENABLED 门控 + 无 key 占位 + 中文摘要 ≤10 行)。**不做
  缓存**(TS 无 is_trading_time 移植,每次实时查询)。接线:runner.ts
  `makeMcpIntel` → App.tsx 传入 deps.mcp。
- **qfq 前复权**:`src/tdx/quoteClient.ts` `collectAll` 内
  `fetchXdxrEvents` → `applyQfq`(失败降级 raw bars 不阻断)。日期契约
  **YYYY-MM-DD**(store 契约;qfqAdjust 输入为 YYYYMMDD,接线层双向转换)。
- **北交所/akshare**:明确不支持(用户决策 08-13),App.tsx 入口拦截报错。
- **采集 freshness 门(08-14-phaseout-c C8)**:`gates.ts` `dailyFresh`
  (lastDataUpdate == 北京时间今天 → 同日已采集)与 `reportsFresh`
  (最新 report_date == 最近已过季度末 → 同季已入库)经 `freshnessGates`
  判定,依据 store 现有数据(不新增持久化字段);`runner.collectForWeb`
  按源传 `skipDaily`/`skipF10` → `/tdx-collect` 查询参数(仅 '1' 生效,
  缺省不带参数 = 全量)→ `proxies.cjs` 按源跳过(仍拉快照/名称/股本结构
  节)。**部分 fresh 不整体短路**;跳过返回现有数据**不置空**
  (applyCollectedToStore 保留既有日K/lastDataUpdate,同季跳过 F10 时以
  缓存 `f10:${ticker}` meta 文本顶替,盈利能力块不降级占位);跨日/跨季
  首次 → 全量路径不变。

## 图表(web-only;08-13-ts-all-indicator-charts)

全指标多面板图在 `app/components/IndicatorChart.tsx`(DataScreen 内嵌)。
约定:

- **web-only + 动态 import**:lightweight-charts 只走 `import('lightweight-charts')`
  运行时加载(保持独立 chunk,不拉进 RN 原生 bundle);类型注释放顶层
  `import type`。**坑**:`LineStyle` 是运行时枚举(值),须从动态 import 解构
  取值(`LineStyle: LineStyleValue`),不能只 import type。
- **多 pane 布局**:`addSeries(def, opts, paneIndex)` 建面板,全部 series 建完后
  `chart.panes()[i].setStretchFactor(n)` 设比例。**禁止用 `setHeight`**:Pane
  初始 `height=0`,首帧布局前 setHeight 以 totalHeight=0 参与
  `_internal_changePanesHeight` 重分配 → 面板高度错乱;stretch 是比例布局,
  与当前高度/调用顺序无关。
- **数据同源**:图表消费 `computeAll` 结果行(与「最新指标」chips 同一份),
  不新算第二遍;窗口切片与 K 线一致。DataScreen 用 `useMemo([ticker,
  dataVersion])` 缓存 bars 与指标行,避免流式重渲染时重建图表
  (`store.getDatas` 每次返回新数组)。
- **NaN 处理**:指标 warmup 前导 NaN → 线/柱数据过滤 null(warmup 只出现在
  序列头部,无中间断档);柱系列用 `base: 0` + 正负着色。
- **图例与颜色单点定义**:系列色常量 `C` 与 `LEGEND` 数组同源,图例 chips
  与图上线条不漂移;柱(成交量/MACD/MACD_VH)用 `theme.colors.up/down` 半透明。


## RN/Hermes 运行时兼容面(08-15-android-standalone-tdx)

真机跑通 node-tdx-market + LangChain 所需的 Hermes 缺口(全部在
`app/lib/polyfill.ts` / `app/lib/*-shim.*`,metro resolveRequest 重定向):

- **Buffer#subarray 必须返回 Buffer 视图**(部分 Buffer 实现返回裸 Uint8Array →
  readUInt32BE undefined);polyfill 包一层 `Buffer.from(view.buffer, offset, len)`。
- **timer 句柄补 unref/ref no-op**(Hermes 返回数字;RN timer 不阻塞进程,no-op
  语义正确);clearTimeout/clearInterval 自动解包。
- **crypto**:randomUUID + getRandomValues(Math.random 熵,仅 id 用途)。
- **navigator.userAgent**(langchain isJsDom 读它)→ 补空串。
- **AbortSignal.throwIfAborted**(LangGraph stream config 挂 signal,包装器调用)。
- **node:zlib**:node-tdx-market 每帧 inflateSync——手写 RFC1950/1951 inflate
  (zlib-shim.ts);同步 require 经 **CJS 跳板**(zlib-shim.cjs)取导出。
- **GBK 解码用 iconv-lite**(Hermes TextDecoder 不支持 gbk),不走 TextDecoder。
- **lazy 模式下跨目录相对动态 import 运行时解析失效**(agents.ts `import
  './committee.ts'`)→ 改静态 import(agents↔committee 循环在 Metro CJS 语义
  下安全,运行时访问 live binding)。
- **EXPO_PUBLIC_* 必须直接 process.env.X 成员访问**——babel-preset-expo 只
  静态内联直接访问,`const env = process.env` 别名逃逸 → release 运行时缺失。
- **edge-to-edge 顶部 inset**:header 需 `(RNStatusBar.currentHeight ?? 0)` 上
  移,否则 Android 15+ 状态栏盖住 ☰ 等顶部控件。
