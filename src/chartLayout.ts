// 图表面板顶 y 坐标公共计算(web 分支 pane 浮层标题定位)。
//
// 背景(2026-08-16 审计 D2):IndicatorChart / FinancialTrendChart 两个 web
// 图表组件各自手写同一 sumStretch/acc/tops 循环(同公式原 3 份,第三份在
// tools/build-chart-view.mts 内嵌 HTML 渲染器——HTML 侧因模板内嵌 vanilla JS
// 无法 import TS,保持镜像实现 + 注释互指)。
//
// 语义:与 lightweight-charts setStretchFactor 比例布局一致——每 pane 顶 =
// 其上方各 pane 高度贡献之和,单 pane 贡献 = (height × stretchFactor) /
// ΣstretchFactor(注:分母是 stretch 之和,height 为总图高)。
//
// 为什么不用 pane.getHeight():真实 lightweight-charts v5.2 在 createChart 后
// 立即读取返回未布局值(≈全高,2026-08-15 真机/Chromium 实测),会导致附图
// 标签全部堆到图表底部。

/** 单 pane 布局输入:总图高(px,与组件 CHART_HEIGHT 同值)+ stretch 比例因子。 */
export interface PaneStretch {
  height: number;
  stretchFactor: number;
}

/** 每 pane 顶 y 坐标(纯比例计算,与两组件被抽离前的内联公式逐字节等价)。 */
export function paneTops(panes: PaneStretch[]): number[] {
  const sumStretch = panes.reduce((a, b) => a + b.stretchFactor, 0);
  let acc = 0;
  const tops: number[] = [];
  for (const { height, stretchFactor: st } of panes) {
    tops.push(acc);
    acc += (height * st) / sumStretch;
  }
  return tops;
}
