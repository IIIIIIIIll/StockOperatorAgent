// 全指标多面板图(web-only;lightweight-charts v5 paneIndex)。
// 数据与「最新指标」chips 同源:DataScreen 的 computeAll 结果切片(rows 与
// bars 同长同序,窗口一致)。面板编排对齐通达信习惯 + Python
// get_trend_indicators 分组:主图(MA/EMA/BOLL 叠加)+ 成交量 + 全部振荡器。
import React from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';
import type { IndicatorRow } from '../../src/indicators.ts';
import { changePctHistData } from '../../src/chartData.ts';
import { paneTops as computePaneTops } from '../../src/chartLayout.ts';
import { fmtDate } from '../../src/format.ts';
import { ChartWebView, useChartWebView } from '../hooks/useChartWebView';
import type { Theme } from '../theme';
import { warn } from '../../src/log.ts';

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null; // null = 数据源未提供(CR-25)，量柱留空不画 0
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
  { title: '涨跌幅', series: [] }, // CR-34:柱逐点红/绿,不挂固定色 chip(标题已表达)
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
interface CandlePoint { time: string; open: number; high: number; low: number; close: number; volume: number | null }
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

/** 柱数据:按正负着色。P2(评审 2026-11-09):规则单源 —— 委托给
 *  src/chartData.ts 的 changePctHistData(它被 test/chartData.test.ts 逐点钉住)。
 *  此前这里另有一份同规则实现且无测试覆盖:改零轴归红/绿约定时曾经只有一份会变。 */
function histData(
  rows: IndicatorRow[], dates: string[], key: string, upColor: string, downColor: string,
): Array<{ time: string; value: number; color: string }> {
  const values = rows.map((r) => {
    const v = r[key];
    return typeof v === 'number' ? v : NaN;
  });
  return changePctHistData(values, dates, upColor, downColor);
}

/** #RRGGBB → rgba(...,alpha);柱半透明沿用原 volume 柱做法 */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// ─── web 分支系列编排(建图与更新单源:两处都读这张表,防 key 漂移) ──────
type WebLineStyle = 'solid' | 'dashed' | 'dotted';
interface WebLineSpec {
  key: string;
  color: string;
  style: WebLineStyle;
  pane: number;
}

const WEB_LINES: WebLineSpec[] = [
  // pane 0 主图:MA(实线) + EMA(虚线) + BOLL(点线)
  ...([['MA5', C.amber], ['MA10', C.sky], ['MA20', C.purple], ['MA60', C.gray]] as const)
    .map(([key, color]): WebLineSpec => ({ key, color, style: 'solid', pane: 0 })),
  ...([['EMA5', C.amber], ['EMA10', C.sky], ['EMA20', C.purple], ['EMA60', C.gray]] as const)
    .map(([key, color]): WebLineSpec => ({ key, color, style: 'dashed', pane: 0 })),
  ...([['BOLL_UP', C.green], ['BOLL_MB', C.green], ['BOLL_DN', C.green]] as const)
    .map(([key, color]): WebLineSpec => ({ key, color, style: 'dotted', pane: 0 })),
  // pane 1 成交量
  { key: 'VOL_MA5', color: C.sky, style: 'solid', pane: 1 },
  // pane 3 MACD
  { key: 'DIF', color: C.amber, style: 'solid', pane: 3 },
  { key: 'DEA', color: C.sky, style: 'solid', pane: 3 },
  // pane 4 KDJ
  { key: 'K', color: C.amber, style: 'solid', pane: 4 },
  { key: 'D', color: C.sky, style: 'solid', pane: 4 },
  { key: 'J', color: C.purple, style: 'solid', pane: 4 },
  // pane 5 RSI
  { key: 'RSI6', color: C.amber, style: 'solid', pane: 5 },
  { key: 'RSI12', color: C.sky, style: 'solid', pane: 5 },
  { key: 'RSI24', color: C.purple, style: 'solid', pane: 5 },
  // pane 6 MACD-VH
  { key: 'MACD_V', color: C.amber, style: 'solid', pane: 6 },
  { key: 'SIGNAL', color: C.sky, style: 'solid', pane: 6 },
  // pane 7-9 单线:ATR / 量比 / 乖离率
  { key: 'ATR', color: C.yellow, style: 'solid', pane: 7 },
  { key: 'VOL_RATIO', color: C.sky, style: 'solid', pane: 8 },
  { key: 'LIU_BIAS', color: C.purple, style: 'solid', pane: 9 },
];

/** 已建好的 web 图句柄:建图 effect 产出,数据 effect 消费。
 *  theme 在建图时捕获(颜色已烘进 series 选项),更新时只用于柱状图逐点着色。 */
interface WebChartHandle {
  chart: IChartApi;
  candle: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  changePct: ISeriesApi<'Histogram'>;
  macd: ISeriesApi<'Histogram'>;
  vh: ISeriesApi<'Histogram'>;
  lines: Map<string, ISeriesApi<'Line'>>;
  theme: Theme;
}

/** 把当前数据灌进已建好的 chart(不碰 chart 生命周期)。数据语义与原实现逐项一致:
 *  warmup NaN 由 lineData 过滤;volume null 不画(CR-25);柱按正负着色。 */
function applyWebData(h: WebChartHandle, bars: Bar[], rows: IndicatorRow[], changePct: number[]): void {
  const dates = bars.map((b) => fmtDate(b.date));
  const upA = hexToRgba(h.theme.colors.up, 0.4);
  const downA = hexToRgba(h.theme.colors.down, 0.4);

  h.candle.setData(bars.map((b) => ({
    time: fmtDate(b.date),
    open: b.open, high: b.high, low: b.low, close: b.close,
  })));

  for (const spec of WEB_LINES) h.lines.get(spec.key)?.setData(lineData(rows, dates, spec.key));

  h.volume.setData(bars
    .filter((b): b is Bar & { volume: number } => b.volume !== null)
    .map((b) => ({
      time: fmtDate(b.date),
      value: b.volume,
      color: b.close >= b.open ? upA : downA,
    })));

  // 涨跌幅柱:正红负绿、base 0(对齐 Python change_percent_chart)
  h.changePct.setData(changePctHistData(changePct, dates, upA, downA));
  // MACD 柱(0 轴上下着色)
  h.macd.setData(histData(rows, dates, 'MACD', upA, downA));
  h.vh.setData(histData(rows, dates, 'MACD_VH', upA, downA));
}

export default function IndicatorChart({ bars, rows, changePct, theme }: { bars: Bar[]; rows: IndicatorRow[]; changePct: number[]; theme: Theme }) {
  const { width } = useWindowDimensions();
  // 窄屏(<560px)下主图图例改文档流内换行块(浮层换行会遮挡 K 线,见 design.md)
  const narrow = width < 560;
  const ref = React.useRef<View | null>(null);
  // 各 pane 顶 y 坐标(web 分支浮层标题定位;stretch 后按实际高度累积)
  const [paneTops, setPaneTops] = React.useState<number[]>([]);
  // 图表引导失败态(评审 2026-11-09 P2):chunk 加载失败 / createChart 抛错 /
  // setData 拒收(如 period 非 YYYY-MM-DD)此前是完全静默的 —— 用户看到一块
  // 永久空白,既无文案也无重试。chartHtml.ts 的原生侧已有同类降级范式。
  const [chartFailed, setChartFailed] = React.useState(false);
  // P3(评审 2026-11-09):theme 是模块常量,别每次渲染都重建样式表
  const styles = React.useMemo(() => makeStyles(theme), [theme]);

  // 建图句柄 + 完成门(§8「图表建一次 + 更新」拆分)。
  // 旧实现把 createChart + addSeries + setData 全塞进一个 effect,依赖含数据 ——
  // 每次采集完成(数据变一次)就整块销毁重建 chart:数据页闪一下,缩放/十字线
  // 状态也一并丢失。裁决 NUANCED(重建次数是「每次采集」而非每帧),收益即消除
  // 这次闪烁。拆成两个 effect:建图只依赖 theme,数据只重灌 series。
  const handleRef = React.useRef<WebChartHandle | null>(null);
  // 动态 import 是异步的 → 首帧 update effect 必然还没句柄;ready 翻真后由
  // update effect 补首屏数据。
  const [chartReady, setChartReady] = React.useState(false);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current) return undefined;
    // SAFETY: 仅在 Platform.OS==='web' 分支执行,RNW 把 View 渲染成 DOM 节点,
    // 所以 ref.current 确实是 HTMLElement;RN 的类型面里没有 DOM 类型,只能强转。
    const el = ref.current as unknown as HTMLElement;
    let disposed = false;
    let chart: IChartApi | null = null;
    // LineStyle 是运行时枚举(值),须从动态 import 解构取值;类型注释放
    // 顶层 import type(不把 lightweight-charts 拉进 RN 原生 bundle)
    void import('lightweight-charts').then(({ createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, LineStyle: LineStyleValue }) => {
      if (disposed || !el) return;
      try {
        chart = createChart(el, {
          height: CHART_HEIGHT,
          // autoSize:ResizeObserver 驱动,窗口缩放时 canvas 随容器宽度回流(高度仍由容器 style 固定)
          autoSize: true,
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

        const styleOf = (style: WebLineSpec['style']): LineStyle =>
          style === 'dashed' ? LineStyleValue.Dashed : style === 'dotted' ? LineStyleValue.Dotted : LineStyleValue.Solid;
        const lines = new Map<string, ISeriesApi<'Line'>>();
        const addLine = (spec: WebLineSpec): void => {
          lines.set(
            spec.key,
            chart!.addSeries(LineSeries, { color: spec.color, lineWidth: 1, lineStyle: styleOf(spec.style) }, spec.pane),
          );
        };
        const addLinesIn = (...panes: number[]): void => {
          for (const spec of WEB_LINES) if (panes.includes(spec.pane)) addLine(spec);
        };

        // 创建顺序 = pane 内绘制层叠顺序(后建者在上),必须与原实现逐位一致:
        // candle 先于 pane 0 各线、volume 先于 VOL_MA5、MACD 线先于 MACD 柱。
        const candle = chart.addSeries(CandlestickSeries, {
          upColor: theme.colors.up,
          downColor: theme.colors.down,
          borderVisible: false,
          wickUpColor: theme.colors.up,
          wickDownColor: theme.colors.down,
        }, 0);
        addLinesIn(0);

        const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, base: 0 }, 1);
        addLinesIn(1);

        const changePctSeries = chart.addSeries(HistogramSeries, { base: 0 }, 2);

        addLinesIn(3);
        const macd = chart.addSeries(HistogramSeries, { base: 0 }, 3);

        addLinesIn(4, 5);

        addLinesIn(6);
        const vh = chart.addSeries(HistogramSeries, { base: 0 }, 6);

        addLinesIn(7, 8, 9);

        // 面板比例:全部 series 建完后设置 stretch(比例布局,与当前高度无关)
        chart.panes().forEach((p, i) => p.setStretchFactor(PANE_STRETCH[i] ?? 70));
        // 面板顶位置:纯比例计算(stretch/总和 × 总高,实现抽到 src/chartLayout.ts
        // paneTops 公共函数)——不用 pane.getHeight():真实 lightweight-charts v5.2
        // createChart 后立即读取返回未布局值(≈全高,2026-08-15 真机/Chromium 实测),
        // 会导致附图标签全部堆到图表底部。
        setPaneTops(computePaneTops(PANE_STRETCH.map((stretchFactor) => ({ height: CHART_HEIGHT, stretchFactor }))));
        handleRef.current = { chart, candle, volume, changePct: changePctSeries, macd, vh, lines, theme };
        setChartFailed(false);
        setChartReady(true);
      } catch (err) {
        // 建图抛错(createChart 失败 / series 选项被拒)
        setChartFailed(true);
        handleRef.current = null;
        chart?.remove();
        chart = null;
        warn(`指标图渲染失败:${err instanceof Error ? err.message : String(err)}`);
      }
    }).catch((err: unknown) => {
      // 动态 chunk 加载失败(dev 重载 / OTA 后旧 chunk 失效)
      if (disposed) return;
      setChartFailed(true);
      warn(`指标图模块加载失败:${err instanceof Error ? err.message : String(err)}`);
    });
    return () => {
      disposed = true;
      handleRef.current = null;
      setChartReady(false);
      chart?.remove();
    };
  }, [theme]);

  // 数据更新:只重灌 series,不重建 chart(缩放/十字线/面板尺寸全部保持)。
  // 首屏由 chartReady 翻真触发的这次跑补上。
  React.useEffect(() => {
    if (!chartReady) return;
    const h = handleRef.current;
    if (!h) return;
    try {
      applyWebData(h, bars, rows, changePct);
      setChartFailed(false);
    } catch (err) {
      // setData 拒收(如 time 非 YYYY-MM-DD / 时间轴非升序):与建图失败同样降级
      // —— 移除坏图 + 文案,不留一块永久空白。重建需等组件重挂或 theme 变更;
      // 不在这里自动重建(会在数据持续非法时 建图→抛→重建 死循环)。
      setChartFailed(true);
      handleRef.current = null;
      setChartReady(false);
      h.chart.remove();
      warn(`指标图数据更新失败:${err instanceof Error ? err.message : String(err)}`);
    }
  }, [bars, rows, changePct, chartReady]);

  // ─── 原生分支:WebView 渲染同一数据(HTML 由 tools/build-chart-view.mts 生成)──
  // 序列化 web 分支同款数据(bars + lineData/histData 结果 + 颜色)→ JSON;
  // useMemo 稳定 JSON 引用,流式重渲染只重注入数据(不重建 WebView)。
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
            // volume null = 未知 → 该点不画(不以 0 冒充，CR-25)
            data: bars
              .filter((b): b is Bar & { volume: number } => b.volume !== null)
              .map((b) => ({ time: fmtDate(b.date), value: b.volume, color: b.close >= b.open ? upA : downA })),
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

  const nativeJson = React.useMemo(
    () => (Platform.OS === 'web' ? '' : JSON.stringify(nativeData)),
    [nativeData],
  );
  // WebView 生命周期(稳定 source / 渲染进程死亡重挂 / 后台不注入)集中在
  // app/hooks/useChartWebView.ts —— 与 FinancialTrendChart 同一套语义。
  const chart = useChartWebView(nativeJson);

  if (Platform.OS !== 'web') {
    // 原生:WebView 渲染生成的 chart-view.html(图例在页内由数据构建)
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
      {/* 窄屏(<560px)主图图例:渲染为图表容器上方文档流内换行块,9 chips 完整
         显示且不遮挡 K 线(浮层单行放不下会截断,见 design.md) */}
      {narrow && LEGEND[0] ? (
        <View style={styles.mainLegendBlock}>
          <Text style={styles.paneLabelTitle}>{LEGEND[0].title}</Text>
          {LEGEND[0].series.map((s) => (
            <View key={s.label} style={styles.paneLabelChip}>
              <View style={[styles.paneLabelDot, { backgroundColor: s.color }]} />
              <Text style={styles.paneLabelText}>{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ position: 'relative', width: '100%' }}>
        <View ref={ref as never} style={{ height: CHART_HEIGHT, width: '100%' }} />
        {/* 引导失败:保留容器高度占位,给出可读原因(而不是一块永久空白) */}
        {chartFailed ? (
          <View pointerEvents="none" style={styles.chartFailedOverlay}>
            <Text style={styles.chartFailedText}>指标图渲染失败:图表引擎未就绪或数据日期格式不合法,可切到「最新指标」表格查看同源数值。</Text>
          </View>
        ) : null}
        {paneTops.map((top, i) => (LEGEND[i] && !(narrow && i === 0) ? (
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
    // 窄屏主图图例:图表容器上方文档流内换行块(复用下面 paneLabel* 各样式)
    mainLegendBlock: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 6, marginLeft: 8, paddingBottom: 8 },
    // 浮层图例:绝对定位叠加在各 pane 顶部(pointerEvents none,不挡缩放/十字线)
    chartFailedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  chartFailedText: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  paneLabel: { position: 'absolute', left: 8, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 10, maxWidth: '92%' },
    paneLabelTitle: { fontWeight: '700', fontSize: 11, color: theme.colors.textSecondary },
    paneLabelChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    paneLabelDot: { width: 8, height: 8, borderRadius: 4 },
    paneLabelText: { fontSize: 10, opacity: 0.85, color: theme.colors.textSecondary },
  });
}
