# PRD: 移动端窄屏 pane 图例截断修复

## 背景

Session 46(08-21)遗留:窄屏(375px 实测)下 K 线图主图 pane 浮层图例被挤压截断
(如 EMA20 → EMA2)。根因:主图图例 = 标题「主图」+ 9 个 chips(MA5/10/20/60、
EMA5/10/20/60、BOLL),单行所需宽度 ≈ 470px,而窄屏可用宽度 < 400px;浮层为
`flexDirection: row` 不换行,文字被截断。简单换行(flexWrap)会遮挡 K 线
(Session 46 已评估并否决)。

## 目标

窄屏(宽度 < 560px)下主图图例完整显示、不遮挡 K 线;其余 pane(≤3 chips)保持
浮层不变。宽屏(≥560px)视觉零变化。web React 分支与 RN WebView 分支
(chartHtml)行为一致。

## 方案(设计摘要)

窄屏下把主图图例从浮层改为图表容器上方**文档流内换行块**(可换行,不遮挡);
宽屏保持现状。宽度经 useWindowDimensions(window.innerWidth)判断,阈值 560px。

## 验收标准

1. 375px 视口:主图图例完整显示 9 个 label(含 EMA20/EMA60/BOLL),无截断;图例
   位于图表上方,不遮挡 K 线;其余 pane 浮层图例正常。
2. ≥560px 视口(桌面):渲染与改动前一致(浮层叠加在 pane 顶部)。
3. RN WebView 分支(chartHtml.ts)同规则生效;`npm run chart:check` 通过。
4. typecheck 干净;现有测试全绿。
