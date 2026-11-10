// 财务跨期趋势图(web-only;lightweight-charts 动态 import)。
// 净利润/销售毛利率/每股收益各自一 pane(单位不同不混轴——对齐 Python
// financial_charts dataviz 单轴原则);数据由 DataScreen 的
// financialTrendSeries 纯函数准备(performance_reports + F10 盈利能力节,
// N/A 期已跳过)。空 series → 不渲染(空数据不崩)。
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { FinancialSeries } from '../../src/chartData.ts';
import { paneTops as computePaneTops } from '../../src/chartLayout.ts';
import { ChartWebView, useChartWebView } from '../hooks/useChartWebView';
import type { Theme } from '../theme';
import { warn } from '../../src/log.ts';

// 原生分支(WebView)JSON 数据契约:与 tools/build-chart-view.mts 头部文档一致
// (财务 3 pane 折线,stretch 等比例;图例单行 chips)。
interface NativeTrendData {
  height: number;
  layout: { background: string; text: string; border: string };
  legend: Array<{ series: Array<{ label: string; color: string }> }>;
  panes: Array<{
    stretch: number;
    series: Array<{ type: 'line' | 'histogram'; title: string; color: string; lineStyle?: 0; data: Array<{ time: string; value: number }> }>;
  }>;
}

// 每 pane 等比例;stretch 布局(禁 setHeight,与 IndicatorChart 同约定)
const PANE_STRETCH = [100, 100, 100];
const CHART_HEIGHT = PANE_STRETCH.reduce((a, b) => a + b, 0);

/** 已建好的 web 图句柄:建图 effect 产出(每指标一 pane,数组下标即 pane),数据 effect 消费。 */
interface TrendChartHandle {
  chart: IChartApi;
  bars: Array<ISeriesApi<'Histogram'>>;
}

export default function FinancialTrendChart({ series, theme }: { series: FinancialSeries[]; theme: Theme }) {
  const ref = React.useRef<View | null>(null);
  // 各 pane 顶 y 坐标(web 分支浮层标题定位;stretch 后按实际高度累积)
  const [paneTops, setPaneTops] = React.useState<number[]>([]);
  // P3(评审 2026-11-09):theme 是模块常量,别每次渲染都重建样式表
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  // 引导失败态(评审 2026-11-09 P2):动态 chunk 加载失败 / createChart 抛错此前
  // 完全静默 → 永久空白且无文案。与 IndicatorChart 同款降级。
  const [chartFailed, setChartFailed] = React.useState(false);

  // 建图句柄 + 完成门(§8「建一次 + 更新」拆分,与 IndicatorChart 同款)。
  // 旧实现把 createChart + addSeries + setData 塞进同一 effect(依赖含 series):
  // 每次业绩数据变一次就整块重建 chart,数据页闪一下。拆成建图(依赖 theme 与
  // series 条数)与灌数(依赖 series 内容)两个 effect。
  const handleRef = React.useRef<TrendChartHandle | null>(null);
  const [chartReady, setChartReady] = React.useState(false);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current || series.length === 0) return undefined;
    // SAFETY: 仅在 Platform.OS==='web' 分支执行,RNW 把 View 渲染成 DOM 节点,
    // 所以 ref.current 确实是 HTMLElement;RN 的类型面里没有 DOM 类型,只能强转。
    const el = ref.current as unknown as HTMLElement;
    let disposed = false;
    let chart: IChartApi | null = null;
    void import('lightweight-charts').then(({ createChart, ColorType, HistogramSeries }) => {
      if (disposed || !el) return;
      try {
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
        // 每指标一 pane(独立价格轴,单位不混);series 顺序即 pane 顺序。
        // 柱状图(用户 2026-08-15 反馈:折线 9 期太短奇怪,改柱状,base=0 便于比高低)
        const bars = series.map((s, i) => chart!.addSeries(HistogramSeries, { color: s.color }, i));
        chart.panes().forEach((p, i) => p.setStretchFactor(PANE_STRETCH[i] ?? 100));
        // 面板顶位置:纯比例计算(实现与 IndicatorChart 共用 src/chartLayout.ts
        // paneTops——pane.getHeight() 在 createChart 后立即读取返回未布局值,
        // 2026-08-15 实测)
        // S4-1(评审 2026-11-08):只给「真实存在的 pane」算坐标。旧实现用满三档
        // (series 只有 2 条时就多算一个 pane),浮层标题会比实际 pane 高 ~36px、
        // 落在上一个 pane 里。
        setPaneTops(
          computePaneTops(
            PANE_STRETCH.slice(0, series.length).map((stretchFactor) => ({
              height: CHART_HEIGHT,
              stretchFactor,
            })),
          ),
        );
        handleRef.current = { chart, bars };
        setChartFailed(false);
        setChartReady(true);
      } catch (err) {
        // 建图抛错(createChart 失败 / series 选项被拒)
        setChartFailed(true);
        handleRef.current = null;
        chart?.remove();
        chart = null;
        warn(`业绩趋势图渲染失败:${err instanceof Error ? err.message : String(err)}`);
      }
    }).catch((err: unknown) => {
      if (disposed) return;
      setChartFailed(true);
      warn(`业绩趋势图模块加载失败:${err instanceof Error ? err.message : String(err)}`);
    });
    return () => {
      disposed = true;
      handleRef.current = null;
      setChartReady(false);
      chart?.remove();
    };
    // 条数变化必须重建(每指标一 pane,series 数量即 pane 数量)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, series.length]);

  // 灌数:只重灌 series,不重建 chart。稀疏季度轴(9 期)fitContent 铺满,
  // 避免柱群挤在时间轴一侧(2026-08-15),每次灌数后重新贴合。
  React.useEffect(() => {
    if (!chartReady) return;
    const h = handleRef.current;
    if (!h) return;
    try {
      series.forEach((s, i) => h.bars[i]?.setData(s.points));
      h.chart.timeScale().fitContent();
      setChartFailed(false);
    } catch (err) {
      // setData 拒收(如 time 非 YYYY-MM-DD):移除坏图 + 文案,不留永久空白。
      // 不自动重建 —— 数据持续非法时会 建图→抛→重建 死循环。
      setChartFailed(true);
      handleRef.current = null;
      setChartReady(false);
      h.chart.remove();
      warn(`业绩趋势图数据更新失败:${err instanceof Error ? err.message : String(err)}`);
    }
  }, [series, chartReady]);

  // ─── 原生分支:WebView 渲染同一数据(web 分支保持原样)─────────────────────
  const nativeData = React.useMemo<NativeTrendData | null>(() => {
    if (Platform.OS === 'web') return null;
    return {
      height: CHART_HEIGHT,
      layout: { background: theme.colors.background, text: theme.colors.textSecondary, border: theme.colors.border },
      legend: [{ series: series.map((s) => ({ label: s.label, color: s.color })) }],
      panes: series.map((s, i) => ({
        stretch: PANE_STRETCH[i] ?? 100,
        series: [{ type: 'histogram', title: s.label, color: s.color, data: s.points }],
      })),
    };
  }, [series, theme]);
  const nativeJson = React.useMemo(
    () => (Platform.OS === 'web' ? '' : JSON.stringify(nativeData)),
    [nativeData],
  );
  // WebView 生命周期集中在 app/hooks/useChartWebView.ts(与 IndicatorChart 同语义):
  // 稳定 source / 渲染进程死亡后重挂 / 后台不注入。
  const chart = useChartWebView(nativeJson);

  if (series.length === 0) return null;

  if (Platform.OS !== 'web') {
    // 原生:WebView 渲染生成的 chart-view.html(财务 3 pane,图例在页内)
    return (
      <View style={{ backgroundColor: theme.colors.background }}>
        <ChartWebView
          key={chart.key}
          ref={chart.ref}
          source={chart.source}
          onLoadEnd={chart.onLoadEnd}
          onRenderProcessGone={chart.onRenderProcessGone}
          style={{ height: CHART_HEIGHT, width: '100%', backgroundColor: theme.colors.background }}
          javaScriptEnabled
          domStorageEnabled
        />
      </View>
    );
  }

  return (
    <View>
      {/* 图例随各 pane(浮层叠加在各自 pane 顶部,见下方 paneLabels)——
         不再集中渲染顶部大图例块(用户 2026-08-15 反馈:图例应跟随各自图) */}
      <View style={{ position: 'relative', width: '100%' }}>
        <View ref={ref as never} style={{ height: CHART_HEIGHT, width: '100%' }} />
        {chartFailed ? (
          <View pointerEvents="none" style={styles.failedOverlay}>
            <Text style={styles.failedText}>业绩趋势图渲染失败:图表引擎未就绪或数据日期格式不合法,可切到表格查看同源数值。</Text>
          </View>
        ) : null}
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
    // 浮层标题:绝对定位叠加在各 pane 顶部(pointerEvents none,不挡缩放/十字线)
    paneLabel: { position: 'absolute', left: 8, flexDirection: 'row', alignItems: 'center', gap: 6, zIndex: 10, maxWidth: '85%' },
    paneLabelTitle: { fontWeight: '700', fontSize: 11, color: theme.colors.textSecondary },
    failedOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    failedText: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  });
}
