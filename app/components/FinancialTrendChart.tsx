// 财务跨期趋势图(web-only;lightweight-charts 动态 import)。
// 净利润/销售毛利率/每股收益各自一 pane(单位不同不混轴——对齐 Python
// financial_charts dataviz 单轴原则);数据由 DataScreen 的
// financialTrendSeries 纯函数准备(performance_reports + F10 盈利能力节,
// N/A 期已跳过)。空 series → 不渲染(空数据不崩)。
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { IChartApi } from 'lightweight-charts';
import type { FinancialSeries } from '../../src/chartData.ts';
import { CHART_HTML } from '../lib/chartHtml';
import type { Theme } from '../theme';

// 原生分支(WebView)JSON 数据契约:与 tools/build-chart-view.mts 头部文档一致
// (财务 3 pane 折线,stretch 等比例;图例单行 chips)。
interface NativeTrendData {
  height: number;
  layout: { background: string; text: string; border: string };
  legend: Array<{ series: Array<{ label: string; color: string }> }>;
  panes: Array<{
    stretch: number;
    series: Array<{ type: 'line'; title: string; color: string; lineStyle: 0; data: Array<{ time: string; value: number }> }>;
  }>;
}

// 每 pane 等比例;stretch 布局(禁 setHeight,与 IndicatorChart 同约定)
const PANE_STRETCH = [100, 100, 100];
const CHART_HEIGHT = PANE_STRETCH.reduce((a, b) => a + b, 0);

export default function FinancialTrendChart({ series, theme }: { series: FinancialSeries[]; theme: Theme }) {
  const ref = React.useRef<View | null>(null);
  // 各 pane 顶 y 坐标(web 分支浮层标题定位;stretch 后按实际高度累积)
  const [paneTops, setPaneTops] = React.useState<number[]>([]);
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
      // 面板顶位置:stretch 后取各 pane 实际高度累积(pane 数 == series 数)
      let acc = 0;
      const tops: number[] = [];
      for (const p of chart.panes()) {
        tops.push(acc);
        acc += p.getHeight();
      }
      setPaneTops(tops);
    });
    return () => { disposed = true; chart?.remove(); };
  }, [series, theme]);

  // ─── 原生分支:WebView 渲染同一数据(web 分支保持原样)─────────────────────
  const nativeData = React.useMemo<NativeTrendData | null>(() => {
    if (Platform.OS === 'web') return null;
    return {
      height: CHART_HEIGHT,
      layout: { background: theme.colors.background, text: theme.colors.textSecondary, border: theme.colors.border },
      legend: [{ series: series.map((s) => ({ label: s.label, color: s.color })) }],
      panes: series.map((s, i) => ({
        stretch: PANE_STRETCH[i] ?? 100,
        series: [{ type: 'line', title: s.label, color: s.color, lineStyle: 0, data: s.points }],
      })),
    };
  }, [series, theme]);
  const webviewRef = React.useRef<WebView | null>(null);
  const loadedRef = React.useRef(false);
  const nativeJson = React.useMemo(
    () => (Platform.OS === 'web' ? '' : JSON.stringify(nativeData)),
    [nativeData],
  );
  const injectData = React.useCallback(() => {
    if (!nativeJson) return;
    webviewRef.current?.injectJavaScript(`window.__SOA_CHART_DATA__=${nativeJson};window.renderChart&&window.renderChart();`);
  }, [nativeJson]);
  React.useEffect(() => {
    if (Platform.OS !== 'web' && loadedRef.current) injectData();
  }, [injectData]);

  if (series.length === 0) return null;

  if (Platform.OS !== 'web') {
    // 原生:WebView 渲染生成的 chart-view.html(财务 3 pane,图例在页内)
    return (
      <View style={{ backgroundColor: theme.colors.background }}>
        <WebView
          ref={webviewRef}
          source={{ html: CHART_HTML }}
          onLoadEnd={() => { loadedRef.current = true; injectData(); }}
          style={{ height: CHART_HEIGHT, width: '100%', backgroundColor: theme.colors.background }}
          javaScriptEnabled
          domStorageEnabled
        />
      </View>
    );
  }

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
      {/* web 下 ref 挂到 div(View 渲染为 div);浮层标题叠加在各 pane 顶部 */}
      <View style={{ position: 'relative', width: '100%' }}>
        <View ref={ref as never} style={{ height: CHART_HEIGHT, width: '100%' }} />
        {paneTops.map((top, i) => (series[i] ? (
          <View key={series[i].label} pointerEvents="none" style={[styles.paneLabel, { top }]}>
            <Text style={styles.paneLabelTitle}>{series[i].label}</Text>
          </View>
        ) : null))}
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    legendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 2 },
    legendChip: { flexDirection: 'row', alignItems: 'center', marginRight: 10, marginBottom: 2 },
    legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 3 },
    legendLabel: { fontSize: 10, color: theme.colors.textSecondary },
    // 浮层标题:绝对定位叠加在各 pane 顶部(pointerEvents none,不挡缩放/十字线)
    paneLabel: { position: 'absolute', left: 8, flexDirection: 'row', alignItems: 'center', gap: 6, zIndex: 10, maxWidth: '85%' },
    paneLabelTitle: { fontWeight: '700', fontSize: 11, color: theme.colors.textSecondary },
  });
}
