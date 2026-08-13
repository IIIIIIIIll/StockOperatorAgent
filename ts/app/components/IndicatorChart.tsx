// 全指标多面板图(web-only;lightweight-charts v5 paneIndex)。
// 数据与「最新指标」chips 同源:DataScreen 的 computeAll 结果切片(rows 与
// bars 同长同序,窗口一致)。面板编排对齐通达信习惯 + Python
// get_trend_indicators 分组:主图(MA/EMA/BOLL 叠加)+ 成交量 + 全部振荡器。
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { IChartApi, LineStyle } from 'lightweight-charts';
import type { IndicatorRow } from '../../src/indicators.ts';
import { fmtDate } from '../../src/format.ts';
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

// 面板比例(主图 + 成交量 + 4 振荡器 + 3 单线):stretch 比例布局,与图高解耦。
// 用 setStretchFactor 而非 setHeight——Pane 初始 height=0,首帧布局前 setHeight
// 会以 totalHeight=0 计算导致高度错乱(v5 源码 _internal_changePanesHeight)。
const PANE_STRETCH = [300, 90, 90, 90, 90, 90, 70, 70, 70];
const CHART_HEIGHT = PANE_STRETCH.reduce((a, b) => a + b, 0);

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

export default function IndicatorChart({ bars, rows, theme }: { bars: Bar[]; rows: IndicatorRow[]; theme: Theme }) {
  const ref = React.useRef<View | null>(null);
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
        rightPriceScale: { borderColor: theme.colors.border },
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

      // pane 2 MACD:DIF/DEA 线 + MACD 柱(0 轴上下着色)
      line('DIF', C.amber, undefined, 2);
      line('DEA', C.sky, undefined, 2);
      const macd = chart.addSeries(HistogramSeries, { base: 0 }, 2);
      macd.setData(histData(rows, dates, 'MACD', upA, downA));

      // pane 3 KDJ
      line('K', C.amber, undefined, 3);
      line('D', C.sky, undefined, 3);
      line('J', C.purple, undefined, 3);

      // pane 4 RSI
      line('RSI6', C.amber, undefined, 4);
      line('RSI12', C.sky, undefined, 4);
      line('RSI24', C.purple, undefined, 4);

      // pane 5 MACD-VH:MACD_V/SIGNAL 线 + VH 柱
      line('MACD_V', C.amber, undefined, 5);
      line('SIGNAL', C.sky, undefined, 5);
      const vh = chart.addSeries(HistogramSeries, { base: 0 }, 5);
      vh.setData(histData(rows, dates, 'MACD_VH', upA, downA));

      // pane 6-8 单线:ATR / 量比 / 乖离率
      line('ATR', C.yellow, undefined, 6);
      line('VOL_RATIO', C.sky, undefined, 7);
      line('LIU_BIAS', C.purple, undefined, 8);

      // 面板比例:全部 series 建完后设置 stretch(比例布局,与当前高度无关)
      chart.panes().forEach((p, i) => p.setStretchFactor(PANE_STRETCH[i] ?? 70));
    });
    return () => { disposed = true; chart?.remove(); };
  }, [bars, rows, theme]);

  return (
    <View>
      {/* 图例:每面板一行,标题 + 系列 chips(与图上颜色同源) */}
      <View style={styles.legendCol}>
        {LEGEND.map((p) => (
          <View key={p.title} style={styles.legendRow}>
            <Text style={styles.legendTitle}>{p.title}</Text>
            {p.series.map((s) => (
              <View key={s.label} style={styles.legendChip}>
                <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                <Text style={styles.legendLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
      {/* web 下 ref 挂到 div(View 渲染为 div) */}
      <View ref={ref as never} style={{ height: CHART_HEIGHT, width: '100%' }} />
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    legendCol: { marginBottom: theme.spacing.sm },
    legendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 2 },
    legendTitle: { fontSize: 11, fontWeight: '600', color: theme.colors.textSecondary, minWidth: 56 },
    legendChip: { flexDirection: 'row', alignItems: 'center', marginRight: 10, marginBottom: 2 },
    legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 3 },
    legendLabel: { fontSize: 10, color: theme.colors.textSecondary },
  });
}
