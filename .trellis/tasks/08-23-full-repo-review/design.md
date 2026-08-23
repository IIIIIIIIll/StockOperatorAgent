# Design: Full Repository Review

## 方法论

两阶段评审 + 一条基线，全部只读：

1. **基线实证**（主会话执行）：`npm test`（串行）+ `npm run typecheck`。结果作为 AC3 证据；测试失败本身是发现。
2. **第一波：7 路并行域评审**（reviewer 子代理，各写 `research/<slice>.md`）：
   - `verify-remediation` — 逐条核对 findings_verified.md 的 CONFIRMED 清单在 HEAD 的状态。
   - `src-core` — market/gates/events/pipeline/committee/overview/stores/adjust/indicators/chartData/chartLayout/format/env/switches/metaKeys/lastRun/log/progress/retry。
   - `collectors` — yahoo/ finnhub/ tdx/ billionsClient/Tools f10 collector webCollect webSearch mcp。
   - `agents-llm` — agents llm prompt reports toolLoop。
   - `app-lib-ui` — app/lib/* + App.tsx screens/ hooks/ metro.config.js + android 配置面。
   - `desktop-tools-ci` — desktop/* tools/* .github/workflows/* 根配置 + 密钥卫生扫描（git 跟踪文件内硬编码凭据）。
   - `tests-quality` — test/ 套件质量、断言强度、覆盖缺口（对照 src 导出面与新代码路径）、suite 并发脆弱性现状。
3. **第二波：对抗验证**（reviewer 子代理）：对第一波所有 major 及以上新发现逐条取证复核，判定 CONFIRMED / PARTIAL / REFUTED，套用 guides rubric。

## 子代理契约

每个 reviewer 提示以 `Active task: <task path>` 开头，并携带：

- **输出位置**：`.trellis/tasks/08-23-full-repo-review/research/<slice>.md`。
- **发现格式**：表格 — ID(域前缀) | 严重度(P0 立即/P1 高/P2 中/P3 polish) | 标题 | 证据(file:line+引文) | 影响 | 建议修法 | 置信度。
- **必含**：Verified-clean 抽检清单（防再 churn）；明确「未覆盖面」声明。
- **禁止**：改任何文件；上报上轮已 REFUTED/not-bug 条目（基线索引指向 findings_verified.md，agent 自行读取）；无证据的推测。
- **基线输入**：`.trellis/tasks/archive/2026-08/08-22-repo-review-remediation/findings_verified.md`（已知发现与 FP 模式）。

## 汇总

主会话合并 7 份域报告 → 对抗验证结论回填 → `research/00-review-report.md`（优先级排序替代原 P0/P1 共识的方法沿用上轮：先剔除 REFUTED，再按影响×触发面排 P1–P3）。

## 权衡

- 不用 lint/audit 工具替代人工审读（仓无 eslint 配置；npm audit 噪声大）→ 以类型检查 + 测试为客观基线，人工审读为主。
- verify-remediation 与域评审并行：两者输入独立（前者读归档基线，后者读源码），汇合点在汇总阶段。

## 回滚

纯增量工件（research/*.md），删除任务目录即回滚；产品代码零接触。
