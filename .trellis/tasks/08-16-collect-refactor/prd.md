# collect-refactor:采集层重构(P1 + D1)

## Target
`app/hooks/useAnalysis.ts`(import/采集分支/log import)、`app/lib/runner.ts:73-85`(freshness 门)、`src/tdx/deviceCollect.ts:60-82`(freshness 门)、`src/webCollect.ts`(collectForWeb 保持)、新 `src/collector.ts`。

## Change
按父 design.md「跨子契约 1 + 文件归属表」:deviceCollect 动态 import 化;MarketCollector 接口 + resolveSkipGates 共享;采集分支收敛;useAnalysis:40 log import 直连 src/log.ts。

## Acceptance
- web bundle 不含 node-tdx-market(父验证实证);RN 采集链路不变(模拟器真实分析回归门)
- resolveSkipGates 单测;collector 选择单测
- skip 验证/commit(父统一)
