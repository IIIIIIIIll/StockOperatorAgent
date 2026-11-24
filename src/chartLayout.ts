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

/**
 * 价签竖向去重叠(2026-11-22 决策价位 Tab)。
 *
 * 问题:报告价位按价格画 y 后会挤在一起(40.36 与 40.45 相差 0.09 元,在 300px
 * 高的图上不到 2px),文字标签必然叠成一团。
 *
 * 做法:输入按**自上而下**(y 升序)排好的理想 y,单向贪心下推 —— 每个标签至少
 * 比上一个低 minGap;整体超出底部时,把整串标签上推(excess),但首项不低于 0。
 * 不做双向均衡(那会让标签偏离对应价位线更多,更难读)。
 *
 * 返回与输入等长、同序的调整后 y;输入不排序(调用方负责升序)。
 */
export function stackLabelYs(targets: number[], minGap: number, height: number): number[] {
  const out = targets.slice();
  for (let i = 1; i < out.length; i++) {
    if (out[i] - out[i - 1] < minGap) out[i] = out[i - 1] + minGap;
  }
  if (!out.length || !(height > 0)) return out;
  // 底部溢出:整串上推,但顶项不得越过 0(标签多于图高时只能接受重叠)
  const excess = out[out.length - 1] - (height - minGap / 2);
  if (excess > 0) {
    const shift = Math.min(excess, Math.max(0, out[0]));
    for (let i = 0; i < out.length; i++) out[i] -= shift;
  }
  return out;
}
