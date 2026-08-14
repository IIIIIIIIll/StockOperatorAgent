# Design：Python 分域删除（child E）

## 1. 架构边界

- **删除面**：仓库根 Python 业务代码 + 对应 Python 测试。TS 侧零业务改动（A-D 已前置）。
- **保留面**：`ts/tools/export_fixtures.py` 生成的 fixtures JSON（被 9 个 TS 测试消费——`fixtures/` 静态文件冻结，export_fixtures.py 脚本本身可随 E1 删除或保留为工具，见 E1 决策）；`.trellis/`、`.claude/`、`.omp/`、`.streamlit/`（Python UI 配置，随 E4 评估）、`docs/`（历史文档保留或更新）。
- **依赖契约**：E2-E4 删除前，被删文件在 TS 的等价物必须 FULL 或 PARTIAL-已处置（A-D 保证）。每域删除用审计报告 gap 表核对。

## 2. 删除顺序与验证门（每域 = 一个 commit + 验证）

| 域 | 内容 | 验证门 |
|---|---|---|
| E1 | 死代码面（见 PRD 表） | vitest + tsc + grep 无引用 |
| E2 | 数据源面 + 存储/结构面 | vitest + tsc + probe.mts 采集冒烟 |
| E3 | llms + tools + agents | vitest + tsc + 完整分析冒烟（demo LLM 跑通图） |
| E4 | core + utils + main.py + scripts 剩余 | vitest + tsc + 全量冒烟 |
| E5 | 收尾（C2/C4 注释 + spec/README） | tsc + spec 一致性 |

## 3. 风险与对策

- **残留 import**：每域删除前 `grep -rn "<deleted module>"` 全仓；Python 内部跨域引用（如 E2 删 data_storage 而 E3 的 agents 还 import）→ 严格按域序删除可避免（E1→E4 由依赖低到高）。
- **测试套件连带**：Python 测试按域删除（test/data_source/ 随 E2，test/agents/ 随 E3 等）；`test/e2e/`（Streamlit mock 套件）随 E4 删除。
- **误删**：删除清单以审计报告为准；git rm 前 `git status` 复核。
- **export_fixtures.py**：fixtures JSON 冻结保留；脚本若后续无再生需求随 E1 删（决策：保留脚本至 E5，避免 fixtures 无法再生的风险，E5 时若确认无再生需求再删）。

## 4. 回滚

每域独立 commit → 单域回滚 `git revert <commit>`；域内删除前记录文件清单，回滚粒度=域。

## 5. 冒烟路径

- probe.mts（Node 直连）：采集 600036 → 打印概览/指标（验证 E2 后采集链）
- demo LLM 跑通全图（验证 E3 后委员会/agent 链）
- 浏览器 web 端一次完整分析（最终验收，E4 后）
