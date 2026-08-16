// 图表面板顶 y 坐标公共函数测试(08-16-chart-maintainability D2):
// 取两组件现有 PANE_STRETCH / CHART_HEIGHT 值,断言 paneTops 输出与
// 被抽离前的组件内联公式(逐 pane 累加 (CHART_HEIGHT×st)/Σstretch)一致。
import { describe, expect, it } from 'vitest';
import { paneTops } from '../src/chartLayout.ts';

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
