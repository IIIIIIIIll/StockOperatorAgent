# PRD: Full Repository Review (2026-08-23)

## Background

- 两轮前置评审已完成并归档：`08-13-full-codebase-review`（发现）→ `08-22-repo-review-remediation`（33 个发现单元整改闭环，findings_verified.md 为复核基线，~27 条 CONFIRMED）。
- 用户要求在当前 HEAD 做一次**全仓重新评审**。

## Goal

对整个代码仓做独立的全面评审，产出三类经过验证的结论：

1. **整改落地核验** — 上轮全部 CONFIRMED 发现在 HEAD 的状态（已修 / 未修 / 回归）。
2. **新发现** — 所有模块的全新问题（正确性、并发、数据完整性、安全、测试缺口、规范漂移）。
3. **回归基线** — 当前 `npm test` 与 `npm run typecheck` 的实证结果。

## Scope

**In**: `src/`（含 yahoo/ finnhub/ tdx/）、`app/lib/`、`app/` UI 层（App.tsx screens/ hooks/ metro.config.js）、`desktop/`、`tools/`、`test/` 质量与覆盖缺口、`.github/workflows/`、根配置（package.json tsconfig vitest）、git 跟踪文件内的密钥卫生。

**Out**: 数据产物（database/ logs/ probe-output/ 二进制发布物）、node_modules、`.trellis/` 内部实现（仅允许指出 spec 与代码漂移）。

## Constraints

- 只读评审：本任务不改任何产品代码；修复走后续任务。
- 每条发现必须带 file:line + 引文证据，按 `.trellis/spec/guides/index.md` 验证 rubric 过滤已知 FP 模式（信任边界混淆 / 忽略设计注释 / 变量误读）。
- 不重复上报上轮已 REFUTED / investigated-not-bug 的条目（见 findings_verified.md）。

## Acceptance Criteria

- AC1: 上轮每条 CONFIRMED 发现均有 HEAD 状态判定（fixed / not-fixed / regressed），附证据锚点。
- AC2: 新发现按域落盘到 `research/<slice>.md`，含严重度、证据、影响、建议修法；major 及以上经第二波对抗验证。
- AC3: 测试与类型检查基线结果记录在案（串行运行）。
- AC4: 汇总报告 `research/00-review-report.md`，含优先级排序（P0–P3）与统计。
- AC5: 评审工件提交入库，不改动 src/app/desktop/test 产品代码。

## Baseline Facts（规划期已核实）

- 敏感文件未被 git 跟踪：release.keystore / .env / *.apk|aab|exe / logs/ / database/ 仅 `database/DUMMY` 占位被跟踪。
- HEAD: e4d8680；git ls-files 中 src+app+test+desktop+tools 共 167 文件。
