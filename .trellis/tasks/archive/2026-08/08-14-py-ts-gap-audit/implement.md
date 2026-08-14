# Implement：Python→TS 功能差距审计执行计划

## 执行顺序

1. **研究分片 dispatch**（本阶段）：8 个 trellis-research 分片并行，产出 `research/<slice>.md`
2. **汇总**：主 agent 读 8 份分片报告 → 二次核实关键 MISSING/BLOCKER → 产出 `research/00-gap-report.md`
3. **PRD 收敛**：按审计结果收敛 prd.md（差距清单为准绳）
4. **review gate**：向用户展示规划总结（差距总表 + phaseout 建议顺序）→ 用户批准后 `task.py start`

## 验证命令（汇总阶段）

- `python3 ./.trellis/scripts/task.py validate 08-14-py-ts-gap-audit`
- slices 矩阵核对：全部 in-scope Python 文件被恰一个分片认领（grep research/*.md 的认领清单对照 glob）
- `git status` 确认工作树干净（零业务代码改动）

## 风险与回滚

- 分片遗漏 → 汇总阶段对照 glob 清单逐一核对认领
- 假阳性 MISSING → 防假阳性规则 + 汇总二次核实
- 本任务无代码改动，无回滚面

## start 前 follow-up

- [ ] 8 份 research/<slice>.md 齐备
- [ ] 00-gap-report.md 差距总表完成
- [ ] prd.md 收敛通过（无重复事实、无未决阻塞问题）
- [ ] implement.jsonl / check.jsonl 各有 ≥1 条真实 spec/research 条目
- [ ] 用户已批准最终规划总结
