# 全量 codebase review 汇总报告

> 任务：08-13-full-codebase-review｜15 分片并行审查（TS 6 / Python 8 / 安全 1）
> 覆盖：258 个 in-scope 源文件（0 orphan / 0 dupe，slices.json 校验）
> 纯只读审查，零代码改动。CRITICAL 全部经主 session 读源码核实；WARNING 抽样核实。

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

## CRITICAL（3，均已核实）

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

### C3. acquire_historical_data_tdx 对已失败 daily 空表抛 KeyError，违反降级契约
- **位置**: `core/data_acquisition.py:148-159`（触发源 `FetchScope.fetch_daily` :58-59）
- **问题**: 同一 FetchScope 内早先 daily 失败（预播种 :369 或 overview 阶段）→ `_failed` 记录 → 此后 `fetch_daily` 直接返回**无列空 DataFrame（不抛异常）** → `acquire_historical_data_tdx` 无空检查 → `to_akshare_hist_schema` 首行 `df["datetime"]` → **KeyError** → 穿透至 LLM 工具调用崩溃。真实场景：TDX daily 瞬时失败 + snapshot 成功（限流/网络抖动/新股无日K）。
- **核实**: ✅ 完整触发链已读源码确认——FetchScope docstring 声称"消费者按空降级"，`acquire_historical_data_tdx` 是唯一未实现空降级的消费者（build_overview 经 `_fetch_degraded`、reports 经 `build_reports` 均有空处理）。现有测试 `_CountingSrc` 恒成功，未覆盖。
- **修复**: daily 拉取后补 `if daily is None or daily.empty: return False`（2 行，与同模块降级语义对齐）。

---

## WARNING（33，按主题分组）

### 安全/服务端（7）
- **W1** server.mjs 未指定 host，全端点暴露局域网 + 无鉴权（server.mjs:63）— 与 C2 联动
- **W2** /llm-proxy 请求体无大小上限，内存耗尽 DoS（proxies.cjs:23-24；logs 端点有 64KB 上限而此处没有）
- **W3** /logs 日志注入：message/platform 未净化换行，可伪造日志行/终端注入（logs-server.cjs:81-82）
- **W4** /tdx-collect 与 /logs 无鉴权无限流（LAN 暴露面 DoS/日志污染）；tdx-collect 45s 超时后互斥失效——doCollect 仍在后台，finally 无条件释放锁 → 并发双 TdxClient（proxies.cjs:115-127）
- **W5** EXPO_PUBLIC_LLM_API_KEY 内联进 web 静态包随站点分发（settings.ts:76-82）；四类密钥明文存 localStorage（settings.ts:58,109-114）——无已知 XSS 向量，纵深防御缺口
- **W6** window.__soa 调试后门无 NODE_ENV 守卫，任意同源脚本可触发 start() 消耗 LLM/亿信配额（App.tsx:236-240）
- **W7** 依赖供应链：ts/app allowScripts 全开 + ^ 浮动版本 + node-tdx-market 小众协议客户端（package.json:29-31）

### TS 数据/协议正确性（9）
- **W8** TS 生产链路未接入 qfq 前复权——collectAll 直传 raw bars 入 store，Python 链 qfq 后落库；除权日指标假信号、与 Python 口径分叉（proxies.cjs:80-84 / quoteClient.ts:91-101 / pipeline.ts:118-121；qfqAdjust 仅有测试调用点）
- **W9** fetchDailyBars 产出 YYYYMMDD，违反 store 'YYYY-MM-DD' 升序契约 → pipeline 路径 lastBarIsToday 恒 false → overview volume/amount/turnover 恒 NaN（quoteClient.ts:37 vs store.ts:6）— **潜伏 bug**
- **W10** 日K 日期经 toISOString（UTC）转换，UTC-9 以西时区日期 +1 天错位（quoteClient.ts:37）
- **W11** webSearch/webCollect 全部 fetch 无超时/AbortSignal——RN/Node 直连网络黑洞时工具调用无限挂起，拖死 LLM 工具循环（webSearch.ts:47,140 / webCollect.ts:59-61）
- **W12** composeOverview 4 个输出键名 ≠ StockOverview 字段名（amount≠turnover / open_≠open / prev_close≠previous_close / change_percent_60d≠change_percent_60days）——跨语言持久化即静默错位（overview.ts:110-126）
- **W13** streamWithRetry 非对象/空流分支返回裸 `{content}` → completeExpert 写入 messages 通道 → LangGraph coerceMessageLikeToMessage 抛 MESSAGE_COERCION_FAILURE（retry.ts:132,141 + agents.ts:127；spec 明示支持的"纯字符串 chunk 假件"路径一触即崩）— **spec 与实现张力点**
- **W14** toolLoop.ts:73-76 `finalContent`/`void finalContent` 死代码（恰在无 tool_calls 早退分支，误导维护者）
- **W15** handleWebSearch `/^\S+$/` 拒绝含空格查询 → web 模式多词搜索必然 400，与 Python 语义不符（proxies.cjs:139-143）
- **W16** LLM 可达性检测把代理 502 误判为"代理不存在"，端点宕机时给出错误归因（settings.ts:178-185）

### Python 数据/契约（8）
- **W17** charts.py candlestick/volume 对 N/A OHLC 缺 dropna——`_direction` 比较 None 抛 TypeError，且落在无守护的数据 Tab 块 → Streamlit 红屏（charts.py:67,82,113 + display.py:433-445；同模块其他三图均 dropna，唯此两处模式不一致）— **已核实**
- **W18** _overview_stale 混用服务器本地时区时间戳 vs 北京时间交易日（data_acquisition.py:255）——非 +8 时区跨交易日概览刷新被跳过一天
- **W19** billions_fin_db.py:70 `_format_results` 在 try 外，result[].content 非 str 时 TypeError 逃逸打崩整次分析（违反"任何异常 → 占位、绝不 raise"契约）
- **W20** web_search.py docstring 声称"脏条目跳过"但非 dict 条目 AttributeError；`_summarize_results` 在工具 try 外
- **W21** market_time.py is_trading_time 只排除周末，未实现"节假日→判非交易时段（保守）"声明语义（国庆/春节周中 9:30-15:00 判 True → 走实时 MCP 而非缓存）
- **W22** tdx_source.py:114-115 fetch_company_finance_raw 的 infer_hq_market 在 try 外，vendor 对 7 前缀/非数字代码抛 ValueError 穿透降级契约（函数自述"不 raise"与实现不一致）
- **W23** 北交所 ticker 预播种在 is_bj_ticker 拦截之前发起必然失败的 TDX 全量拉取（data_acquisition.py:365-372）
- **W24** tool_loop.py 进度文案对全部工具统一"联网搜索"措辞（含亿信 fetch/search/twitter），误导用户与模型

### 测试质量（6）
- **W25** 3 文件 4 处硬编码开发者绝对路径 `/home/tan/StockOperatorAgent/...`（test_get_financial_indicators.py:16、test_f10_parser.py:130,180、test_tdx_reports.py:258）——换机器静默 skip 丢覆盖，违反路径锚定约定
- **W26** golden 值绑定可刷新本地缓存内容（test_get_financial_indicators.py:35 `营业毛利率: 89.76%`）——缓存刷新后无代码改动即 FAIL
- **W27** `last_data_update == get_last_business_day(asia_today())` 断言在 A 股节假日不成立（test_data_acquisition_tdx.py:137,153）——每年 2-3 周全量回归必红
- **W28** test_get_trend_indicators.py:22 live 播种断言缺"不可达 skip"守卫，TDX 不可达时硬失败（同族均 skip）
- **W29** ts export_fixtures.py f10_hk.txt 导出非确定性（hk_files[0] 依赖 glob 目录顺序，重跑可静默换公司）+ 依赖 /tmp/f10_text.txt 魔数文件 + docstring"零网络重跑"不实
- **W30** llm.test.ts 'createLlm rejects without config' 测试名与断言矛盾（钉的是 not.toThrow()）——未来加校验时回归信号被名字掩盖

### UI/配置（3）
- **W31** app.json userInterfaceStyle:"light" 强制原生亮色 → theme.ts 暗色主题在 iOS/Android 死代码，仅 web 生效（app.json:8 vs theme.ts:62-64）
- **W32** ReportScreen.tsx 为死代码（全仓库无导入；App 实际经 ReportContent 渲染，双实现漂移风险）
- **W33** makeInvestmentDecision（committee.ts:142-156）死导出 + 签名偏离 Python（省略 _llm 直接抛 'M2: _llm required'，非独立可用入口）

---

## 跨分片主题归纳

1. **TS 同源代理层是最大风险面**（C1/C2 + W1/W2/W3/W4/W15/W16）：spec 定义了 SSE 透传与双入口收敛，但**未定义鉴权、上游地址校验、请求体上限、监听地址**——安全缺口集中在 spec 未覆盖处。建议 ts/index.md 补「代理安全契约」节。
2. **TS 数据口径与 Python 分叉 3 处**（W8 qfq、W9 日期格式、W12 字段名）：均为"注释/契约声称一致但实现未履行"。修复 W8/W9 后指标数值才可与 Python 对齐（指标公式本身已 fixture 级验证一致）。
3. **降级契约执行不彻底**（C3/W19/W20/W22）：Python 侧"绝不 raise、占位降级"是 house style，但 3 处格式化/空表路径逃逸。C3 是唯一会崩溃的。
4. **文档/注释与实现漂移**（W21/W24/W30 + 6 处 INFO）：market_time 注释、tool_loop 文案、测试名、docstring 均存在误导性描述——比代码 bug 更危险（诱导维护者"反向修正"）。
5. **测试质量整体优秀**（60 文件零 CRITICAL）：role_registry 双向断言、from_row KeyError、事务计数、e2e mock 零调用审计均为高价值设计；问题集中在 live 用例的环境耦合（W25-W28）与弱断言（W29-W30）。
6. **已知陈旧测试已修复**：`ChinaStock('dummy')` 单参数构造全仓零残留（py-tests INFO 核实确认）。

---

## 修复建议分组（供后续 task 执行）

| 优先级 | 分组 | 内容 | 预估改动面 |
|--------|------|------|-----------|
| P0（立即） | 服务端崩溃/SSRF | C1 + C2（decodeURIComponent try/catch；base 白名单/鉴权；listen 127.0.0.1） | ts/app/server.mjs + proxies.cjs，~30 行 |
| P0 | Python 降级缺口 | C3（daily 空表检查 2 行）+ W19/W20/W22（格式化/解析 try 收口） | core + tools，~15 行 |
| P1 | TS 数据口径 | W8 qfq 接入 + W9 日期格式 + W12 字段名 + W10 时区 | ts/src/tdx + pipeline + overview，~40 行 |
| P1 | 测试环境耦合 | W25-W28（路径锚定 + golden 结构断言 + 节假日容错 + skip 守卫） | test/ 4 文件 |
| P1 | UI 崩溃 | W17（candlestick/volume dropna）+ 数据 Tab 块加 try/except 守护 | charts.py + display.py，~10 行 |
| P2 | 代理安全加固 | W2-W4（请求体上限、日志净化、互斥锁修正、超时 Abort） | proxies.cjs + logs-server.cjs |
| P2 | 死代码清理 | W14/W32/W33（toolLoop finalContent、ReportScreen、makeInvestmentDecision）+ W5/W6 密钥面收敛 | ~80 行删除 |
| P3 | 配置/一致性 | W31 暗色可达、W7 供应链、W21 节假日语义、W24 文案、W23 BJ 提前拦截 | 多文件小改 |

---

## Spec 更新候选（trellis-update-spec 素材）

1. **ts/index.md 补「同源代理安全契约」节**：上游 base 白名单、端点鉴权、请求体上限、监听 host 默认——本次 C1/C2/W1-W4 全部落在该空白。
2. **ts/index.md 流式输出节修正**：streamWithRetry 非对象分支与 LangGraph messages coercion 的现实冲突（W13）——spec 规定"原样作 content 返回"与 node_modules 实证的 MESSAGE_COERCION_FAILURE 矛盾，需规定返回真实消息实例。
3. **data-acquisition.md 降级契约补强**：明确"消费者收到空 DataFrame 也必须降级"（C3 教训），并把 W23（BJ 拦截前置）写入 ensure_stock 段。
4. **testing.md 补「live 用例环境耦合」节**：路径派生自 REPO_ROOT、golden 不绑定可变缓存、节假日容错断言模式（W25-W28 教训）。

## 验证说明

- 覆盖矩阵：slices.json 构造校验 258 in-scope / 0 orphan / 0 dupe（orphans 均为 .trellis/.claude/.omp 基础设施与备份，非业务代码）。
- 核实：C1/C2/C3 主 session 逐行读源码确认；W17/W9 抽样确认；各分片报告内附逐字代码证据。
- 本次零代码改动；工作树保持干净。
