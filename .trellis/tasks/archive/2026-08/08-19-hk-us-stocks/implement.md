# Implement — 港股美股支持

## 执行序（波次）

| 波次 | 切片 | 动作 | 验证 gate |
|---|---|---|---|
| 1 | S1 | task.py start → 实现 → 合并 | 单测绿 + typecheck |
| 2 | S2 ∥ S4 | 并行 worktree 实现 → 各自合并 | 各自单测绿 + typecheck |
| 3 | S3 | 实现 → 合并 | 探针冒烟 + 代理冒烟 |
| 4 | S5 | 实现 → 合并 | 全量测试 + 浏览器 E2E |
| 5 | — | trellis-check + spec 更新 + 归档 | 全量验证清单 |

## 每切片验证命令

- S1: `npm test -- test/market.test.ts test/gates.test.ts` + `npm run typecheck`；既有 gates 用例零改动绿。
- S2: `npm test -- test/yahoo.test.ts test/finnhub.test.ts` + typecheck。
- S3: `SOA_COLLECT_ONLY=1 node --experimental-transform-types tools/probe.mts 00700`（≥500 日K、≥8 报告行、currency HKD）；`AAPL`（USD、bars≥1000）；`09988`（落 09988.HK）；`600036`（CN 回归）；web 代理冒烟 `curl -X POST localhost:8090/yahoo-collect -d '{"ticker":"0700.HK"}'`。
- S4: `npm test`（committee/agents/pipeline/events 相关）+ typecheck + `npm run probe -- 600036` 演示跑一致。
- S5: `npm test` + typecheck + 浏览器 E2E（00700/AAPL/09988/600036）。

## 回滚点

每切片单 commit（fast-forward 优先）；`git revert <切片 commit>` 即回滚该切片。切片间文件所有权零重叠（见 design.md 表），冲突按表归属解决。

## 收尾

Phase 3：master 全量 `npm test && npm run typecheck`；trellis-check 代理；`trellis-update-spec`（ts/index.md 增港股/美股节、error-handling.md 增双异常说明）；子任务按依赖序 archive，父任务最后 archive；add_session.py 记 session。
