# TS 全量重写 — 可行性验证与缺口分析（2026-08-09 会话沉淀）

> **M0 原型已于同日完成（见 research/m0-d1~d4-*.md）——四个决策点全部定案**：
> D1 RN TCP = react-native-tcp-socket polyfill（node-tdx-market 本体零改动）；
> D2 getQuote 无 bug（探针传参错误，按签名调用即可）；
> D3 xdxr = CommandType.Gbbq + opcode 移植，qfq 与 Python 逐字节一致；
> D4 F10 = CommandType.CompanyCategory/Content + 解析器移植，180 行逐字段一致。
> 详细结论与证据见各 m0-d*.md；本文件保留原始分析作为背景。

## 结论：可行性成立

TS 全量重写（React Native 原生 App）能一次性解决四个诉求：
**原生 App + 手机本地跑分析 + 双平台 + 无服务器依赖**。
关键推论：TS 在 RN 运行时原生执行，pydantic-core/Termux 的墙只挡"复用 Python 栈"，
不挡重写。之前 08-09-mobile-offline-app-research 的结论（Termux 全栈 / Flutter 重写 /
Chaquopy 死路）针对的是"复用 Python"，本任务接受重写成本，路线不同。

## 库支撑（已核实）

| 层 | 库 | 状态 |
|---|---|---|
| 编排 | `@langchain/langgraph`（官方 TS 移植：StateGraph/reducer/checkpointer） | ✅ 存在（微软入门指南 + Braintrust 2026 综述佐证） |
| 行情 TCP | `node-tdx-market`（npm, 0.2.1, 2026-06 发布, MIT, 纯 TS） | ✅ **Node 环境实测通过** |
| 存储 | SQLite（RN 用 expo-sqlite / better-sqlite3） | ✅ 架构事实：ZODB 只是 OOBTree 存 dataclass，模型简单可换 |
| 图表 | lightweight-charts（TradingView, MIT） | ✅ 存在，K线/成交量/MA 原生支持 |
| 搜索 | Tavily（官方 HTTP API, 已配好 omp 搜索）+ 可复用 key | ✅ |

## node-tdx-market 实测记录（Node 22, 2026-08-09）

探针脚本连真实通达信服务器（自动测速选中 124.71.187.122）：

- ✅ `getKline`：600036 日K 真实数据
  `2026-08-07 O38.9 H39.1 L38.48 C38.8 V779647`（手），价格单位厘（÷1000）
- ✅ `getStockCount` / `getStockList`：SH 23937 条，code/name/preClose 齐全
- ❌ `getQuote`（五档盘口/快照）：**0.2.1 bug**，抛 `normalized.slice is not a function`
- ❌ xdxr 除权除息：库内无此命令（README + typings 双确认 0 命中）
- ❌ F10 财务：库内无；但 vendor 侧是 HTTP 文本区间拉取
  （`fetch_content(filename, start, length)`，见 company_info_job.py）→ TS fetch 可移植
- ❌ 股本/流通股本（pytdx `get_finance_info`）：库内无

## 关键缺口清单（重写前必须钉死）

1. **`getQuote` bug** — 快照（最新价/五档/涨跌幅）是 overview 构建输入，绕不过。
   修法：fork 修上游（MIT）或本地 patch。`[待验证]` 修复后与 Python 侧 snapshot 字段对比。
2. **xdxr 除权除息缺失** — qfq 前复权（Python `adjust.py`）依赖。
   两选一：移植 pytdx opcode（读 pytdx 源码）或换 HTTP 除权源（akshare/东财）。
   `[待验证]` 数据可得性 + 与 Python 复权结果对比。
3. **F10 财务** — HTTP 文本区间，TS fetch 客户端 + 移植 `f10_parser.py`
   （纯字符串处理，~150 行）+ `tdx_company_info` 解析。对比 Python 输出逐字段。
4. **RN 运行时 TCP** — node-tdx-market 是 Node 库；RN 无 Node `net` 模块。
   `[待验证]` 核心问题：node-tdx-market 内部是否依赖 Node `net`/`http`；
   若依赖，需 react-native-tcp-socket polyfill 或评估替代。
   **这是原型 A 的第一验证项，决定整个数据层选型。**
5. **测试套件重建** — 556 个 Python 测试不能平移；需按模块列出核心契约
   （freshness 门、add_data 去重、qfq 等价、图 join 语义、工具循环上限、降级占位）
   在 TS 侧重写，Python 版作 oracle。

## 复用清单（重写时直接移植逻辑，非代码）

- prompt 全部（core/llms/prompt.py，中文，禁编造硬约束）
- 指标计算（vendored tdx_quant `compute_all` + extra_indicators：MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比/MACD-VH/乖离率——纯数学）
- qfq 复权算法（adjust.py——纯数学，xdxr 数据源换掉即可）
- freshness 门 / FetchScope 单遍拉取 / 单事务语义（逻辑移植）
- 数据模型字段（StockOverview/ChinaStockData/StockPerformanceReport——TS interface + 校验）
- 亿信/akshare/MCP：全 HTTP，直接 fetch 重写

## 参考

- Python 侧架构与各层契约：`.trellis/spec/{core,agents,data_source,data_storage,data_structure}/index.md`
- 供应商选型背景（DDG 反爬失败 105 次实测 → Tavily）：`core/llms/tools/web_search.py` docstring
