# Design：全量 codebase review 分片方案

## 1. 分片矩阵（15 片，slices.json 为权威清单）

TS 侧 6 片（加重权重，用户要求），Python 8 片，安全 1 片。

| # | 分片 | 文件数 | 内容 | 审查重点 | 对应 spec |
|---|------|--------|------|----------|-----------|
| 1 | ts-events-streaming | 8 | events/progress/pipeline/retry/llm/prompt/toolLoop/gates | 事件协议正确性、流式增量、重试语义、工具轮 reset 通道、权威覆盖规则、闭包陈旧 | ts/index.md |
| 2 | ts-orchestration | 6 | agents/committee/store/store-memory/log/format | 角色映射、opinions reducer 语义、状态装配、事件时序 | ts/index.md |
| 3 | ts-data-indicators | 11 | indicators/adjust/overview/reports/f10/tdx{3}/webSearch/webCollect | 指标计算正确性（对照 Python 侧）、复权、NaN 处理、TDX 客户端、采集 | ts/index.md + data_source |
| 4 | ts-app-ui | 12 | App/screens{3}/components{3}/theme/app.json/package/tsconfig | 流式渲染、DataScreen 图表、设置面板开关中途变更、RN/web 兼容 | ts/index.md |
| 5 | ts-app-server | 8 | proxies.cjs/logs-server{2}/runner/settings/log/server.mjs/metro.config.js | SSE 透传、writeHead 后抛错兜底、代理鉴权、日志汇聚、CJS/ESM | ts/index.md |
| 6 | ts-tests | 24 | ts/test 22 + fixtures + tools{2} | 测试质量、覆盖断言、fixtures 与生产数据一致性 | ts/index.md |
| 7 | py-core-data | 3 | data_acquisition/legacy_akshare/stock_output_formatter | 数据新鲜度、TDX 采集链、NaN 渲染、format 契约 | core/data-acquisition.md |
| 8 | py-orchestration | 3 | investment_committee/role_registry/main | 图装配、注册表单点、tab 单一事实源、条件接线 | core/investment-committee.md + agents |
| 9 | py-llms | 18 | llm_factory/retry/prompt/progress/tool_loop + tools/{12} | LLM 工厂、重试策略、工具循环、亿信工具、web_search | agents/llm-config.md + tools.md |
| 10 | py-agents | 8 | base + chinese_mainland 7 agent | 构造签名、revise 轮、State 读写、prompt 归属 | agents/agent-template.md |
| 11 | py-ui | 5 | display/data_markdown/charts/theme/config.toml | Tab 渲染、图表、主题、display 契约 | core/ui*.md |
| 12 | py-data-source | 9 | akshare/billions{2}/tdx 非 vendor{6} | 薄包装、from_row 命名构造、TDX 源导入接缝、错误归一化 | data_source/index.md + tdx.md + mapping.md |
| 13 | py-storage-utils | 16 | data_storage{1}/data_structure{5}/utils{8}/scripts{2} | 事务提交、锁、单例、持久化 dataclass、批量 mutator、常量 | data_storage/index.md + data_structure/index.md |
| 14 | py-tests | 60 | test/ 全部 | 测试有效性、mock 与生产一致性、e2e 契约、防 tautological | guides/index.md + 各 layer |
| 15 | security | 全仓 | 密钥/环境/路径/注入/依赖/代理暴露 | API key 处理、命令注入、SSE 代理暴露、ZODB 路径、依赖风险 | guides 验证规则 |

## 2. 发现格式契约（每片输出 `research/<slice>.md`）

```markdown
# <slice> 审查报告

## 审阅覆盖
| 文件 | 行数 | 结论 |
|------|------|------|
| <path> | N | 有发现/无发现 |

## 发现
### [CRITICAL|WARNING|INFO] <标题>
- **位置**: <file>:<line>（可多行）
- **问题**: <描述>
- **证据**: <代码引用，逐字摘录关键行>
- **建议**: <修复方向>
- **spec 对照**: <违反/符合 spec 哪条，或 N/A>

## spec 符合性结论
<该层整体符合/偏离清单>
```

严重度定义：
- **CRITICAL** — 数据错误/丢失、崩溃、安全漏洞、协议破坏、会触发线上事故的 bug
- **WARNING** — 潜在 bug、边界未覆盖、spec 偏离、死代码/重复、性能隐患
- **INFO** — 风格、命名、注释、可维护性建议

## 3. 防假阳性（必须遵守 guides/index.md）

上报 CRITICAL/WARNING 前先核实真实代码；警惕三个已知模式：
1. 信任边界混淆（内部 manifest 数据 ≠ 外部不可信输入）
2. 忽略设计注释（代码注释说明的刻意行为 ≠ bug）
3. 变量误读（追踪到实际定义再下结论）

## 4. 汇总

主 session 收齐 15 份报告后：
1. 核实每个 CRITICAL/WARNING 的关键行号与语义（抽样+重点全查）
2. 合并跨分片重复发现（如 TS 与 Python 指标实现偏差）
3. 产出 `research/00-review-report.md`：分级排序 + 跨片主题 + 修复建议分组

## 5. 分片独立性

各分片文件集合互斥（slices.json 已校验 0 dupe），可全并行；共享契约 = 上述发现格式 + spec 文件路径。无需分片间通信。
