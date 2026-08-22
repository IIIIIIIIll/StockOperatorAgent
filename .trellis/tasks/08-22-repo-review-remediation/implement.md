# 执行计划:整改(串行单元制)

> 前置:prd.md + design.md 已齐;用户裁决:**不做并行修复——每修一个问题:回归验证 + 独立提交,再进下一个**。

## 单元序列(顺序执行,单元间硬门禁)

| # | 单元 | 改动文件 | 验证/门禁 |
|---|------|----------|-----------|
| U1 | C1 events 契约(不越过事件边界抛错) | src/events.ts, test/events.test.ts(+调用方核对) | vitest + tsc → commit |
| U2 | C2 runner 并发守卫 | app/lib/runner.ts(+测试) | vitest + tsc → commit |
| U3 | C3 store-idb close() flush | src/store-idb.ts(+调用方) | vitest + tsc → commit |
| U4 | B1 Yahoo 链超时 | src/yahoo/**, app/lib/proxies.cjs(如需) | vitest + tsc(重点 yahoo/proxies 套件) → commit |
| U5 | B2 残余 404-cookie 不对称 | src/yahoo/yahooClient.ts | vitest → commit |
| U6 | B3 putStock 字段级合并 | src/yahoo/applyYahooCollectedToStore.ts | vitest → commit |
| U7 | B4 prevCloseOf 单 bar 边 | src/yahoo/deviceYahooCollect.ts | vitest → commit |
| U8 | E9 isYahooMarket 去重 | app/lib/proxies.cjs | vitest → commit |
| U9 | A3 tag↔version CI 强制 | .github/workflows/release.yml | YAML 走查 → commit |
| U10 | A4 严格 base64 | tools/configure-android-signing.mjs | 走查 → commit |
| U11 | A5 child.mjs 入参校验 | desktop/child.mjs | 走查 → commit |
| U12 | A6 Host 头校验 | app/server.mjs | 走查 → commit |
| U13 | E1 useAnalysis 编排可测化+测试 | app/hooks/useAnalysis.ts(+控制器+新测试) | vitest + tsc → commit |
| U14 | D9 运行中不清错误横幅 | app/hooks/useAnalysis.ts | vitest → commit |
| U15 | D15 hasDone 状态暴露 | app/hooks/useAnalysis.ts | vitest → commit |
| U16 | D1+D4+D5 菜单几何(重测/clamp/maxWidth) | app/App.tsx | vitest + tsc → commit |
| U17 | D2-ghost web fade 穿透(animationType) | app/App.tsx | vitest → commit |
| U18 | D12 stopPropagation 清理 | app/App.tsx | vitest → commit |
| U19 | a11y#15 菜单 ARIA | app/App.tsx | vitest → commit |
| U20 | D6 SettingsPanel 卸载守卫+竞态 | app/screens/SettingsPanel.tsx | vitest → commit |
| U21 | D7 settings 文档修正 | app/lib/settings.ts | 走查 → commit |
| U22 | D8 DataScreen 死字面量 | app/screens/DataScreen.tsx | vitest → commit |
| U23 | D13 稳定 key | app/screens/DataScreen.tsx, app/components/ReportContent.tsx | vitest → commit |
| U24 | D14 IndicatorChart resize | app/components/IndicatorChart*.tsx | vitest + tsc → commit |
| U25 | D11 Kotlin 通知权限请求 | app/modules/soa-keepalive/** | 走查(无 TS 测试面)→ commit |
| U26 | E2+E3 updateOverview/listStocks 测试 | test/*(新增) | vitest → commit |
| U27 | E6 settings env 回落测试 | test/*(新增) | vitest → commit |
| U28 | E11 demoLlm 兜底测试 + safe() 文档注 | test/*(新增), .trellis/spec(注) | vitest → commit |
| U29 | E7 死导出删除(+store-gates.test.ts 同步) | src/committee.ts, src/gates.ts, src/switches.ts, test/store-gates.test.ts | vitest + tsc → commit |
| U30 | E8 spec 漂移三处 | .trellis/spec/ts/hk-us-data.md, agents-tools.md, chart-ui.md | 走查 → commit |
| U31 | E10 lotSize 删除 | src/market.ts, test/market.test.ts | vitest → commit |
| U32 | mock-LLM 套件 testTimeout 上调(防假失败) | test/ 配置/3 文件 | vitest → commit |

顺序原则:核心风险优先(C1 最先、独立 commit);同文件簇(U13-U15;U16-U19)按序排列避免同文件并发——**任何时刻只有一个单元在改**。

## 每单元门禁(硬规则)

1. 派发 `trellis-implement`(首行 `Active task: .trellis/tasks/08-22-repo-review-remediation`;读 implement.jsonl → prd → design → implement → 对应 findings 证据与 spec;**不 commit**)。
2. 主会话**串行**跑 `npx vitest run` + `npx tsc --noEmit`(全量回归)。
3. 全绿 → 提交(消息按 repo 惯例 `fix(scope): ...`,注明 findings ID);不绿 → 回修该单元(小修由整合人/派回原片)→ 重跑 → 再提交。

## 集成收尾与质量门

- U1-U32 全部提交后:回填 findings_verified.md「关闭状态」列(U 编号 + commit);AC1-AC5 逐条勾选。
- `task.py validate`(jsonl 合法)——已通过。
- 规格更新(3.3):cross-platform-thinking-guide.md 平台差异清单追加 web fade 穿透件(U17 时顺带);error-handling.md 是否需要措辞澄清在 U1 时确定。
- `task.py archive` + `/trellis:finish-work`。
