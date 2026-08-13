# 全量 codebase review 汇总报告

> 任务：08-13-full-codebase-review｜15 分片并行审查（TS 6 / Python 8 / 安全 1）
> 覆盖：258 个 in-scope 源文件（0 orphan / 0 dupe，slices.json 校验）
> 纯只读审查，零代码改动。CRITICAL 全部经主 session 读源码核实；WARNING 抽样核实。

## ⚠️ 处置原则（2026-08-13 用户决策）

**Python 全量 phase out，目标是纯 TS 应用。因此：**

- **Python 侧所有发现（含 CRITICAL C3）→ 不修、不追踪**，随 phase out 自然消亡。
- **TS 侧发现（C1/C2 + 全部 ts-* 分片 + security 的 TS 部分）→ 唯一修复面。**
- **phase out 前必须补齐 TS 能力缺口**（见下方「TS 能力盘点」）——这些缺口不是 review 发现，但 phase out 后即成为永久能力丢失。

### TS 能力盘点（Python phase out 后不得丢的功能）

已确认接线 ✅：
- TDX 采集链（/tdx-collect → collectAll → store）、web 搜索（代理 + 直连）、指标计算（fixture 级与 Python 同源）、事件协议/流式/重试、设置面板开关、报告渲染、图表（08-13 全指标多面板）

**已实现但生产链路未接线 ⚠️（phase out 前必须接，否则丢功能）**：
| 能力 | 现状 | 位置 | 后果 |
|------|------|------|------|
| **qfq 前复权** | `qfqAdjust` 实现+测试通过，但 collectAll 直传 raw bars | adjust.ts:30 / proxies.cjs:80-84 / quoteClient.ts:91-101 | 除权日指标假信号、与 Python 口径分叉（review W8） |
| **亿信（billions）** | `deps.billions` 注入点已声明，**App.tsx 从未传参** → 恒 undefined → 空串 | pipeline.ts:173,210 / App.tsx:202 | 信息面分析师无亿信数据源，功能静默缺失 |
| **mcp 实时情报** | `deps.mcp` 同为空注入 | pipeline.ts:172,207 / App.tsx:202 | 恒走 fallbackMarketIntel 占位 |
| **webSearch 接入** | webSearch.ts 完整实现+测试，App.tsx 无引用 | App.tsx | 需确认 committee/agents 链实际消费路径 |

> 注：亿信/mcp 的**开关门控与设置面板 UI 已完整**（settings.ts BILLIONS_* 开关、committee.ts 门控）——用户能看到开关，但开了也没数据源注入。这是 phase out 前最需要澄清的功能缺口：TS 侧目前**没有亿信 REST 客户端**（Python 的 billions/client.py 无 TS 对应物），若亿信是必需功能，需移植客户端 + 接线；否则应移除相关 UI/开关，避免"开关存在但无效果"。

### 各分片发现处置

| 分片 | CRITICAL | WARNING | INFO | 处置 |
|------|---------|---------|------|------|
| ts-app-server | 1 | 6 | 7 | **修** |
| security（TS 部分） | 1 | 6 | 7 | **修** |
| ts-data-indicators | 0 | 5 | 6 | **修** |
| ts-tests | 0 | 3 | 4 | **修** |
| ts-orchestration | 0 | 2 | 7 | **修** |
| ts-app-ui | 0 | 2 | 6 | **修** |
| ts-events-streaming | 0 | 1 | 2 | **修** |
| py-core-data | 1 | 0 | 4 | 忽略（phase out） |
| py-tests | 0 | 4 | 6 | 忽略（phase out） |
| py-data-source | 0 | 1 | 3 | 忽略（phase out） |
| py-llms | 0 | 1 | 3 | 忽略（phase out） |
| py-ui | 0 | 1 | 2 | 忽略（phase out） |
| py-storage-utils | 0 | 1 | 6 | 忽略（phase out） |
| py-agents | 0 | 0 | 3 | 忽略（phase out） |
| py-orchestration | 0 | 0 | 2 | 忽略（phase out） |
| **TS 合计** | **2** | **19** | **32** | **唯一修复面** |

## 结果总览

| 分片 | CRITICAL | WARNING | INFO | 文件 |
|------|---------|---------|------|------|
| ts-app-server | 1 | 6 | 7 | 8 |
| security | 1 | 6 | 7 | 全仓 |
| py-core-data | 1 | 0 | 4 | 3 |
| ts-data-indicators | 0 | 5 | 6 | 11 |
| py-tests | 0 | 4 | 6 | 60 |
| ts-tests | 0 | 3 | 4 | 24 |
| ts-orchestration | 0 | 2 | 7 | 6 |
| ts-app-ui | 0 | 2 | 6 | 12 |
| py-data-source | 0 | 1 | 3 | 9 |
| py-llms | 0 | 1 | 3 | 18 |
| py-ui | 0 | 1 | 2 | 5 |
| py-storage-utils | 0 | 1 | 6 | 16 |
| ts-events-streaming | 0 | 1 | 2 | 8 |
| py-agents | 0 | 0 | 3 | 8 |
| py-orchestration | 0 | 0 | 2 | 3 |
| **合计（去重前）** | **3** | **33** | **66** | **258** |

**结论：Python 主仓与 TS 移植质量整体高**——核心契约（事件协议、图装配、事务链、命名构造、锁、指标公式）与 spec 高度一致；全部 3 个 CRITICAL 集中在 TS 服务端暴露面与 1 个 Python 降级路径缺口。

---

## CRITICAL（TS 侧 2，均已核实；C3 Python 侧忽略）

### C1. server.mjs 畸形 URL 远程打崩生产 server（DoS）
- **位置**: `ts/app/server.mjs:31`（serveStatic；createServer 回调 :60 同步调用，无 try/catch）
- **问题**: `decodeURIComponent(new URL(req.url, 'http://x').pathname)` 对畸形百分号编码（`GET /%ZZ`）抛 `URIError` → Node 默认 uncaughtException 退出进程。未认证客户端一条请求即可打崩静态服务 + 全部代理。
- **核实**: ✅ 已读源码确认——decodeURIComponent 无包裹，serveStatic 无异常兜底，与 logs-server「失败 → 5xx 不崩 server」约定不一致。
- **修复**: decodeURIComponent 包 try/catch → 失败回 400。

### C2. /llm-proxy 开放 SSRF：转发目标客户端可控 + 响应全量回显
- **位置**: `ts/app/lib/proxies.cjs:26-34`（handleLlmProxy）；`ts/app/server.mjs:63`（listen 全接口）；`ts/app/metro.config.js`（dev 同实现）
- **问题**: 转发 base 完全由客户端 `X-LLM-Base` 头/body.base 指定，无 scheme/host 白名单、无鉴权；上游响应原样 pipe 回。任何触达者可用 server 对内网/云 metadata 任意 HTTP 服务发 POST 并读响应。server.listen 未指定 host → 局域网全暴露。
- **核实**: ✅ 已读源码确认——`const baseUrl = req.headers['x-llm-base'] || base;` + `fetch(target)` + `for await chunk → res.write`；`server.listen(PORT)` 无 host。
- **修复**: base 只读服务端受信配置（忽略客户端头）/ scheme 白名单 + 内网 IP 阻断 + token 鉴权；生产监听默认 127.0.0.1。

### ~~C3. acquire_historical_data_tdx 空表 KeyError~~（Python 侧，phase out 忽略）

---

## WARNING（19 TS + 14 Python 忽略，按主题分组）

> Python 侧 WARNING（W17-W28 中 Python 部分）随 phase out 忽略，仅保留 TS 侧。

### 安全/服务端（TS，7）
- **W1** server.mjs 未指定 host，全端点暴露局域网 + 无鉴权（server.mjs:63）— 与 C2 联动
- **W2** /llm-proxy 请求体无大小上限，内存耗尽 DoS（proxies.cjs:23-24；logs 端点有 64KB 上限而此处没有）
- **W3** /logs 日志注入：message/platform 未净化换行，可伪造日志行/终端注入（logs-server.cjs:81-82）
- **W4** /tdx-collect 与 /logs 无鉴权无限流（LAN 暴露面 DoS/日志污染）；tdx-collect 45s 超时后互斥失效——doCollect 仍在后台，finally 无条件释放锁 → 并发双 TdxClient（proxies.cjs:115-127）
- **W5** EXPO_PUBLIC_LLM_API_KEY 内联进 web 静态包随站点分发（settings.ts:76-82）；四类密钥明文存 localStorage（settings.ts:58,109-114）——无已知 XSS 向量，纵深防御缺口
- **W6** window.__soa 调试后门无 NODE_ENV 守卫，任意同源脚本可触发 start() 消耗 LLM/亿信配额（App.tsx:236-240）
- **W7** 依赖供应链：ts/app allowScripts 全开 + ^ 浮动版本 + node-tdx-market 小众协议客户端（package.json:29-31）

### TS 数据/协议正确性（TS，9）
- **W8** TS 生产链路未接入 qfq 前复权——collectAll 直传 raw bars 入 store，Python 链 qfq 后落库；除权日指标假信号、与 Python 口径分叉（proxies.cjs:80-84 / quoteClient.ts:91-101 / pipeline.ts:118-121；qfqAdjust 仅有测试调用点）⚠️ **同时是 phase out 能力缺口**
- **W9** fetchDailyBars 产出 YYYYMMDD，违反 store 'YYYY-MM-DD' 升序契约 → pipeline 路径 lastBarIsToday 恒 false → overview volume/amount/turnover 恒 NaN（quoteClient.ts:37 vs store.ts:6）— **潜伏 bug**
- **W10** 日K 日期经 toISOString（UTC）转换，UTC-9 以西时区日期 +1 天错位（quoteClient.ts:37）
- **W11** webSearch/webCollect 全部 fetch 无超时/AbortSignal——RN/Node 直连网络黑洞时工具调用无限挂起，拖死 LLM 工具循环（webSearch.ts:47,140 / webCollect.ts:59-61）
- **W12** composeOverview 4 个输出键名 ≠ StockOverview 字段名（amount≠turnover / open_≠open / prev_close≠previous_close / change_percent_60d≠change_percent_60days）——跨语言持久化即静默错位（overview.ts:110-126）⚠️ phase out 后无 Python 侧可参考，字段名契约需在 TS 侧单独固化
- **W13** streamWithRetry 非对象/空流分支返回裸 `{content}` → completeExpert 写入 messages 通道 → LangGraph coerceMessageLikeToMessage 抛 MESSAGE_COERCION_FAILURE（retry.ts:132,141 + agents.ts:127；spec 明示支持的"纯字符串 chunk 假件"路径一触即崩）— **spec 与实现张力点**
- **W14** toolLoop.ts:73-76 `finalContent`/`void finalContent` 死代码（恰在无 tool_calls 早退分支，误导维护者）
- **W15** handleWebSearch `/^\S+$/` 拒绝含空格查询 → web 模式多词搜索必然 400，与 Python 语义不符（proxies.cjs:139-143）
- **W16** LLM 可达性检测把代理 502 误判为"代理不存在"，端点宕机时给出错误归因（settings.ts:178-185）

### 测试质量（TS，3）
- **W29** ts export_fixtures.py f10_hk.txt 导出非确定性（hk_files[0] 依赖 glob 目录顺序，重跑可静默换公司）+ 依赖 /tmp/f10_text.txt 魔数文件 + docstring"零网络重跑"不实
- **W30** llm.test.ts 'createLlm rejects without config' 测试名与断言矛盾（钉的是 not.toThrow()）——未来加校验时回归信号被名字掩盖

### UI/配置（TS，3）
- **W31** app.json userInterfaceStyle:"light" 强制原生亮色 → theme.ts 暗色主题在 iOS/Android 死代码，仅 web 生效（app.json:8 vs theme.ts:62-64）
- **W32** ReportScreen.tsx 为死代码（全仓库无导入；App 实际经 ReportContent 渲染，双实现漂移风险）
- **W33** makeInvestmentDecision（committee.ts:142-156）死导出 + 签名偏离 Python（省略 _llm 直接抛 'M2: _llm required'，非独立可用入口）⚠️ phase out 后应删除而非对齐

### ~~Python 侧 WARNING（14 条，phase out 忽略）~~
~~W17 charts.py N/A OHLC、W18 时区盖戳、W19 billions 格式化逃逸、W20 web_search 解析、W21 节假日语义、W22 tdx_source 异常穿透、W23 BJ 预播种、W24 工具文案、W25-W28 测试环境耦合~~

---

## 跨分片主题归纳（TS-only）

1. **TS 同源代理层是最大风险面**（C1/C2 + W1/W2/W3/W4/W15/W16）：spec 定义了 SSE 透传与双入口收敛，但**未定义鉴权、上游地址校验、请求体上限、监听地址**——安全缺口集中在 spec 未覆盖处。建议 ts/index.md 补「代理安全契约」节。
2. **TS 数据口径自洽性 3 处**（W8 qfq、W9 日期格式、W12 字段名）：均为"契约声称一致但实现未履行"。**phase out 后无 Python 侧可对照**——这些契约必须在 TS 侧独立固化（qfq 接线、日期单格式、字段名单点定义），否则口径漂移无人发现。
3. **"已实现但未接线"能力**（qfq / 亿信 / mcp / webSearch 注入点）：TS 侧开关 UI 齐全但数据源注入空——phase out 前必须决策：移植亿信客户端并接线，或移除相关 UI/开关。
4. **降级契约**（W13/W15/W16）：流式假件 coercion 崩溃、web 搜索 400、502 误判——TS 侧"失败 → 明确降级、图不中断"精神需在代理/重试层贯彻。
5. **死代码/重复**（W14/W32/W33）：phase out 后应删除而非修复对齐（makeInvestmentDecision、ReportScreen、toolLoop finalContent）。
6. **测试质量**（W29/W30）：fixtures 导出确定性问题影响 CI 稳定性；测试名与断言矛盾会掩盖回归信号。

## 修复建议分组（TS-only，供后续 task 执行）

| 优先级 | 分组 | 内容 | 预估改动面 |
|--------|------|------|-----------|
| P0（立即） | 服务端崩溃/SSRF | C1 + C2（decodeURIComponent try/catch；base 白名单/鉴权；listen 127.0.0.1） | ts/app/server.mjs + proxies.cjs，~30 行 |
| P0 | **phase out 能力缺口** | W8 qfq 接线 + 亿信/mcp 注入决策（移植客户端 or 移除 UI） | ts/src/tdx + pipeline + App.tsx |
| P1 | TS 数据口径 | W9 日期格式 + W12 字段名单点 + W10 时区 | ts/src/tdx + overview + store，~30 行 |
| P1 | 代理安全加固 | W2-W4（请求体上限、日志净化、互斥锁修正、超时 Abort） | proxies.cjs + logs-server.cjs |
| P1 | 协议正确性 | W13 coercion 修复（返回真实 AIMessage）+ W15 空格校验 + W16 502 归因 | retry.ts + proxies.cjs + settings.ts |
| P2 | 死代码清理 | W14/W32/W33（toolLoop finalContent、ReportScreen、makeInvestmentDecision 删除） | ~80 行删除 |
| P2 | 密钥面收敛 | W5/W6（EXPO_PUBLIC 键、localStorage 明文、__soa 守卫） | settings.ts + App.tsx |
| P3 | 测试/配置 | W29/W30 fixtures 确定性、W31 暗色可达、W7 供应链 | ts/test + app.json + package.json |

## Spec 更新候选（trellis-update-spec 素材，TS 为唯一目标后优先级提升）

1. **ts/index.md 补「同源代理安全契约」节**：上游 base 白名单、端点鉴权、请求体上限、监听 host 默认——本次 C1/C2/W1-W4 全部落在该空白。
2. **ts/index.md 流式输出节修正**：streamWithRetry 非对象分支与 LangGraph messages coercion 的现实冲突（W13）——spec 规定"原样作 content 返回"与 node_modules 实证的 MESSAGE_COERCION_FAILURE 矛盾，需规定返回真实消息实例。
3. **ts/index.md 补「数据口径契约」节**：qfq 接线要求、日期单格式（YYYY-MM-DD）、overview 字段名单点定义（W8/W9/W12）——phase out 后 TS 是唯一实现，口径必须自洽。
4. **ts/index.md 补「能力接线清单」**：qfq/亿信/mcp/webSearch 各能力的实现状态与接线入口（防"开关存在但无效果"）。

## 验证说明

- 覆盖矩阵：slices.json 构造校验 258 in-scope / 0 orphan / 0 dupe（orphans 均为 .trellis/.claude/.omp 基础设施与备份，非业务代码）。
- 核实：C1/C2 主 session 逐行读源码确认（C3 已核实但 phase out 忽略）；W8/W9/W17 抽样确认；各分片报告内附逐字代码证据。
- 本次零代码改动；工作树保持干净。
- **后续处置**：TS 侧发现（2 CRITICAL + 19 WARNING + 32 INFO）+ 能力缺口清单为唯一修复面；Python 侧发现全部忽略。
