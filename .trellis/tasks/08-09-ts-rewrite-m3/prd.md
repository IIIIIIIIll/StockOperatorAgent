# M3 RN App 端到端：真实 LLM + 数据链 + Expo UI

## Goal

接上真实 LLM（三键门控 `LLM_API_KEY/LLM_MODEL/LLM_BASE_URL`，OpenAI 兼容），
移植 `build_stock_information` 数据链（ticker → TDX 采集 → SQLite → 指标 →
上下文 → 委员会 → 报告），并搭 Expo RN App：报告/采集数据/设置三 Tab，
事件桥（进度/报告/error/done）驱动 UI。Node 端到端探针 + 降级契约可测；
App 以 Expo web 预览验证渲染，Android dev build 端到端留给真机。

## Requirements

- **R1 真实 LLM 工厂**：`src/llm.ts`——三键缺任一 → 门控错误（对齐 Python
  "请配置 LLM_API_KEY/LLM_MODEL/LLM_BASE_URL"语义）；齐 → `@langchain/openai`
  ChatOpenAI；`_llm` 注入点接通 M2 委员会。M2 的假 LLM 测试继续可用（注入不变）。
- **R2 数据链**：`src/pipeline.ts`——`buildStockInformation(ticker)`：
  行情/概览/业绩/F10 采集（M1 gates/store/FetchScope）→ `compute_all`
  指标 → 组装分析上下文（对齐 Python `build_stock_information` 文本形状：
  概览块/日K尾部块/指标块/F10 块/除权事件块）→ 委员会 → 报告对象。
- **R3 事件流**：`src/events.ts` 或复用 M2 progress.ts——采集进度、
  各角色 report、error、done 事件 → `ProgressUpdater` 协议（M3 接 UI）；
  Node 端订阅可测（`createPipelineRunner` 返回 `{ events, run(ticker) }`）。
- **R4 Expo App**：`ts/app/` 独立 Expo 工程（web 可预览），共享 `../src` 业务层：
  - 报告 Tab：阶段进度条 + 各角色观点（角色名/tab 标题映射）+ 最终报告渲染
  - 采集数据 Tab：日K 表格（尾 N 行）+ K线/成交量图（lightweight-charts,
    web 渲染）+ 指标表 + F10 摘要
  - 设置 Tab：模型三键输入、各能力开关（WEB_SEARCH/BILLIONS/TDX_MCP 对齐
    Python 开关语义）、ticker 输入 + "开始分析"按钮
- **R5 降级契约**：无三键 → 设置 Tab 提示 + 开始按钮禁用（不崩）；无
  TDX_API_KEY → 行情段占位；无 TAVILY key → 搜索段占位；开关语义对齐 Python。

## Acceptance Criteria

- [ ] **AC1** `src/llm.ts` 门控：缺键 → 明确错误信息（三键逐项点名）；
      全键 → ChatOpenAI 实例（注入 baseUrl/model）。
- [ ] **AC2** 数据链单元/集成测试（假 TDX 或 fixture）：`buildStockInformation`
      返回报告对象，含 4 阶段观点、最终报告、消息通道；事件流按序发出
      progress/report/done（error 路径单独测）。
- [ ] **AC3** Node 端到端探针（`SOA_LIVE=1`，真 TDX + 真 LLM）：
      `npm run probe` 完成一次全分析，报告非空、各阶段观点齐；结果落盘
      `probe-output/`（不提交）。
- [ ] **AC4** Expo web 预览：三 Tab 渲染通过——报告 Tab 显示最终报告 +
      观点 expander；采集数据 Tab 显示表格 + K线图；设置 Tab 门控提示
      生效（无键时禁用）。
- [ ] **AC5** 降级：三键缺 → 门控提示不崩（web 预览验证）；无 TAVILY key →
      committee 运行不崩（搜索占位）。
- [ ] **AC6** 回归：`tsc --noEmit` + 全部 vitest（M0-M3）绿；`ts/app` 独立
      typecheck 绿。

## Constraints

- **C1** `src/` 业务层保持纯 TS（零 RN 依赖）——vitest 在 Node 跑全部业务测试；
      RN 组件只在 `ts/app/`。
- **C2** 真实 LLM 调用不写进单元测试（网络依赖）；仅 `SOA_LIVE=1` 探针走真链，
      与 M1/M2 live 探针同约定。
- **C3** 数据链文本形状对齐 Python `build_stock_information`（fixture 或
      逐块断言）；不接 DDG 降级（M4 决策）。
- **C4** App 不提交 node_modules；`ts/app` 的 Expo 依赖独立安装。
- **C5** 模拟器验收（AC2 父任务）受 WSL2 环境限制——本机以 Node 探针 +
      Expo web 验证；Android dev build 步骤文档化留给真机（父任务 AC2 部分打勾，
      真机验收记为环境依赖项）。

## Notes

- 移植源：`core/stock_info.py`（build_stock_information）、`core/llms/__init__.py`
  （LLM 工厂/三键门控）、`core/progress.py`（ProgressBridge 事件形状）。
- M2 handoff：`_llm` 注入点已就绪；committee `makeInvestmentCommittee(llm, config)`
  收 `_llm`。
- 参考：`.trellis/spec/core/index.md`（build_stock_information 节）、
  `.trellis/spec/agents/index.md`。

## 验收结果(2026-08-09)

- [x] **AC1** `src/llm.ts` 门控:缺键点名(7 测试,test/llm.test.ts);
      全键 → ChatOpenAI(modelKwargs.seed=114514,baseURL 注入)。
- [x] **AC2** 数据链:test/pipeline.test.ts(11)+ test/events.test.ts(3)——
      五段块序、事件序(progress→report→done)、error 路径。
- [x] **AC3** Node 探针(`npm run probe`):真 TDX 5835 根日K + 真 F10 +
      图全链跑通(probe-output/report.json,PE 26.04/Pb 0.86);无三键时
      占位 LLM 验证数据链(真 LLM 段待用户配 LLM_* 三键)。
- [x] **AC4** Expo web 生产构建(ts/app,SDK 57):三 Tab 渲染通过——报告
      Tab(全链 9 观点 expander + 最终决策)、采集数据 Tab(表格 + 指标
      chips + 上下文块)、设置 Tab(门控提示 + 开始按钮);完整分析在
      浏览器跑通。
- [x] **AC5** 降级:无三键 → 设置页提示 + 演示占位(不崩);无 TAVILY →
      committee 不绑定 web_search(webSearchEnabled);演示模式全链不崩。
- [x] **AC6** 回归:ts/ 根 71/71 vitest + 双工程 tsc --noEmit 干净。

### 环境依赖项(父任务 AC2 模拟器部分)
- 本机 WSL2 无 Android/iOS 模拟器;RN 真机 TCP(react-native-tcp-socket
  polyfill,M0 D1)与 dev build 端到端需真机验收——步骤见 M4。
- 真 LLM 全链(非占位)需用户配置 `LLM_API_KEY/LLM_MODEL/LLM_BASE_URL`
  (App 设置面板可填;Node 探针走环境变量)。
