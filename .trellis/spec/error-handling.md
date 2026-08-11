---
description: Error handling conventions — boolean result protocol, single raise site, no exception hierarchy
paths:
  - core/data_acquisition.py
  - core/llms/tools/**
  - data_source/**
  - data_storage/**
---

# Error Handling

## The Two Local Patterns

The codebase has **one custom exception class** (`BillionsApiError`,
08-08-billions-api-integration — wrapper-source 边界，见下); `try/except`
exists only in sanctioned places (data-layer 降级捕获点 + UI 层守护，见下)。
Failures follow one of two patterns depending on layer:

### 1. Boolean result protocol (data layer)

`core/data_acquisition.py` methods return `True`/`False` and log the failure:

```python
stock = self.storage.get_stock(ticker)
if stock is None:
    logger.error(f"Stock {ticker} not found in database.")
    return False
```

Same shape in `add_performance_report_in_storage` (missing ticker → `False`)
and `acquire_historical_data`. Callers branch on the boolean
(`DataAcquisition.acquire_*` chain, and `get_stock_info` treats `None` results
as fatal). `data_storage/.../ZODBStorage.py` follows the sibling convention:
`get_stock` returns `None` for missing keys and never raises.

**Wrapper-source exception (TDX path)**: vendored pytdx raises
`ValueError`/`ConnectionError` for invalid codes / server failures (not
"expected absence"). The sanctioned catch sites convert to the layer's
protocol:
- `acquire_historical_data_tdx` (acquisition boundary): daily fetch failure →
  `False`——**PRD 纯 TDX 无 akshare 兜底**（2026-08-02 措辞对齐：`get_stock_data`
  忽略返回值记日志不阻断，返回已构建的 stock；历史缺失由 trend 指标降级
  占位兜底）；
`fetch_finance_capital` / `fetch_xdxr` failure → `logger.warning` + degrade
(换手率 NaN / 未复权) without blocking the main path.
- `overview.py` / `reports.py` 构建层（data_source 内，2026-08-02 新增）：
  **逐源 catch** 是逐源降级设计（PRD：缺字段留 NaN 不整块失败）——每个源
  `_fetch_degraded` 单项失败 → `logger.warning` + 该源字段 NaN；snapshot 与
  日K 均无价格来源（overview）或 F10 不可用（reports）→ 返回 `None` 由调用方
  按失败处理（`ensure_stock` → `False`；`acquire_performance_report_tdx` →
  无报告不算失败返回 `True`）。
Same shape in `get_trend_indicators` / `get_market_intel` (LLM tools): failures
return placeholder text, never raise.

**UI 配置写入（2026-08-08，08-08-billions-switches-ui）**：
`utils/env_file.update_env_file` 是**返回协议而非 raise** 的例外形态：
校验失败（白名单外键/非法 model/空密钥）/ IO 失败 → 返回
`(False, 错误消息)`（消息只含键名不含值），UI 以 st.error 提示；写入
失败不动原文件（tmp 清理）。密钥值任何路径不 log。

**Wrapper-source exception (BillionsClient, 08-08-billions-api-integration)**：
`data_source/chinese_mainland/billions/client.py` 是**唯一自定义异常**
`BillionsApiError(code, status_code, message)` 的 raise 点——与 pytdx
ValueError 同构的 wrapper-source 例外（网络异常 / HTTP 非 2xx / 200 +
`success:false` 归一化，client 内**不重试**）。捕获点全部在亿信消费方
（billions_* 工具 / get_billions_financial_intel / 信息面分析师）：catch →
`logger.warning` + 占位文本，绝不 raise 到 agent 主流程；密钥不写日志。
429（配额）不重试直接降级——重试无意义且浪费配额。

### 2. Raise at the boundary (LLM tool)

`core/llms/tools/get_company_info.py` is the **only raise site in the codebase**:

```python
if is_bj_ticker(ticker):          # BJ 显式提示（review #11，2026-08-02）
    raise Exception('北交所（BJ）股票暂不支持分析：...请使用沪深 A 股代码')
data_acquisition = DataAcquisition()
stock = data_acquisition.get_stock_data(ticker)
if stock is None:
    raise Exception('Stock not found')
```

BJ 检查在构造 `DataAcquisition`（打开 ZODB）之前——离线可直接断言异常；
报错文案与 UI 层 BJ 提示一致（中文，用户可见）。

The raised error propagates through the agent graph call and surfaces in the
Streamlit UI / test output. Keep raising to this boundary — it is where a data
problem becomes a user-facing failure.

## LLM / API Errors

- Agent nodes do not catch LLM errors: `invoke_with_retry(...)`（2026-08-02，
  review #6——可恢复错误重试 3 次，见 agents spec）耗尽后的失败照旧 bubble
  to the graph stream and the caller (`display.py`, tests)。
- **UI 层守护（2026-08-02 修复，合法例外）**：`core/ui/display.py` 对
  `build_stock_information`（数据问题如股票缺失 → `get_stock_info` raise）与
  `graph.stream`（LLM 失败）各包一层 `try/except`——`st.error` 中文提示 +
  `logger.exception`，不裸 traceback 红屏、不吞错误（错误仍记录到日志）。
  Agent 节点内部不 catch，失败照旧冒泡到这两个边界。
- Test-side `try/except`：已被删除的 `test/core/llms/qwen/test_qwen_api.py`
  曾捕获 API 错误打印 DashScope error-code 文档链接（08-09-llm-provider-
  agnostic 随 QwenApi 死代码删除）。
- **素材预抓降级（08-10-web-search-fallback）**：信息面分析师 `_prefetch`
  亿信源失败/空 → 源注明跳过；联网回退（`web_search`，DDG 免 key）失败/空
  → 固定回退文本「（本次运行未检索到任何信息面素材：所有来源均不可用或
  未启用）」，逐字不变——两者都**不 raise**（降级收敛在
  `make_web_search_tool`/`_summarize_results` 单点与 `_prefetch` 判定），
  图不中断；TS 分析师同语义（`webSearchEnabled()` 关 → 不触网直接回退）。

## TS 侧日志（2026-08-11，ts-log-persistence）

统一日志 API 在 `ts/src/log.ts`（web/RN/Node/vitest 全端共用），环境感知
transport;`ts/app/lib/log.ts` 仅为重导出。落盘拓扑：浏览器无 fs → 上报
server 汇聚；RN → expo-file-system 沙盒；server → 原生 fs。

**Signatures**
- `ts/src/log.ts` 导出 `log/info/warn/error/debug(level, message)`；transport
  工厂 `makeReporter(_fetch, _endpoint)` / `makeRnFileTransport(_fs, _writeDisabled)`
  （注入点，house style 无 mock）；`formatLogLine` 行格式单一来源（RN 沙盒）。
- `POST /logs`（`ts/app/lib/logs-server.cjs` 共享实现，metro dev + server.mjs
  双入口，CJS 因 metro 无 strip-types）：
  `{ts?, level, message, platform}` → 200 `{ok:true}`。

**Contracts**
- 行格式（两端一致）：`<ts 本地 YYYY-MM-DD HH:mm:ss> | <LEVEL> | [soa] <message> (platform:<p>)`
- 落盘：默认 `<repo>/logs/soa-ts.log`（`SOA_LOG_DIR` 覆盖）;≥5MB → rename `.1`。
- env：`EXPO_PUBLIC_LOG_ENDPOINT`（RN 上报端点，空不上报）、`SOA_LOG_FILE=0`
  或 `NODE_ENV=test`（客户端不写文件，防测试污染）、`__SOA_DEBUG=1`（debug 级）。

**Validation & Error Matrix**
- level ∉ info|warn|error|debug → 400；message 非 string → 400；platform 空 → 400；
  body >64KB → 413；非 JSON → 400；写盘失败 → 500。客户端上报失败/写文件失败
  → catch 静默降级 console，**不打断业务**（本条是 TS 侧降级风格核心）。

**Good/Base/Bad**
- Good：web 端 `logError` 后 server 未起 → console 照常，业务继续。
- Base：dev/prod 端点行为一致（共享 `logs-server.cjs`，不各自实现防漂移）。
- Bad：静态 import expo-file-system / react-native / node:fs 进 `src/log.ts`
  → 污染其他平台打包（Metro 崩 / vitest 崩）；平台判定用全局探针
  （`window+document` / `navigator.product==='ReactNative'` / `process.versions.node`）。

**Tests Required**
- `ts/test/log.test.ts`（环境分支/上报 payload/RN 沙盒注入/`NODE_ENV=test` 不写文件）、
  `ts/test/log-server.test.ts`（校验矩阵 + 注入 tmp `SOA_LOG_DIR` 落盘/轮转）、
  `retry.test.ts`（退避 warn 断言）。
- 密钥不写日志（settings.ts 已 mask，上报内容与 console 相同）。

**Wrong vs Correct**
- Wrong：`import 'expo-file-system'` 顶层静态导入 → web/Node 构建携带平台专属
  模块。Correct：仅 RN 分支 `await import('expo-file-system')`（静态 specifier，
  Metro 打包要求），环境判定短路使其他平台永不执行。

## Rules of Thumb

- New data-layer methods: return `False` + `logger.error(...)` on "expected
  absence" (missing stock/ticker), return `True` on success.
- New boundary code that must abort a user-facing flow may raise
  `Exception("<short English message>")` — do not invent exception classes until
  there are callers that need to distinguish failure kinds.
- Log first, return/raise second — the log line identifies the ticker/operation.
- Guard the app against a missing LLM 配置 at the UI layer
  (`display.py` 的 `_llm_configured()` checks `LLM_API_KEY` / `LLM_MODEL` /
  `LLM_BASE_URL` 三键 in `os.environ` and shows a Chinese error banner——
  08-09-llm-provider-agnostic 必填强校验) rather than in the data pipeline.
  UI 层同样守护运行期错误（`build_stock_information` / `graph.stream` 的
  try/except → `st.error`）。

## Anti-Patterns

- `assert` for flow control — asserts exist only in tests.
- Swallowing exceptions in production modules (no `except: pass`).
- Returning `None` where the boolean protocol expects `True/False`
  (or vice versa) — keep each layer's contract uniform.
- Raising from `data_source/` or `data_storage/` — those layers return raw data
  or `None`/`False`; conversion to exceptions happens in `core/llms/tools/`.
