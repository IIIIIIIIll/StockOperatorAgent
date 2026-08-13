# 全量 codebase review——分片 subagent 审查不留死角

## Goal

对 StockOperatorAgent 仓库做一次**完整、逐文件、不留死角的代码审查**：Python 主仓（core/agents/data_source/data_storage/data_structure/utils/scripts）+ TS 移植（ts/src、ts/app、ts/test）+ 测试套件 + 安全面。**TS 侧加重审查权重**（用户明确要求"特别仔细"）。产出可行动的、带文件:行号证据的分级发现清单，汇总为 review 报告。

**纯审查任务：不修改任何业务代码。** 发现 → 报告 → 留档；修复另开 task。

## Scope

### In scope（258 个源文件，分片见 design.md）

- Python 业务代码：`core/`（data_acquisition、investment_committee、role_registry、ui/、llms/ 含 tools/）、`agents/`（base + 7 agent）、`data_source/chinese_mainland/`（akshare、billions、tdx 非 vendor 6 文件）、`data_storage/`、`data_structure/`、`utils/`、`scripts/`、`main.py`
- Python 测试：`test/` 全部（60 文件，含 e2e mock 套件）
- TS：`ts/src/`（25 文件：events/progress/pipeline/retry/agents/committee/store/indicators/tdx 客户端/webSearch 等）、`ts/app/`（App/screens/components/lib/proxies/server/theme）、`ts/test/`（22 测试 + fixtures）、`ts/tools/`
- 配置文件：`.streamlit/config.toml`、`ts/app/{app.json,package.json,tsconfig.json}`、`ts/app/metro.config.js`

### Out of scope（明确排除，防噪音）

- `ts/node_modules`、`ts/app/node_modules`、`ts/app/dist`、`ts/app/.expo` — 依赖与构建产物
- `data_source/chinese_mainland/tdx/vendor/` — 上游 tdx_quant 快照（VENDOR.md 声明零改动，08-09-vendor-surface-audit 已审计可达面/死面；本任务只查 **tdx_source.py 的导入接缝**，不逐行审 vendor 代码）
- `database/*.fs*` — ZODB 二进制
- `logs/`、`.env`（含密钥，只检查 .env.example 模板与密钥引用方式）
- `.trellis/`、`.claude/`、`.omp/` 基础设施自身

## Requirements

1. **逐文件覆盖**：每个 in-scope 文件被恰好一个分片认领（slices.json 已保证 0 orphan / 0 dupe），每个分片 agent 必须逐一阅读其全部认领文件并输出发现。
2. **TS 加重**：TS 6 个分片（vs Python 8 片）独立审查；对事件协议、流式输出、同源代理、图表渲染、LLM 重试做**协议级正确性检查**，不只查风格。
3. **对照 spec 审查**：每个分片必须阅读对应 layer spec（index.md + 相关子规范 + guides）核对约定符合性——`agents/index.md`（State 契约、prompt 位置、反模式）、`core/index.md`（数据采集、UI 契约）、`data_source/index.md`（from_row 命名构造、薄包装）、`data_storage/index.md`（事务、锁、单例）、`data_structure/index.md`（持久化 dataclass、批量 mutator）、`ts/index.md`（事件协议、流式、代理 SSE 透传、图表约定）、`guides/`（跨层思考、复用思考）。
4. **发现分级**：每条发现带严重度（CRITICAL / WARNING / INFO）+ 文件:行号 + 代码证据 + 问题描述 + 建议修复。
5. **防假阳性**：遵守 `guides/index.md` 的 AI review 验证规则——CRITICAL/WARNING 必须先对照真实代码核实再上报；注意三个已知假阳性模式（信任边界混淆、忽略设计注释、变量误读）。
6. **验证**：汇总阶段对关键发现二次核实（读代码确认行号与语义），报告注明「已核实」。

## Acceptance Criteria

- [ ] slices.json 覆盖矩阵：in-scope 258 文件全部认领，0 orphan / 0 dupe
- [ ] 15 个分片全部完成，每个分片产出 `research/<slice>.md` 发现清单
- [ ] 每个分片报告含：逐文件审阅记录（或明确的"该文件无发现"）+ 分级发现 + 与 spec 的符合性结论
- [ ] 汇总报告 `research/00-review-report.md`：按严重度排序的发现清单（CRITICAL/WARNING 带已核实标记）+ 跨分片主题归纳 + 修复建议分组
- [ ] 工作树保持干净（本次零代码改动）

## Notes

- 本任务不修复、不重构、不提交代码改动；发现的修复建议留档供后续 task 执行。
- 报告语言：中文（发现标题可含英文符号名）。
