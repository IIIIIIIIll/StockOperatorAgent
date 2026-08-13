# Implement：执行计划

## 阶段 0 — 规划（已完成）

- [x] 建 task（08-13-full-codebase-review）
- [x] 分片清单 slices.json（258 in-scope，0 orphan / 0 dupe，TS 6 片加重）
- [x] prd.md / design.md

## 阶段 1 — 派发 15 个并行审查 subagent

- 1.1 一次性 `task` 批量派发（同一 tasks[] 数组）：
  - TS 6 片 + Python 8 片 → `scout`（只读审查，不修改代码；审查=读+报告）
  - security 1 片 → `scout`（全仓密钥/路径/注入扫描）
  - 每片任务指令含：文件清单（从 slices.json 内联）、发现格式契约、必读 spec 路径、防假阳性规则
- 1.2 每片输出写入 `research/<slice>.md`；返回摘要
- 1.3 批内 context 声明：纯审查、零代码修改、跳过 formatter/linter/测试套件

## 阶段 2 — 汇总与核实

- 2.1 收齐 15 份报告（task 批量派发自动收集）
- 2.2 主 session 核实：每个 CRITICAL 全查、WARNING 抽样，读代码确认行号与语义
- 2.3 去重合并跨分片发现
- 2.4 产出 `research/00-review-report.md`（分级 + 主题 + 修复建议分组）

## 阶段 3 — 交付

- 3.1 向用户呈现汇总报告 + 完整发现清单
- 3.2 修复建议留档；修复另行开 task（本任务零代码改动）
- 3.3 `task.py finish` + journal 记录

## 验证

- 覆盖矩阵：slices.json 已校验（0 orphan / 0 dupe）——in-scope 完整性由构造保证
- 每片报告存在且含逐文件审阅记录
- 汇总报告中 CRITICAL/WARNING 标注「已核实」

## 回滚点

- 纯只读任务：无代码改动，无回滚需求；若发现 subagent 报告质量差 → 单片区重派
