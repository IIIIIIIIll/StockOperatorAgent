# 执行计划:整改(串行单元制)

> 前置:prd.md + design.md 已齐。用户裁决:**不做并行修复——每修一个问题:回归验证 + 独立提交,再进下一个**;提交前必过 trellis-check;**全量验证(含 Android/Web)由验证 subagent 执行,主会话不手工串行**。

## 单元序列(顺序执行,单元间硬门禁)

| # | 单元 | 改动文件 | 验证/门禁 |
|---|------|----------|-----------|
| U1 | C1 events 契约(不越过事件边界抛错) | src/events.ts, test/events.test.ts(+调用方核对) | ✅ 已完成(678b3c2 + ec0d9f2) |
| U2 | C2 runner 并发守卫 | src/events.ts(+test/runner.test.ts) | 矩阵 → commit |
| U3 | C3 store-idb close() flush | src/store-idb.ts(+调用方) | 矩阵 → commit |
| U4 | B1 Yahoo 链超时 | src/yahoo/**, app/lib/proxies.cjs(如需) | 矩阵(重点 yahoo/proxies) → commit |
| U5 | B2 残余 404-cookie 不对称 | src/yahoo/yahooClient.ts | 矩阵 → commit |
| U6 | B3 putStock 字段级合并 | src/yahoo/applyYahooCollectedToStore.ts | 矩阵 → commit |
| U7 | B4 prevCloseOf 单 bar 边 | src/yahoo/deviceYahooCollect.ts | 矩阵 → commit |
| U8 | E9 isYahooMarket 去重 | app/lib/proxies.cjs | 矩阵 → commit |
| U9 | A3 tag↔version CI 强制 | .github/workflows/release.yml | 走查 + 矩阵 → commit |
| U10 | A4 严格 base64 | tools/configure-android-signing.mjs | 走查 + 矩阵 → commit |
| U11 | A5 child.mjs 入参校验 | desktop/child.mjs | 走查 + 矩阵 → commit |
| U12 | A6 Host 头校验 | app/server.mjs | 矩阵 → commit |
| U13 | E1 useAnalysis 编排可测化+测试 | app/hooks/useAnalysis.ts(+控制器+新测试) | 矩阵(+Web 打包) → commit |
| U14 | D9 运行中不清错误横幅 | app/hooks/useAnalysis.ts | 矩阵(+Web 打包) → commit |
| U15 | D15 hasDone 状态暴露 | app/hooks/useAnalysis.ts | 矩阵(+Web 打包) → commit |
| U16 | D1+D4+D5 菜单几何(重测/clamp/maxWidth) | app/App.tsx | 矩阵 + Web 打包 → commit |
| U17 | D2-ghost web fade 穿透(animationType) | app/App.tsx | 矩阵 + Web 打包 → commit |
| U18 | D12 stopPropagation 清理 | app/App.tsx | 矩阵 + Web 打包 → commit |
| U19 | a11y#15 菜单 ARIA | app/App.tsx | 矩阵 + Web 打包 → commit |
| U20 | D6 SettingsPanel 卸载守卫+竞态 | app/screens/SettingsPanel.tsx | 矩阵 + Web 打包 → commit |
| U21 | D7 settings 文档修正 | app/lib/settings.ts | 走查 + 矩阵 → commit |
| U22 | D8 DataScreen 死字面量 | app/screens/DataScreen.tsx | 矩阵 + Web 打包 → commit |
| U23 | D13 稳定 key | app/screens/DataScreen.tsx, app/components/ReportContent.tsx | 矩阵 + Web 打包 → commit |
| U24 | D14 IndicatorChart resize | app/components/IndicatorChart*.tsx | 矩阵 + Web 打包 → commit |
| U25 | D11 Kotlin 通知权限请求 | app/modules/soa-keepalive/** | **矩阵 + Android gradle 编译** → commit |
| U26 | E2+E3 updateOverview/listStocks 测试 | test/*(新增) | 矩阵 → commit |
| U27 | E6 settings env 回落测试 | test/*(新增) | 矩阵 → commit |
| U28 | E11 demoLlm 兜底测试 + safe() 文档注 | test/*(新增), .trellis/spec(注) | 矩阵 → commit |
| U29 | E7 死导出删除(+store-gates.test.ts 同步) | src/committee.ts, src/gates.ts, src/switches.ts, test/store-gates.test.ts | 矩阵 → commit |
| U30 | E8 spec 漂移三处 | .trellis/spec/ts/hk-us-data.md, agents-tools.md, chart-ui.md | 走查 → commit |
| U31 | E10 lotSize 删除 | src/market.ts, test/market.test.ts | 矩阵 → commit |
| U32 | mock-LLM 套件 testTimeout 上调(防假失败) | test/ 配置/3 文件 | 矩阵 → commit |

顺序原则:核心风险优先(C1 已最先);同文件簇(U13-U15;U16-U19)按序排列避免同文件并发——**任何时刻只有一个单元在改**。

## 每单元门禁(硬规则)

1. 派发 `trellis-implement`(首行 `Active task: .trellis/tasks/08-22-repo-review-remediation`;读 implement.jsonl → prd → design → implement → 对应 findings 证据与 spec;**不 commit**)。
2. **派发 `trellis-check`**(用户裁决:提交前必过)——聚焦本单元 diff 的质量门:契约符合、测试有效性、调用方适配、架构断言、规范一致;发现问题 → 回修 → 复检。
3. **派发验证 subagent 跑全量矩阵**(主会话不手工串行):
   - 恒跑(串行):`npm test`(vitest)+ `npm run typecheck`(tsc --noEmit)。
   - 单元触及 `app/`(RN/Web 层)或 `app/modules/soa-keepalive/**` → 追加 **Android** `cd app/android && ./gradlew :app:compileDebugKotlin` + **Web** `npx expo export --platform web`(生成产物后清理,不入库)。
   - 单元触及 `src/` 纯 TS / 桌面 / 文档 → 基础两项;A 域(安全CI)单元追加 YAML/语法走查已含在 check 阶段。
   - **矩阵全绿才可提交**;验证 subagent 串行跑(并行会触发 5s 假超时,已实证)。
4. 全绿 → 提交(消息按 repo 惯例 `fix(scope): ...`,注明 findings ID);不绿 → 回修该单元(小修由整合人/派回原片)→ 重跑矩阵 → 再提交。
5. **最终整合门禁**:U1-U32 全部提交后,再跑一次完整矩阵(含 Android + Web 打包)作为收口。

## 集成收尾与质量门

- U1-U32 全部提交后:回填 findings_verified.md「关闭状态」列(U 编号 + commit);AC1-AC5 逐条勾选。
- `task.py validate`(jsonl 合法)——已通过。
- 规格更新(3.3):cross-platform-thinking-guide.md 平台差异清单追加 web fade 穿透件(U17 时顺带);error-handling.md 是否需要措辞澄清在 U1 时确定。
- `task.py archive` + `/trellis:finish-work`。
