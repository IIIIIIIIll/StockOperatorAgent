# Design: 窄屏主图图例改文档流内换行块

## 决策

| 方案 | 结论 |
|------|------|
| 浮层 flexWrap 换行 | 否决——遮挡 K 线(Session 46 已评估) |
| 窄屏精简 chips(去 EMA) | 否决——信息缺失,图上仍画 EMA 线 |
| 缩小字号/gap 硬塞 | 否决——9 chips ≈ 470px,375px 塞不下 |
| **窄屏文档流内块(本方案)** | 采用——零遮挡、信息完整、仅窄屏生效 |

## 布局与判定

- 阈值:560px(9 chips + 标题 + gap ≈ 470px;留字体度量余量;手机竖屏
  ≤480dp 全覆盖)。React 分支用 `useWindowDimensions().width`;WebView 分支用
  `window.innerWidth`。
- 窄屏:主图图例渲染为图表容器上方的 in-flow 块(`flexWrap: wrap`),浮层只保留
  pane 1..n;i === 0 时跳过浮层。
- 宽屏:完全走原路径,零 diff。
- paneTops 浮层定位不变(相对图表容器,与 in-flow 块无关)。

## 改动点

1. `app/components/IndicatorChart.tsx`(web 分支):新增窄屏块渲染 + 浮层跳过
   主图;新增样式(块内复用 paneLabelTitle/Chip/Dot/Text)。
2. `tools/build-chart-view.mts`(WebView 分支):JS 构建 pane label 时,窄屏下
   主图(pane 0)label 改插到 #chart-wrap 之前(in-flow,加 `.inline` class
   覆盖 absolute + 允许换行);重新生成 `app/lib/chartHtml.ts`。
3. CSS:`@media` 不适用(需 JS 判定),用 `.pane-label.inline { position:
   static; max-width: none; flex-wrap: wrap; }`。

## 一致性

- `npm run chart:build` 重新生成 chartHtml.ts → `npm run chart:check` 校验严格
  基准。
- 无数据契约变化;无测试改动需求(纯布局;行为经浏览器验证)。
