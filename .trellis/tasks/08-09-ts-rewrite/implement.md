# TS 全量重写 — 执行计划

父任务，里程碑 = 子任务，按顺序逐个 `task.py start`。
每个里程碑验收通过才进入下一个；M0 失败 → 回 design.md 调整选型，不进入 M1。

## M0 — 缺口原型（第 1 个可独立验收子任务，1-2 天）

**目标**：钉死 design.md 四个决策点，产出 research/ 结论。

1. **D1 RN TCP 验证**：读 node-tdx-market 源码确认内部传输实现
   （Node `net`？）；RN 环境（Expo）可行性验证；不可行则评估
   react-native-tcp-socket + 移植协议层。
2. **D2 getQuote 修复**：定位 `normalized.slice is not a function`（0.2.1），
   fork/patch；拉真实快照与 Python 侧 snapshot 字段对比。
3. **D3 xdxr 数据源**：读 pytdx `get_xdxr_info` 源码 → TS 移植 opcode；
   验证事件字段（fenhong/songzhuangu/peigu 每10股、peigujia 元/股）；
   跑通 `adjust.py` 移植的 qfq 与 Python 输出对比（同 ticker 同区间）。
4. **D4 F10 移植**：TS fetch 客户端（filename/start/length 文本区间）+
   移植 `f10_parser.py` 分节解析；与 Python `build_reports` 输出逐字段对比。

**验收**：research/ 落盘四个结论 + 对比证据；AC1 全部打勾。

**命令**：vitest 契约对比用例（fixture 由 Python 导出）全绿；
Node 探针脚本拉真数据成功。

## M1 — 数据层移植（SQLite + freshness + 指标）

- SQLite schema + 仓储（对齐 design 数据层契约；单事务批量写）
- freshness 门 / FetchScope 单遍拉取 / 交易日判定（`get_last_business_day` 语义）
- indicators.ts（MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比/MACD-VH/乖离率）
- qfq 复权（M0 已验证的算法/数据源）

**验收**：fixture 等价性测试全绿（复权后日K/概览/业绩逐字段）；
M0 的 getQuote/xdxr/F10 全部接入。

## M2 — 编排层移植（LangGraph JS）

- prompt 逐字移植 + AgentNode（bind_tools 回退、revise 第二条链）
- tool_loop（15 轮 + 收尾轮 + 计数上限） + retry（指数退避）
- committee 装配（角色注册表 TS 版，4 阶段 + 条件信息面节点）
- 亿信/搜索工具工厂（Tavily 主 + DDG 降级）

**验收**：离线图测试（假 LLM）钉死 join/并行/对抗修订/收尾轮语义，
对齐 Python test_graph_parallel / test_tool_loop 契约；AC5 打勾。

## M3 — RN App（Expo 起步，D5 决策）

- 骨架 + 流式事件桥（SSE 语义 → 本地事件，进度/报告/error/done）
- 报告 Tab（观点轮次 expander、tab 映射）、采集数据 Tab（表格 +
  lightweight-charts K线/成交量/财务）、设置面板
- 降级/开关语义接入（无 key 占位不崩）

**验收**：Android 模拟器端到端（真 TDX + 真 LLM）AC2 打勾；AC4 无服务器打勾。

## M4 — 等价性 + 双平台 + 收尾

- AC3 数据层契约测试（fixture oracle）全量跑绿
- iOS 验收（AC2 补 iOS 模拟器）
- spec 更新（新架构的 TS 侧开发规范写入 .trellis/spec 或新 spec 文件）
- 部署文档（EAS 构建、双平台签名）

**验收**：AC1-AC6 全勾；父任务集成复核（跨里程碑边界无遗漏）。

## 总则

- 每里程碑：先 `task.py create` 子任务（`--parent 08-09-ts-rewrite`）→ 规划工件
  → review → `task.py start` → 实现（trellis-implement）→ 检查（trellis-check）
  → 验收 → archive。
- Python 仓库零改动（C1）；oracle fixture 导出脚本放 TS 仓库 tools/。
- 依赖顺序写进子任务 prd（M1 依赖 M0 结论等），父子不隐含依赖。
