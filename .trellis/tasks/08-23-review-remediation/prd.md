# PRD: Review Remediation (2026-08-23)

## Background

`08-23-full-repo-review` 全仓评审确认 P1×1、P2×7（全部对抗验证 CONFIRMED）及 33 条 P3。证据与锚点见 `.trellis/tasks/08-23-full-repo-review/research/00-review-report.md` 及各切片报告。

## Goal

修复全部 P1/P2 发现 + 高价值 P3（CI 门、漂移清理、死代码），恢复「测试全绿 + 类型干净」并补上回归防护。

## Scope

**In**（按评审报告 ID）：
- 存储：F1（hydrate 容错 + tmp+rename 原子写）、F2（requestSingleInstanceLock）
- 采集：C2（finnhub 接 fetchWithTimeout）、C6（webSearch 直连链超时）、C3（invalidateA3Cache 由 401 二次自愈路径调用）
- 编排：AL2（收尾轮 tool_calls 校验 + 空 content 兜底）、D15（App.tsx 消费 hasDone）
- 测试补齐：TQ1（us+finnhub 绑定正向用例）、TQ2（STORE_OP_VALIDATORS 真值表）、TQ5（live.integration 改结构性断言）
- 卫生：CI 测试门 workflow（push/PR 跑 vitest+tsc）；注释/spec 漂移族（deviceYahooCollect.ts:9、proxies.cjs:315、probe.mts:152、yahooClient.ts:67-69、chart-ui.md §UI 编排、investment-committee.md paths/入口）；死导出 configError/proxyUsed

**Out**（本轮不做，留 backlog）：Origin/CSRF 门、502 归因、设置面板文案、暗色板、electron 图标、android job 缓存、SHA pin、C4/C5、SC-1 close 门闩、「今天」单源收敛、zlib/punycode shim 测试、__soa 双采集守卫、≤8 字符掩码。

## Constraints

- 不改公共 API 形状；fetchWithTimeout 从 yahooClient 导出复用，零新依赖。
- C2/C6 修法禁用 AbortSignal.timeout（评审已证其在 Hermes 注释失真，统一走 yahooClient 手写模式保持一致）。
- F1 原子写需同时覆盖 store-node 与 expo 后端路径。
- 每个 P1/P2 修复必须带钉住行为的回归测试；现有 581 用例不得回归。

## Acceptance Criteria

- AC1: 构造截断 JSON 文件 → hydrate 跳过该文件 + logError，其余文件可用；写路径落盘为 tmp+rename。
- AC2: 二次启动聚焦已有窗口退出（单实例锁有测试或手动验证记录）。
- AC3: finnhub/webSearch 所有出网经超时包装；A3 吊销场景下二次 401 触发缓存失效并有测试。
- AC4: 收尾轮返回 tool_calls 或空 content 时产出占位结论而非空串，测试覆盖。
- AC5: 失败运行不再显示「✓ 分析完成」。
- AC6: TQ1/TQ2 新用例合入；live.integration 断言结构性化。
- AC7: CI workflow 在 push/PR 执行 npm ci && npm test && typecheck。
- AC8: `npm test` 全绿 + `tsc --noEmit` 零错误；漂移注释/spec 全部对齐 HEAD 行为。
