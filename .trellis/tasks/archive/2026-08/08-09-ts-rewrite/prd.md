# TS 全量重写 React Native 原生 App

## Goal

用 React Native + TypeScript 全量重写 StockOperatorAgent：原生 App，分析流水线
（数据采集 → 存储 → 多智能体委员会 → 报告）**全部在手机本地执行**，LLM 走云端
OpenAI 兼容 API，无任何 Python 服务端依赖，Android/iOS 双平台。

本任务为父任务：拥有源需求集、任务地图、跨里程碑验收与最终集成复核；规划阶段
第一步是缺口原型（M0），钉死技术选型后展开各层移植。

## Requirements

- **R1 分析流水线完整移植**：ticker 输入 → 数据采集（TDX 行情/个股概览/业绩报告/
  F10 财务）→ 持久化 → 4 阶段委员会（基本面/趋势/技术指标专家∥ → 多空初稿 →
  对抗修订 → 投资经理终审）→ 报告渲染。语义对齐 Python 版：
  专家并行 join、对抗修订双入边 join、经理读修订版（`[-1]`）、消息通道
  add_messages 语义。
- **R2 数据层**：TDX 协议（日K/快照/除权除息/股本/证券列表）、F10 财务（HTTP）、
  SQLite 持久化、qfq 前复权、freshness 门、单遍拉取（FetchScope 语义）。
- **R3 编排层**：`@langchain/langgraph` 装配委员会；工具循环（bind_tools +
  轮数上限 + 每 run 调用上限）；重试（429/5xx/超时指数退避）。
- **R4 UI**：RN 原生——报告 Tab、采集数据表格 + K线/成交量/财务图表、
  设置面板（模型三键/各能力开关/调用上限）。
- **R5 等价性**：同一 ticker 同日，TS 数据层输出与 Python 版**逐字段一致**
  （复权后价格、字段名、'%Y%m%d' 报告期字符串、NaN/None 语义）。
- **R6 手机本地**：分析全程在 App 内运行，无外部 Python 服务；网络仅用于
  行情/LLM/搜索/亿信 API。离线语义 = 查看已同步快照与缓存报告（云端 LLM
  生成新分析必须联网，与 Python 版语义一致）。
- **R7 可选能力保留**：亿信 Fin、Tavily/DDG 搜索、TDX MCP；无 key 环境降级
  占位文本，行为对齐 Python 版开关语义。

## Constraints

- **C1** 重写期间 Python 仓库保持可用；Python 版是等价性测试的 oracle。
- **C2** LLM 云端 OpenAI 兼容，复用现有 `LLM_API_KEY/LLM_MODEL/LLM_BASE_URL`
  配置语义（三键必填门控）。
- **C3** 移动端存储用 SQLite，不移植 ZODB。
- **C4** 不复制 vendored tdx_quant 代码；TDX 行情走 `node-tdx-market` + 必要补丁
  （除非原型证明不可行再评估替代）。
- **C5** 提示词文本逐字移植（中文，禁编造硬约束），不改语义。

## Acceptance Criteria

- [ ] **AC1 缺口原型（M0）**：四个未验证项全部有结论——
      ① node-tdx-market 在 RN 运行时 TCP 可用性（或替代方案）；
      ② `getQuote` 修复后快照字段与 Python 对齐；③ xdxr 数据源定案
      （opcode 移植或 HTTP 源）且复权结果与 Python 对比通过；④ F10 TS
      移植输出与 Python 逐字段一致。结论落盘 research/。
- [ ] **AC2 端到端**：App 输入 6 位 ticker → 完成一次全分析（真 TDX + 真 LLM）→
      报告 Tab 与采集数据 Tab 渲染；至少一台模拟器（Android 或 iOS）验收通过。
- [ ] **AC3 等价性测试**：数据层契约测试套件（vitest）覆盖——freshness 门、
      qfq 复权、add_data 去重、字段映射；用 Python 版导出 fixture 作 oracle，
      离线可跑。
- [ ] **AC4 无服务器**：App 脱离任何 Python/外部计算服务独立完成分析；
      唯一网络依赖为行情/LLM/搜索/亿信 API（各自可开关降级）。
- [ ] **AC5 编排语义测试**：图 join/并行/对抗修订语义、工具循环轮数上限与
      收尾轮、重试退避——离线（假 LLM）测试钉死，对齐 Python 版
      test_graph_parallel / test_tool_loop 契约。
- [ ] **AC6 降级契约**：无 `LLM_*` 三键 → 门控提示；无 TDX_API_KEY/亿信 key →
      对应段占位不崩；开关（WEB_SEARCH/BILLIONS/TDX_MCP_DISABLED）语义
      对齐 Python 版。

## Notes

- 里程碑划分与执行顺序见 `implement.md`；技术选型/决策点/风险见 `design.md`。
- 已确认的库支撑与缺口实测证据见 `research/gap-analysis.md`。
- 体量估计：4-8 周（逻辑可移植 + 硬部分有库），测试重建是最大隐性成本。
- 父任务不含直接实现；每个里程碑为独立子任务，按 implement.md 顺序逐个
  `task.py start`。

## 验收结果（2026-08-10 收尾复核）

- [x] **AC1 缺口原型（M0）**：四决策点全部定案并落盘
      `research/m0-d1~d4-*.md`，design 决策点表 D1-D7 回填（见 M0 验收结果）。
- [~] **AC2 端到端**：Node 探针 + Expo web 全链跑通（真 TDX + 占位 LLM；
      网页端真实 LLM 已于 9c0c039 打通）；**模拟器验收为环境依赖项**——本机
      WSL2 无 Android/iOS 模拟器，Android dev build 步骤已文档化（M3 PRD
      C5），真机验收留待有环境时补打勾。
- [x] **AC3 等价性测试**：vitest 契约套件离线可跑——qfq（5835 根 fixture）、
      indicators、add_datas 去重、f10 双格式，fixture 由 Python 侧导出作
      oracle（`test/fixtures/`）。
- [x] **AC4 无服务器**：`ts/src/` 纯 TS（零 RN 依赖）+ `ts/app/` 共享业务层；
      分析全程本地执行，网络仅行情/LLM/搜索/亿信 API（各自可开关降级）。
- [x] **AC5 编排语义测试**：committee/tool-loop/retry/prompt 离线测试钉死
      join/并行/对抗修订/收尾轮/退避，对齐 Python test_graph_parallel /
      test_tool_loop 契约（见 M2 验收结果）。
- [x] **AC6 降级契约**：`test/llm.test.ts` 三键门控点名、web-search 占位、
      gates 假 fetcher——开关语义对齐 Python 版。
- 全量复核证据：`ts/` `tsc --noEmit` 干净 + `npm test` 14 文件 80 测试绿
      （1 skip = live.integration，SOA_LIVE 门控）；`ts/app` 独立 typecheck 干净。
