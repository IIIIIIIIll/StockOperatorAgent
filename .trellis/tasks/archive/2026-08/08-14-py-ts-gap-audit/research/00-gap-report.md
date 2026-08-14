# Python→TS 功能差距审计汇总报告（phaseout 前置）

> 任务：08-14-py-ts-gap-audit ｜ 审计日期：2026-08-14
> 方法：8 个 trellis-research 分片并行，逐 Python 功能点对照 TS 等价物；关键 BLOCKER 主 agent 二次核实（读代码确认）。
> 结论先行：**Python 功能面 0 结构性缺口**——无「TS 完全没有的能力域」；全部差距集中在 4 个 BLOCKER（2 个接线缺陷 + 2 个 UI 展示缺口）与一批 NON_BLOCKER 行为差异。phaseout 可行，但删 Python 前需先处理 BLOCKER。

---

## 1. 差距总表（按功能域）

| 分片 | Python 覆盖 | 功能点 | FULL | PARTIAL | MISSING | BY_DESIGN | BLOCKER |
|---|---|---|---|---|---|---|---|
| py-orchestration | main.py、investment_committee、role_registry | 27 | 21 | 3 | 0 | 2 | 0 |
| py-data-acq | data_acquisition、legacy_akshare、stock_output_formatter | 29 | 12 | 7 | 0 | 10 | 0 |
| py-llms | core/llms/ 5 + tools/ 13 | ~68 | ~55 | 10 | 0 | 2 | 1 |
| py-agents | base + 7 agent | 32 | 15 | 17 | 0 | 0 | 0 |
| py-ui | display、charts、data_markdown、theme | 55 | — | 14 | 2 | 0 | 4 |
| py-data-source | tdx 非 vendor 6 + billions client + akshare | 44 | 33 | 2 | 2 | 7 | 0 |
| py-storage-structure | ZODBStorage + 5 dataclass | 25 | 10 | 9 | 1 | 5 | 0 |
| py-utils-scripts | utils 8 + scripts 2 + export_fixtures | 23 | 6 | 9 | 1 | 6 | 1 |
| **合计（去重后）** | **全部 in-scope Python** | **~300** | **~150** | **~70** | **5** | **~32** | **4** |

MISSING 5 项中 4 项为 **Python 侧死代码**（fetch_minute、fetch_index——08-09-debt-cleanup/prd.md:38 记录；StockInfo——仅 test_akshare.py 消费；backfill 相关脚本）——随 Python 删除，TS 无需补；1 项为 UI 展示缺口（财务趋势图，见 BLOCKER-4）。

---

## 2. BLOCKER 清单（删 Python 前必须处理）

### BLOCKER-1：亿信调用上限 UI 死控件（三片交叉印证：py-llms P-1 / py-ui P2 / py-utils-scripts M1）

- **Python 行为**：设置面板上限 → `set_runtime_overrides` → env `BILLIONS_{CAP}_MAX_CALLS` → 工具 `max_calls` 消费（display.py:143-146、billions_config.py:117-122）。**会话内生效**。
- **TS 现状**：`settings.ts:18-22` CapsState 定义、`SettingsPanel.tsx:31-35` 渲染、localStorage 持久化（settings.ts:46,69）——但 `runner.ts assembleTools`（168-177）**只收 keys、不收 caps**；`App.tsx` 不写 env；`billionsTools.ts:159-161` `maxCallsFor` 只读注入或 env。**面板值从不生效**（env 覆盖与默认 3/2/3 本身可用）。
- **处置**：接线（caps 传入 `makeBillionsTools` 的 `opts.maxCalls`，billionsTools.ts:145 注入参数已就绪，一行级）或移除 UI 控件明示仅 env 可配。**需用户决策**。

### BLOCKER-2：日K 表缺「涨跌幅 / 换手率」列（py-ui P6/MD1）

- **Python**：日K 表 8 列（日期/开盘/收盘/最高/最低/涨跌幅/成交量/换手率），data_markdown.py:313-314。
- **TS**：DataScreen.tsx:75-89 仅 6 列（日期/开/收/高/低/量(手)）。
- **数据在手**：pipeline.ts:64-65 已算 changePct/turnoverPct。纯展示补齐。

### BLOCKER-3：按日涨跌幅柱图缺失（py-ui M1/C6）

- **Python**：`change_percent_chart`（charts.py:144-163，正红负绿柱）。
- **TS**：无此图；仅「最新指标」chip 有单日涨跌幅。
- **数据在手**（pipeline.ts:64）。补 lightweight-charts 柱图或 phaseout 显式决策接受损失。

### BLOCKER-4：财务跨期趋势折线缺失（py-ui M2/C7）

- **Python**：`financial_charts`（charts.py:165-184，净利润/销售毛利率/每股收益跨期折线，各自成图）。
- **TS**：无跨期财务图；业绩卡片仅最近 4 期且缺「销售毛利率」字段（DataScreen.tsx:118-135）。
- **数据齐备**（performance_reports in store）。补图成本低。

---

## 2.5 决策记录（2026-08-14 用户拍板）

| 决策点 | 决定 | 影响 |
|---|---|---|
| B1 亿信 caps 死控件 | **接线到工具层**（caps → assembleTools → maxCalls 注入） | phaseout 任务 A：接线后面板生效 |
| B2/B3/B4 UI 缺口 | **全部补齐**（日K 2 列 + 涨跌幅柱图 + 财务趋势图） | phaseout 任务 B：合并为一个 UI 补齐 |
| C1 web 亿信预抓 | **补 key 注入**，**注意安全问题**（key 不落日志、不新增代理透传、保持浏览器端直连现状） | phaseout 任务 D：注入路径 + 安全约束 |
| C2 M3 契约口径 | **更新契约为准**（TS 为最终实现，空白差异接受；改 agents.ts 头注释） | phaseout 任务 E 收尾：注释修正 |
| C8 freshness 门 | **接线恢复同日跳过** | phaseout 任务 C：gates.ts 门接入采集链 |

未问询的次要项按推荐默认：C3 无 key 谓词差异 → 记录为设计差异；C4 overview 命名 → 修正注释 + 记录；C5 LangSmith → 接受无遥测；C6 Node 探针 → 接受现状；C7 配置持久化 → 接受（Node 侧非主路径）。

---

## 3. 需用户确认项（跨片汇总，均影响 phaseout 边界决策）

| # | 事项 | 证据 | 选项 |
|---|---|---|---|
| C1 | **web 端亿信预抓恒关**：committee.ts:61 expert 工厂不传 `_billionsClient`、App/runner 无注入 → 分析师亿信三源+twitter 预抓在 web 端恒关（agents.ts:342 回退无 key client），只走 DDG 回退；Python 桌面端（.env key）可用 | py-agents P3（已核实 committee.ts:61 / agents.ts:340-344） | ① 补注入（localStorage key → `_billionsClient`）② 接受为现状降级并记录 |
| C2 | **M3 逐字契约口径**：9/9 查询模板空白字节漂移（Python 双换行 vs TS 单换行；修订+经理尾部缺 `\n        `）；agents.ts 头注释「M3 逐字对齐」与事实不符 | py-agents P1（字节级比对 + test_query_baselines.py 基线） | ① 按 Python 基线补字节 ② 更新契约声明（TS 为最终实现，基线随删） |
| C3 | **无 key 注册谓词差异**：边角配置（无 key+web 关+SEARCH 开）Python 8 节点 vs TS 9 节点（committee.test.ts:105-108 固化） | py-orchestration P1 / py-agents P4 | 对齐或记录为设计差异 |
| C4 | **overview 字段命名漂移**：TS 键 amount/open_/prev_close/change_percent_60d vs Python StockOverview turnover/open/previous_close/change_percent_60days；overview.ts:1-2 注释与实际不符 | py-data-source 附注 1 | 统一命名或修正注释（当前 TS 内部自洽） |
| C5 | **LangSmith 仅持久化未接线**：SettingsPanel.tsx:13 注释自认；Python 落 .env 被 SDK 消费 | py-ui P3 | 移植遥测接线或接受无遥测 |
| C6 | **Node/探针链路**：probe.mts 直调不绑亿信工具/不注入情报段，与 Python headless 入口不同；北交所无 API 层守卫 | py-orchestration P2/M4c | 补接线或接受（web 是唯一用户入口） |
| C7 | **配置持久化介质**：web 密钥 localStorage vs Node process.env——服务器重启丢失（仅影响 Node 侧配置） | py-utils-scripts #13 | 补 server 侧配置持久化或接受 |
| C8 | **gates.ts freshness 门未接线**：overviewNeedsRefresh/reportsFresh/FetchScope 生产零引用（仅单测）→ TS 恒采集（正确超集，优化损失） | py-data-acq P4/P5 | 接线恢复「同日跳过」优化或保持恒采集 |

---

## 4. 移植优先级建议

**P0（BLOCKER-1 接线）**：亿信 caps 死控件——唯一「设置无效」类缺陷，三片独立确认，修复面一行级（caps → assembleTools → maxCalls 注入）。

**P1（BLOCKER-2/3/4 UI 展示）**：日K 表 2 列 + 涨跌幅柱图 + 财务趋势图——数据全部在手，纯展示层补齐；3 项可合并为一个 UI 补图任务。

**P2（用户确认项）**：C1 亿信预抓注入（若接受 web 端现状则降级为记录）、C2 契约口径、C4 命名统一——随 phaseout 决策一并定。

**P3（NON_BLOCKER 行为差异）**：正极性覆盖键（P-2/P-3）、tool_loop 失败 warn 日志（P-5）、亿信预抓参数对齐（_COUNT 5→10、公告检索词）、format 双副本收敛（py-agents P11）、overview 键名注释——均为收尾级，可并入各移植任务。

**随 Python 删（无需移植）**：legacy_akshare.py 整体、akshare/fetch_stcok_data.py、mcp_intel_cache.py、fetch_minute/fetch_index 死代码、StockInfo dataclass、17:00 门（ZODBStorage）、backfill/export 脚本、is_trading_time（决策不移植）、北交所路径。

---

## 5. phaseout 建议顺序

1. **接线任务**：BLOCKER-1（caps 接线）+ C1（亿信预抓注入，若采纳）——TS 功能完整化。
2. **UI 补齐任务**：BLOCKER-2/3/4（日K 列 + 两图）——用户可见展示完整化。
3. **分域删除**（每域独立可验证）：先删死代码面（akshare/legacy/mcp_cache/死代码 dataclass）→ 再删数据源面 → 工具/agent 面 → 编排/UI 面 → main.py。每域删除前跑 vitest + tsc + 现有 Python 测试回归对照。
4. **收尾**：M3 契约口径（C2）、命名统一（C4）、格式副本收敛、gates 门接线决策（C8）。

---

## 6. 验证记录

- 8 分片研究报告齐备：`research/py-{orchestration,data-acq,llms,agents,ui,data-source,storage-structure,utils-scripts}.md`
- BLOCKER-1 二次核实：grep 确认 assembleTools（runner.ts:168-177）不收 caps、maxCallsFor 只读 env/注入（billionsTools.ts:159-161）✓
- C1 二次核实：committee.ts:61 工厂不传 client、agents.ts:342 回退 `new BillionsClient()` ✓
- 工作树：零业务代码改动（git status 仅任务目录新增）✓
