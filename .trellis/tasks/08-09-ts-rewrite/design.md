# TS 全量重写 — 技术设计

## 目标形态

```
┌─────────────────────────── RN App（手机本地）───────────────────────────┐
│  UI (React Native + TS)                                                │
│   ├─ 报告 Tab（流式渲染：进度/节点报告/观点轮次 expander）               │
│   ├─ 采集数据 Tab（表格 + lightweight-charts K线/成交量/财务折线）       │
│   └─ 设置面板（模型三键/能力开关/调用上限 → AsyncStorage + env 语义）    │
│                                                                        │
│  src/analysis/  编排层                                                  │
│   ├─ committee：@langchain/langgraph StateGraph 装配（4 阶段/角色注册表）│
│   ├─ agents：AgentNode（prompt 壳 + bind_tools + 对抗修订第二条链）       │
│   └─ tool_loop：工具循环（轮数上限 15 + 收尾轮 + 每 run 调用上限）        │
│                                                                        │
│  src/data/      数据层                                                  │
│   ├─ tdx/：node-tdx-market 客户端（+ 补丁）+ xdxr + F10 HTTP            │
│   ├─ store/：SQLite 仓储（expo-sqlite/better-sqlite3）                  │
│   ├─ adjust.ts：qfq 前复权（移植 adjust.py）                            │
│   ├─ indicators.ts：指标计算（移植 vendor compute_all + extra）          │
│   └─ gates.ts：freshness 门 / FetchScope 单遍拉取语义                   │
│                                                                        │
│  src/prompt/    提示词逐字移植（core/llms/prompt.py）                    │
└─────────────────────────────────────────────────────────────────────────┘
         │ HTTPS
         ├─ 通达信行情服务器（TCP:7709/7727）
         ├─ TDX F10（HTTP 文本区间）
         ├─ LLM（OpenAI 兼容，LLM_BASE_URL）
         ├─ Tavily / DDG（搜索）
         └─ 亿信 Fin / TDX MCP（可选）
```

## 模块边界与契约

### 数据契约（跨层，最重要）

Python dataclass 字段名即契约，TS 侧用 interface + 运行时校验对齐：

| Python | TS | 要点 |
|---|---|---|
| `StockOverview` 22 字段 | `StockOverview` interface | 数值字段保留 NaN 语义（TS: `number \| null` + 显式 NaN 策略） |
| `ChinaStockData`（date: object） | `{date: string(YYYY-MM-DD) \| Date}` | **决策点**：选 ISO 字符串统一比较（Python 侧是 `datetime.date` 对象） |
| `StockPerformanceReport.report_date: '%Y%m%d'` | `string` | 字符串比较契约不变 |
| `from_row(column_map=...)` | 列名→字段映射函数 | 缺列 KeyError → TS 抛错；多余列忽略 |
| 单位 | 厘/手 | node-tdx-market 价格为厘（÷1000），成交量手——对齐 akshare 列语义 |

### 编排层契约（对齐 Python 语义）

- 4 阶段形状：`START → 专家∥(3-4) → 多空初稿（N 入边 join）→ 对抗修订（双入边 join，追加写 opinions key）→ 经理（[-1] 读修订版）→ END`。
- State keys 与 reducer：`messages`/`bullish_opinions`/`bearish_opinions` 用
  add_messages；`information_analysis` 条件存在（`state.get()` 容错）。
- 角色注册表：Python 侧 `role_registry.py` 的 Role 结构（node_name/state_key/
  tab_title/kind/enabled 谓词/factory/revise）→ TS 常量表，装配与 Tab 渲染共用。
- 工具循环：`invoke_with_tools`（15 轮 + 收尾轮 + 未知工具占位 + 异常不阻断）+
  每 run 计数上限（亿信 3/2/3、web_search 建议同款上限）。
- 重试：429/5xx/连接/超时 指数退避 3 次；业务错误直抛。

### 数据层契约

- freshness 门：overview 按交易日（17:00 后）刷新；业绩门按季度末 `'%Y%m%d'`
  比较；历史数据按 `last_data_update` 增量。
- 单遍拉取：FetchScope——同一次分析各源只拉一次；复用判定按**请求尺寸**
  （cached_bars ≥ 请求）而非实际行数。
- qfq：xdxr 事件（每10股单位，除 10；peigujia 元/股）→ 事件日前最后一根未复权
  收盘算因子 → 累乘 → 重算振幅/涨跌幅/涨跌额；缩股 ratio_vol≤0 跳过成交量调整。
- SQLite 表：stocks / daily_bars / performance_reports / overview / meta
  （freshness 戳）；单事务批量写（对齐 add_datas 批量 commit 语义）。

## 决策点（M0 原型已全部定案，2026-08-09）

| # | 决策点 | 结论 | 证据 |
|---|---|---|---|
| D1 | **RN 运行时 TCP** | `react-native-tcp-socket`（6.4.2，活跃）+ Metro `net`/`Buffer` polyfill；node-tdx-market 本体零改动；Expo Go 不支持 → dev build | m0-d1 |
| D2 | **getQuote** | 无 bug——按签名传 `string \| string[]`；快照字段与 Python 逐字段一致 | m0-d2 |
| D3 | **xdxr 数据源** | `CommandType.Gbbq`(15) + opcode 移植（data 段含 count u16）；67/67 事件与 Python 一致；qfq 750 根逐字节 IDENTICAL | m0-d3 |
| D4 | **日期表示** | ISO 字符串（YYYY-MM-DD） | design |
| D5 | **RN 框架** | Expo（dev build + react-native-tcp-socket config plugin），M3 建工程时实测 New Architecture | m0-d1 风险1 |
| D6 | **LLM 配置存储** | 设置面板 → AsyncStorage + 内存覆盖层，语义对齐 runtime_config | — |
| D7 | **F10 数据源**（M0 新增发现） | `CommandType.CompanyCategory(719)/CompanyContent(720)` + 解析器移植；解析与 Python 逐字段一致；**双格式兼容**（通达信 `│`+编号 / 港澳资讯 `｜`+无编号）列入 M1 | m0-d4 |

## 测试策略

- **Python 版作 oracle**：数据层 fixture 由 Python 导出（同 ticker 同日的
  复权后日K/概览/业绩 JSON），TS 契约测试离线断言逐字段相等。
- TS 测试框架：vitest（单元）+ 契约对比（fixture）+ 图语义离线测试
  （假 LLM，对齐 Python test_graph_parallel / test_tool_loop）。
- UI：Playwright（RN web 构建）或 Maestro（原生）——**决策点，M3 阶段再定**。
- 降级/开关：环境变量模拟（对齐 Python 版 env 判定语义）。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| RN 运行时无法跑 node-tdx-market（TCP） | D1 是 M0 第一验证项，最早暴露；备选方案已列 |
| qfq 等价性漂移 | M0 原型 C 直接对比 Python 复权输出 |
| 测试重建工作量被低估 | 等价性 fixture 先行；核心契约清单见 prd AC3/AC5 |
| 双平台构建复杂度 | Expo + EAS；先 Android 模拟器验收（AC2），iOS 后置 |
| 重写期间 Python 版回归 | C1：Python 仓库不动；新代码独立目录/仓库 |

## 兼容与回滚

- 新代码位于仓库 `ts/` 子目录（2026-08-09 并入现有仓库；原独立于
  Python 侧，C1 隔离约束——Python 代码零改动，`ts/` 为独立工程）。
- 每个里程碑可独立验收（AC 各自可测）；M0 失败 → 回到本 design 调整选型后重来，
  不进入 M1。
- 无数据迁移：SQLite 从零建，不读 ZODB 文件。
