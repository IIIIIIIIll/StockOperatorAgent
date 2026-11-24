// 图表面板顶 y 坐标公共函数测试(08-16-chart-maintainability D2):
// 取两组件现有 PANE_STRETCH / CHART_HEIGHT 值,断言 paneTops 输出与
// 被抽离前的组件内联公式(逐 pane 累加 (CHART_HEIGHT×st)/Σstretch)一致。
import { describe, expect, it } from 'vitest';
import { paneTops, stackLabelYs } from '../src/chartLayout.ts';

/** 组件内联公式(抽离前):PANE_STRETCH 与 CHART_HEIGHT=Σstretch 时逐项输出。 */
function inlineTops(stretches: number[], height: number): number[] {
  const sumStretch = stretches.reduce((a, b) => a + b, 0);
  let acc = 0;
  const tops: number[] = [];
  for (const st of stretches) {
    tops.push(acc);
    acc += (height * st) / sumStretch;
  }
  return tops;
}

describe('paneTops (web 两图表组件 pane 顶 y 公共计算)', () => {
  it('IndicatorChart 10 pane 比例 [300,90,70,90,90,90,90,70,70,70] 与现实现一致', () => {
    const stretches = [300, 90, 70, 90, 90, 90, 90, 70, 70, 70];
    const height = stretches.reduce((a, b) => a + b, 0); // 组件内 CHART_HEIGHT
    const panes = stretches.map((stretchFactor) => ({ height, stretchFactor }));
    expect(paneTops(panes)).toEqual([0, 300, 390, 460, 550, 640, 730, 820, 890, 960]);
    expect(paneTops(panes)).toEqual(inlineTops(stretches, height));
  });

  it('FinancialTrendChart 3 pane 等比例 [100,100,100] 与现实现一致', () => {
    const stretches = [100, 100, 100];
    const height = stretches.reduce((a, b) => a + b, 0);
    const panes = stretches.map((stretchFactor) => ({ height, stretchFactor }));
    expect(paneTops(panes)).toEqual([0, 100, 200]);
    expect(paneTops(panes)).toEqual(inlineTops(stretches, height));
  });

  it('总高 ≠ Σstretch 时按 (height×stretchFactor)/Σstretch 累积(通用公式锁定)', () => {
    // height=500、stretch [300,90,70]:Σstretch=460
    const panes = [
      { height: 500, stretchFactor: 300 },
      { height: 500, stretchFactor: 90 },
      { height: 500, stretchFactor: 70 },
    ];
    const tops = paneTops(panes);
    expect(tops[0]).toBe(0);
    expect(tops[1]).toBeCloseTo((500 * 300) / 460, 10);
    expect(tops[2]).toBeCloseTo((500 * 300 + 500 * 90) / 460, 10);
    expect(paneTops(panes)).toEqual(inlineTops([300, 90, 70], 500));
  });

  it('空 panes → 空数组;单 pane → [0](零除安全)', () => {
    expect(paneTops([])).toEqual([]);
    expect(paneTops([{ height: 300, stretchFactor: 100 }])).toEqual([0]);
  });
});

describe('stackLabelYs (决策价位 Tab 价签去重叠)', () => {
  it('间距均足够 → 原样返回(不动不该动的标签)', () => {
    expect(stackLabelYs([0, 40, 80], 15, 320)).toEqual([0, 40, 80]);
  });

  it('挤在一起的价格 → 逐个下推到 minGap', () => {
    // 42.64 与 42.44 在 320px 图上只差 2px —— 变成 15/30
    expect(stackLabelYs([100, 102, 104], 15, 320)).toEqual([100, 115, 130]);
  });

  it('底部溢出 → 整串上推,同时不越过顶部', () => {
    // 下推后 [300,315,400];末项 400 > 320-7.5 → 上推 87.5(首项 300 够减)
    expect(stackLabelYs([300, 302, 400], 15, 320)).toEqual([212.5, 227.5, 312.5]);
  });

  it('标签多到装不下 → 首项不越过 0(宁可重叠也不跑出画布)', () => {
    const ys = stackLabelYs(Array.from({ length: 30 }, (_, i) => i), 15, 100);
    expect(ys[0]).toBeGreaterThanOrEqual(0);
    expect(ys[29] - ys[28]).toBe(15);
  });

  it('空输入/高度未知 → 不抛错', () => {
    expect(stackLabelYs([], 15, 320)).toEqual([]);
    expect(stackLabelYs([10, 12], 15, 0)).toEqual([10, 25]);
  });
});
