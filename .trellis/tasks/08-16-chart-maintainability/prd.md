# chart-maintainability:图表维护性(D2/D4/D5)

## Target
新 `src/chartLayout.ts`(paneTops 公共函数)、`app/components/IndicatorChart.tsx:217-224`、`app/components/FinancialTrendChart.tsx:67-74`、`app/package.json`(chart:build/chart:check script)、`tools/build-chart-view.mts`(fallback 注释)。

## Change
按父 design.md:web 两组件 tops 计算抽公共纯函数(HTML 侧保持镜像注释);package.json 加生成与一致性校验 script(chart:build 重跑生成、chart:check 重生成后 diff 现有产物,静默通过/失败);模板 fallback 注释标注「与 theme.ts light 对齐」。

## Acceptance
- paneTops 单测;两组件行为不变(app tsc)
- chart:check 可执行且当前通过(生成物与源一致)
- skip 验证/commit(父统一)
