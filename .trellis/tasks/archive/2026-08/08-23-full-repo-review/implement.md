# Implement: Full Repository Review

## 执行清单

1. [ ] 基线：`npm test`（串行）记录通过/失败/跳过计数；`npm run typecheck` 记录结果 → 写入 `research/baseline.md`。
2. [ ] 第一波：一次 task 批量派发 7 个 reviewer 子代理（契约见 design.md），各自写 research/<slice>.md 并返回摘要（发现数×严重度 + 未覆盖面）。
3. [ ] 收集第一波：核验 7 份文件落盘且格式合规；缺漏者补派。
4. [ ] 第二波：收集 major+ 新发现清单，批量派发对抗验证 agent，结论回填各 slice 文件表格（新增「复判定」列）。
5. [ ] 汇总：写 `research/00-review-report.md` — 统计表、P0–P3 排序、整改核验矩阵、回归基线、spec 漂移候选清单。
6. [ ] 收尾：chat 汇报关键结论；spec 更新候选交用户决定；提交工件（Phase 3.4）。

## 验证命令

```bash
npm test                      # 串行基线
npm run typecheck             # tsc --noEmit
python3 ./.trellis/scripts/task.py validate 08-23-full-repo-review
```

## 评审门

- 第一波完成判据：7 个 slice 文件存在且每份含 ≥1 Verified-clean 条目或明确的未覆盖面声明。
- 第二波完成判据：所有 major+ 发现带 CONFIRMED/PARTIAL/REFUTED 复判定。
- 报告门：AC1–AC4 全满足才进入提交。

## 回滚点

任一波失败：仅重派对应 slice；不影响其他产物。
