# Implement: Review Remediation

> 已并入 plan-audit.md 的 6 项设计调整；各单元指令以本文件 + plan-audit.md 为准。

## 执行顺序

1. [ ] Wave A（3 个 trellis-implement 并行）：
   - **存储组 F1+F2**: hydrate 逐文件 try/catch 跳坏文件+logError；原子写 store-node 层 tmp+rename（单测落此层），expo 后端 `moveSync` 必带 `{overwrite:true}` 并扩写 `src/expo-file-system.d.ts` 镜像签名，tmp 后缀避免 `.json` 结尾；F2 锁置于 mkdir/spawn 之前（main.mjs:286-288 前），mainWindow 引用提模块级供 second-instance 聚焦；桌面无 vitest——F2 验收为手动双开记录写入任务 notes。
   - **采集组 C2+C6+C3**: fetchWithTimeout 已导出直接复用，但其错误文案硬编码「Yahoo 请求超时」——加 label 参数或调用方归一；webSearch 四处出网（:45/:143/:157/:174）每请求 20s（非全链），proxySearcher 不加超时是正确的勿改；**C3 采用审计方案 B′**：导出 `getCachedA3()/invalidateA3Cache()` 对、采集函数可选第三参传 getter、删除预取注入——三处 `()=>a3` 值闭包捕获旧值，仅加失效钩子无效；hk-us-data.md 相应段落同步。
   - **编排组 AL2+D15**: AL2 放弃「执行收尾轮工具」（破坏有界 +1 契约），toolLoop 层占位兜底 + 两态文案 + trim 归一，合规路径（tool-loop.test.ts:106-119）不得破坏；D15 需在 analysisController restore 路径**新增** hasDone 置位点（现仅 :162/:290/:451/:455 有写点），App.tsx 门改为整体门（progressBar 外层 :375 一并）防空横条。
2. [ ] 主会话核验 A 波 diff 与定向测试；解决 test/ 归属冲突（各组新测试尽量新建文件）。
3. [ ] Wave B（2 个并行）：TQ1 注入缝正向用例（collectCalls 记录器模式，test/analysis-controller.test.ts 现有风格）/ TQ2 validators 抽取为纯 TS 模块放 `src/`（child.mjs 有 strip-types import .ts 先例 :36；顶层 argv 门导致不可直接 import，抽取必选，「副本导入」方案已否决）真值表测试。
4. [ ] Wave C（1 个）：CI workflow（push 必须 `branches:[master]` 过滤防 v* tag 与 release.yml 双跑）+ 漂移清理（4 条注释失真：deviceYahooCollect.ts:8-9、proxies.cjs:315-316、probe.mts:152-153、yahooClient.ts:67-69；2 份 spec：chart-ui.md §UI 编排、investment-committee.md paths/入口；顺带 proxies.cjs:86 CORS 失真注释）+ 死导出删除（runner.ts configError、settings.ts proxyUsed）。
5. [ ] 全量验证：npm test 全绿 + tsc --noEmit 零错误。
6. [ ] trellis-check agent 复核。
7. [ ] 分组 commit → finish-work。

## 验证命令

```bash
npm test && npm run typecheck
python3 ./.trellis/scripts/task.py validate 08-23-review-remediation
```

## 评审门

- A 波完成判据：8 条 P1/P2 各有对应 diff + 钉行为的回归测试（F2 除外，手动记录）。
- 最终门：AC1–AC8 逐条满足；评审报告 P1/P2 清单逐项标记已修。

## 回滚点

Wave 间均可按单元 revert；F1 原子写若 expo 后端 API 受限，降级为仅 Node 侧原子 + expo 侧容错 hydrate，记录取舍。
