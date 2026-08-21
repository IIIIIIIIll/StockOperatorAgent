// 全指标多面板图(web-only;lightweight-charts v5 paneIndex)。
// 数据与「最新指标」chips 同源:DataScreen 的 computeAll 结果切片(rows 与
// bars 同长同序,窗口一致)。面板编排对齐通达信习惯 + Python
// get_trend_indicators 分组:主图(MA/EMA/BOLL 叠加)+ 成交量 + 全部振荡器。
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { IChartApi, LineStyle } from 'lightweight-charts';
import type { IndicatorRow } from '../../src/indicators.ts';
import { changePctHistData } from '../../src/chartData.ts';
import { paneTops as computePaneTops } from '../../src/chartLayout.ts';
import { fmtDate } from '../../src/format.ts';
import { CHART_HTML } from '../lib/chartHtml';
import type { Theme } from '../theme';

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── 系列颜色(单点定义:图例与图上线条共用,防漂移) ──────────────────────
const C = {
  amber: '#f59e0b',
  sky: '#38bdf8',
  purple: '#c084fc',
  gray: '#94a3b8',
  green: '#10b981',
  yellow: '#eab308',
} as const;

interface LegendSeries {
  label: string;
  color: string;
}

const LEGEND: Array<{ title: string; series: LegendSeries[] }> = [
  { title: '主图', series: [
    { label: 'MA5', color: C.amber }, { label: 'MA10', color: C.sky }, { label: 'MA20', color: C.purple }, { label: 'MA60', color: C.gray },
    { label: 'EMA5', color: C.amber }, { label: 'EMA10', color: C.sky }, { label: 'EMA20', color: C.purple }, { label: 'EMA60', color: C.gray },
    { label: 'BOLL', color: C.green },
  ] },
  { title: '成交量', series: [{ label: 'VOL_MA5', color: C.sky }] },
  { title: '涨跌幅', series: [{ label: '涨跌幅', color: C.green }] },
  { title: 'MACD', series: [
    { label: 'DIF', color: C.amber }, { label: 'DEA', color: C.sky }, { label: 'MACD 柱', color: C.amber },
  ] },
  { title: 'KDJ', series: [
    { label: 'K', color: C.amber }, { label: 'D', color: C.sky }, { label: 'J', color: C.purple },
  ] },
  { title: 'RSI', series: [
    { label: 'RSI6', color: C.amber }, { label: 'RSI12', color: C.sky }, { label: 'RSI24', color: C.purple },
  ] },
  { title: 'MACD-VH', series: [
    { label: 'MACD_V', color: C.amber }, { label: 'SIGNAL', color: C.sky }, { label: 'VH 柱', color: C.amber },
  ] },
  { title: 'ATR', series: [{ label: 'ATR', color: C.yellow }] },
  { title: '量比', series: [{ label: 'VOL_RATIO', color: C.sky }] },
  { title: '乖离率', series: [{ label: 'LIU_BIAS', color: C.purple }] },
];

// 面板比例(主图 + 成交量 + 涨跌幅 + 4 振荡器 + 3 单线):stretch 比例布局,与图高解耦。
// 用 setStretchFactor 而非 setHeight——Pane 初始 height=0,首帧布局前 setHeight
// 会以 totalHeight=0 计算导致高度错乱(v5 源码 _internal_changePanesHeight)。
const PANE_STRETCH = [300, 90, 70, 90, 90, 90, 90, 70, 70, 70];
const CHART_HEIGHT = PANE_STRETCH.reduce((a, b) => a + b, 0);

// ─── 原生分支(WebView)JSON 数据契约 ──────────────────────────────────────
// 形状与 tools/build-chart-view.mts 头部文档一致:通用多面板渲染器,
// candles 主图 + 各 pane 线/柱系列 + 图例;stretch 比例与 web 分支同源。
interface CandlePoint { time: string; open: number; high: number; low: number; close: number; volume: number }
interface ValuePoint { time: string; value: number }
interface HistPoint { time: string; value: number; color: string }
type NativeSeriesDef =
  | { type: 'candles'; title: string; upColor: string; downColor: string; data: CandlePoint[] }
  | { type: 'line'; title: string; color: string; lineStyle: 0 | 1 | 2; data: ValuePoint[] }
  | { type: 'histogram'; title: string; color: string; base: number; priceFormat?: 'volume'; data: HistPoint[] };
interface NativePaneDef { stretch: number; series: NativeSeriesDef[] }
interface NativeChartData {
  height: number;
  layout: { background: string; text: string; border: string };
  legend: typeof LEGEND;
  panes: NativePaneDef[];
}

/** 线数据:过滤 null/NaN(warmup 前导 NaN 只出现在序列头部,无中间断档) */
function lineData(rows: IndicatorRow[], dates: string[], key: string): Array<{ time: string; value: number }> {
  const out: Array<{ time: string; value: number }> = [];
  const n = Math.min(rows.length, dates.length);
  for (let i = 0; i < n; i++) {
    const v = rows[i][key];
    if (v !== null && v !== undefined && Number.isFinite(v)) out.push({ time: dates[i], value: v });
  }
  return out;
}

/** 柱数据:按正负着色(成交量按涨跌,在调用方给出 upColor/downColor 语义) */
function histData(
  rows: IndicatorRow[], dates: string[], key: string, upColor: string, downColor: string,
): Array<{ time: string; value: number; color: string }> {
  const out: Array<{ time: string; value: number; color: string }> = [];
  const n = Math.min(rows.length, dates.length);
  for (let i = 0; i < n; i++) {
    const v = rows[i][key];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    out.push({ time: dates[i], value: v, color: v >= 0 ? upColor : downColor });
  }
  return out;
}

/** #RRGGBB → rgba(...,alpha);柱半透明沿用原 volume 柱做法 */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export default function IndicatorChart({ bars, rows, changePct, theme }: { bars: Bar[]; rows: IndicatorRow[]; changePct: number[]; theme: Theme }) {
  const ref = React.useRef<View | null>(null);
  // 各 pane 顶 y 坐标(web 分支浮层标题定位;stretch 后按实际高度累积)
  const [paneTops, setPaneTops] = React.useState<number[]>([]);
  const styles = makeStyles(theme);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current) return undefined;
    const el = ref.current as unknown as HTMLElement;
    let disposed = false;
    let chart: IChartApi | null = null;
    // LineStyle 是运行时枚举(值),须从动态 import 解构取值;类型注释放
    // 顶层 import type(不把 lightweight-charts 拉进 RN 原生 bundle)
    void import('lightweight-charts').then(({ createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, LineStyle: LineStyleValue }) => {
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
        // 刻度区最小宽度:默认下价格标签紧贴 canvas 右缘(视觉拥挤/截断风险),
        // 给足宽度让标签舒展
        rightPriceScale: { borderColor: theme.colors.border, minimumWidth: 56 },
      });

      const dates = bars.map((b) => fmtDate(b.date));
      const line = (key: string, color: string, style?: LineStyle, pane = 0) => {
        const s = chart!.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: style ?? LineStyleValue.Solid }, pane);
        s.setData(lineData(rows, dates, key));
      };

      // pane 0 主图:蜡烛 + MA(实线) + EMA(虚线) + BOLL(点线)
      const candle = chart.addSeries(CandlestickSeries, {
        upColor: theme.colors.up,
        downColor: theme.colors.down,
        borderVisible: false,
        wickUpColor: theme.colors.up,
        wickDownColor: theme.colors.down,
      });
      candle.setData(bars.map((b) => ({
        time: fmtDate(b.date),
        open: b.open, high: b.high, low: b.low, close: b.close,
      })));
      for (const [k, color] of [['MA5', C.amber], ['MA10', C.sky], ['MA20', C.purple], ['MA60', C.gray]] as const) line(k, color);
      for (const [k, color] of [['EMA5', C.amber], ['EMA10', C.sky], ['EMA20', C.purple], ['EMA60', C.gray]] as const) line(k, color, LineStyleValue.Dashed);
      for (const [k, color] of [['BOLL_UP', C.green], ['BOLL_MB', C.green], ['BOLL_DN', C.green]] as const) line(k, color, LineStyleValue.Dotted);

      // pane 1 成交量:量柱(涨跌着色) + VOL_MA5
      const upA = hexToRgba(theme.colors.up, 0.4);
      const downA = hexToRgba(theme.colors.down, 0.4);
      const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, base: 0 }, 1);
      volume.setData(bars.map((b) => ({
        time: fmtDate(b.date),
        value: b.volume,
        color: b.close >= b.open ? upA : downA,
      })));
      line('VOL_MA5', C.sky, undefined, 1);

      // pane 2 涨跌幅柱:正红负绿、base 0(对齐 Python change_percent_chart)
      const changePctHist = chart.addSeries(HistogramSeries, { base: 0 }, 2);
      changePctHist.setData(changePctHistData(changePct, dates, upA, downA));

      // pane 3 MACD:DIF/DEA 线 + MACD 柱(0 轴上下着色)
      line('DIF', C.amber, undefined, 3);
      line('DEA', C.sky, undefined, 3);
      const macd = chart.addSeries(HistogramSeries, { base: 0 }, 3);
      macd.setData(histData(rows, dates, 'MACD', upA, downA));

      // pane 4 KDJ
      line('K', C.amber, undefined, 4);
      line('D', C.sky, undefined, 4);
      line('J', C.purple, undefined, 4);

      // pane 5 RSI
      line('RSI6', C.amber, undefined, 5);
      line('RSI12', C.sky, undefined, 5);
      line('RSI24', C.purple, undefined, 5);

      // pane 6 MACD-VH:MACD_V/SIGNAL 线 + VH 柱
      line('MACD_V', C.amber, undefined, 6);
      line('SIGNAL', C.sky, undefined, 6);
      const vh = chart.addSeries(HistogramSeries, { base: 0 }, 6);
      vh.setData(histData(rows, dates, 'MACD_VH', upA, downA));

      // pane 7-9 单线:ATR / 量比 / 乖离率
      line('ATR', C.yellow, undefined, 7);
      line('VOL_RATIO', C.sky, undefined, 8);
      line('LIU_BIAS', C.purple, undefined, 9);

      // 面板比例:全部 series 建完后设置 stretch(比例布局,与当前高度无关)
      chart.panes().forEach((p, i) => p.setStretchFactor(PANE_STRETCH[i] ?? 70));
      // 面板顶位置:纯比例计算(stretch/总和 × 总高,实现抽到 src/chartLayout.ts
      // paneTops 公共函数)——不用 pane.getHeight():真实 lightweight-charts v5.2
      // createChart 后立即读取返回未布局值(≈全高,2026-08-15 真机/Chromium 实测),
      // 会导致附图标签全部堆到图表底部。
      setPaneTops(computePaneTops(PANE_STRETCH.map((stretchFactor) => ({ height: CHART_HEIGHT, stretchFactor }))));
    });
    return () => { disposed = true; chart?.remove(); };
  }, [bars, rows, changePct, theme]);

  // ─── 原生分支:WebView 渲染同一数据(HTML 由 tools/build-chart-view.mts 生成)──
  // 序列化 web 分支同款数据(bars + lineData/histData 结果 + 颜色)→ JSON;
  // useMemo 稳定 JSON 引用,流式重渲染不重建 WebView(仅重注入数据)。
  const nativeData = React.useMemo<NativeChartData | null>(() => {
    if (Platform.OS === 'web') return null;
    const dates = bars.map((b) => fmtDate(b.date));
    const upA = hexToRgba(theme.colors.up, 0.4);
    const downA = hexToRgba(theme.colors.down, 0.4);
    const lineDef = (key: string, color: string, lineStyle: 0 | 1 | 2 = 0): NativeSeriesDef => ({
      type: 'line',
      title: key,
      color,
      lineStyle,
      data: lineData(rows, dates, key),
    });
    const histDef = (key: string, title: string): NativeSeriesDef => ({
      type: 'histogram',
      title,
      color: upA,
      base: 0,
      data: histData(rows, dates, key, upA, downA),
    });
    const panes: NativePaneDef[] = [
      // pane 0 主图:蜡烛 + MA(实线) + EMA(虚线) + BOLL(点线)
      {
        stretch: PANE_STRETCH[0],
        series: [
          {
            type: 'candles', title: 'K线', upColor: theme.colors.up, downColor: theme.colors.down,
            data: bars.map((b) => ({ time: fmtDate(b.date), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
          },
          ...[['MA5', C.amber], ['MA10', C.sky], ['MA20', C.purple], ['MA60', C.gray]].map(([k, c]) => lineDef(k, c)),
          ...[['EMA5', C.amber], ['EMA10', C.sky], ['EMA20', C.purple], ['EMA60', C.gray]].map(([k, c]) => lineDef(k, c, 2)),
          ...[['BOLL_UP', C.green], ['BOLL_MB', C.green], ['BOLL_DN', C.green]].map(([k, c]) => lineDef(k, c, 1)),
        ],
      },
      // pane 1 成交量:量柱(涨跌着色) + VOL_MA5
      {
        stretch: PANE_STRETCH[1],
        series: [
          {
            type: 'histogram', title: '成交量', color: upA, base: 0, priceFormat: 'volume',
            data: bars.map((b) => ({ time: fmtDate(b.date), value: b.volume, color: b.close >= b.open ? upA : downA })),
          },
          lineDef('VOL_MA5', C.sky),
        ],
      },
      // pane 2 涨跌幅柱:正红负绿、base 0(对齐 Python change_percent_chart)
      { stretch: PANE_STRETCH[2], series: [{ type: 'histogram', title: '涨跌幅', color: upA, base: 0, data: changePctHistData(changePct, dates, upA, downA) }] },
      // pane 3 MACD:DIF/DEA 线 + MACD 柱(0 轴上下着色)
      { stretch: PANE_STRETCH[3], series: [lineDef('DIF', C.amber), lineDef('DEA', C.sky), histDef('MACD', 'MACD 柱')] },
      // pane 4 KDJ
      { stretch: PANE_STRETCH[4], series: [lineDef('K', C.amber), lineDef('D', C.sky), lineDef('J', C.purple)] },
      // pane 5 RSI
      { stretch: PANE_STRETCH[5], series: [lineDef('RSI6', C.amber), lineDef('RSI12', C.sky), lineDef('RSI24', C.purple)] },
      // pane 6 MACD-VH:MACD_V/SIGNAL 线 + VH 柱
      { stretch: PANE_STRETCH[6], series: [lineDef('MACD_V', C.amber), lineDef('SIGNAL', C.sky), histDef('MACD_VH', 'VH 柱')] },
      // pane 7-9 单线:ATR / 量比 / 乖离率
      { stretch: PANE_STRETCH[7], series: [lineDef('ATR', C.yellow)] },
      { stretch: PANE_STRETCH[8], series: [lineDef('VOL_RATIO', C.sky)] },
      { stretch: PANE_STRETCH[9], series: [lineDef('LIU_BIAS', C.purple)] },
    ];
    return {
      height: CHART_HEIGHT,
      layout: { background: theme.colors.background, text: theme.colors.textSecondary, border: theme.colors.border },
      legend: LEGEND,
      panes,
    };
  }, [bars, rows, changePct, theme]);

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

  if (Platform.OS !== 'web') {
    // 原生:WebView 渲染生成的 chart-view.html(图例在页内由数据构建)
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
      {/* 图例随各 pane(浮层叠加在各自 pane 顶部,见下方 paneLabels)——
         不再集中渲染顶部大图例块(用户 2026-08-15 反馈:图例应跟随各自图) */}
      <View style={{ position: 'relative', width: '100%' }}>
        <View ref={ref as never} style={{ height: CHART_HEIGHT, width: '100%' }} />
        {paneTops.map((top, i) => (LEGEND[i] ? (
          <View key={i} pointerEvents="none" style={[styles.paneLabel, { top }]}>
            <Text style={styles.paneLabelTitle}>{LEGEND[i].title}</Text>
            {LEGEND[i].series.map((s) => (
              <View key={s.label} style={styles.paneLabelChip}>
                <View style={[styles.paneLabelDot, { backgroundColor: s.color }]} />
                <Text style={styles.paneLabelText}>{s.label}</Text>
              </View>
            ))}
          </View>
        ) : null))}
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // 浮层图例:绝对定位叠加在各 pane 顶部(pointerEvents none,不挡缩放/十字线)
    paneLabel: { position: 'absolute', left: 8, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 10, maxWidth: '92%' },
    paneLabelTitle: { fontWeight: '700', fontSize: 11, color: theme.colors.textSecondary },
    paneLabelChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    paneLabelDot: { width: 8, height: 8, borderRadius: 4 },
    paneLabelText: { fontSize: 10, opacity: 0.85, color: theme.colors.textSecondary },
  });
}
