// 财务跨期趋势图(web-only;lightweight-charts 动态 import)。
// 净利润/销售毛利率/每股收益各自一 pane(单位不同不混轴——对齐 Python
// financial_charts dataviz 单轴原则);数据由 DataScreen 的
// financialTrendSeries 纯函数准备(performance_reports + F10 盈利能力节,
// N/A 期已跳过)。空 series → 不渲染(空数据不崩)。
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { IChartApi } from 'lightweight-charts';
import type { FinancialSeries } from '../../src/chartData.ts';
import type { Theme } from '../theme';

// 每 pane 等比例;stretch 布局(禁 setHeight,与 IndicatorChart 同约定)
const PANE_STRETCH = [100, 100, 100];
const CHART_HEIGHT = PANE_STRETCH.reduce((a, b) => a + b, 0);

export default function FinancialTrendChart({ series, theme }: { series: FinancialSeries[]; theme: Theme }) {
  const ref = React.useRef<View | null>(null);
  const styles = makeStyles(theme);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current || series.length === 0) return undefined;
    const el = ref.current as unknown as HTMLElement;
    let disposed = false;
    let chart: IChartApi | null = null;
    void import('lightweight-charts').then(({ createChart, ColorType, LineSeries }) => {
      if (disposed || !el) return;
      chart = createChart(el, {
        height: CHART_HEIGHT,
        layout: {
          background: { type: ColorType.Solid, color: theme.colors.background },
          textColor: theme.colors.textSecondary,
        },
        grid: {
          vertLines: { color: theme.colors.border },
          horzLines: { color: theme.colors.border },
        },
        timeScale: { borderColor: theme.colors.border },
        rightPriceScale: { borderColor: theme.colors.border },
      });
      // 每指标一 pane(独立价格轴,单位不混);series 顺序即 pane 顺序
      series.forEach((s, i) => {
        const line = chart!.addSeries(LineSeries, { color: s.color, lineWidth: 2 }, i);
        line.setData(s.points);
      });
      chart.panes().forEach((p, i) => p.setStretchFactor(PANE_STRETCH[i] ?? 100));
    });
    return () => { disposed = true; chart?.remove(); };
  }, [series, theme]);

  if (series.length === 0) return null;

  return (
    <View>
      {/* 图例:系列标签与图上线条同源(series 单点定义 label/color) */}
      <View style={styles.legendRow}>
        {series.map((s) => (
          <View key={s.label} style={styles.legendChip}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={styles.legendLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
      <View ref={ref as never} style={{ height: CHART_HEIGHT, width: '100%' }} />
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    legendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 2 },
    legendChip: { flexDirection: 'row', alignItems: 'center', marginRight: 10, marginBottom: 2 },
    legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 3 },
    legendLabel: { fontSize: 10, color: theme.colors.textSecondary },
  });
}
