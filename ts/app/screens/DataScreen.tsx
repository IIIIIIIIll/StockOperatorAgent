// 采集数据 Tab —— 对齐 Python data_markdown.render_sections:
// 概览单行 + 日K 表 + K线图(web)+ 盈利能力表 + 业绩表 + 指标。
// 数据来自 store(demo 载入)与 F10 文本解析,与 build_stock_information 同源。
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { store } from '../lib/runner';
import type { IChartApi } from 'lightweight-charts';
import { composeOverview } from '../../src/overview.ts';
import { parseIndicatorSection } from '../../src/f10.ts';
import { fmtNumber } from '../../src/pipeline.ts';
import { useTheme, type Theme } from '../theme';
import demo from '../data/demo.json';

const DAILY_TABLE_N = 20;
const KLINE_N = 60;

export default function DataScreen({ stockInformation }: { stockInformation: string }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const bars = store.getDatas('600036');
  const stock = store.getStock('600036');
  const f10Text = store.getMeta('demo:f10') ?? '';
  const profit = f10Text ? parseIndicatorSection(f10Text, '【盈利能力指标】') : [];
  const periods = [...new Set(profit.map((r) => r.period))].sort();
  const latest = periods[periods.length - 1] ?? '';
  const reports = store.getPerformanceReports('600036');

  // 概览:snapshot 缺失 → 价格回退日K末根(与 compose_overview 语义一致)
  const overview = composeOverview({
    ticker: '600036',
    name: stock?.name ?? '招商银行',
    snapshot: null,
    capital: null,
    f10: parseIndicatorSection(f10Text, '【主要财务指标】'),
    bars,
    today: bars.length ? bars[bars.length - 1].date : '2026-08-09',
  });

  const tail = bars.slice(-DAILY_TABLE_N);
  const klineBars = bars.slice(-KLINE_N);
  const lastInd = demo.indicators[demo.indicators.length - 1] as Record<string, number | null>;
  const indicatorKeys = ['MA5', 'MA10', 'MA20', 'MACD', 'RSI6', 'K', 'BOLL_UP', 'ATR', 'VOL_RATIO', 'MACD_VH', 'LIU_BIAS'];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>采集数据 · {overview.name} ({overview.ticker})</Text>

      {/* 概览单行 */}
      <View style={styles.overviewRow}>
        {[['最新价', fmtNumber(overview.latest_price as number, 2)],
          ['涨跌幅', `${fmtNumber(overview.change_percent as number, 2)}%`],
          ['动态PE', fmtNumber(overview.pe_dynamic as number, 2)],
          ['市净率', fmtNumber(overview.pb as number, 2)],
          ['60日', `${fmtNumber(overview.change_percent_60d as number, 2)}%`],
          ['YTD', `${fmtNumber(overview.change_percent_ytd as number, 2)}%`],
        ].map(([label, value]) => (
          <View key={label} style={styles.overviewCell}>
            <Text style={styles.overviewLabel}>{label}</Text>
            <Text style={styles.overviewValue}>{value}</Text>
          </View>
        ))}
      </View>

      {/* K线图(web;原生端真机 M4 接 canvas polyfill) */}
      {Platform.OS === 'web' && klineBars.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>K线图(近 {KLINE_N} 根,原始价)</Text>
          <KLineChart bars={klineBars} theme={theme} />
        </View>
      )}

      {/* 日K 表 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>日K(尾 {DAILY_TABLE_N} / 共 {bars.length} 根)</Text>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cell, styles.dateCell]}>日期</Text>
            <Text style={styles.cell}>开</Text>
            <Text style={styles.cell}>收</Text>
            <Text style={styles.cell}>高</Text>
            <Text style={styles.cell}>低</Text>
            <Text style={styles.cell}>量(手)</Text>
          </View>
          {tail.map((b, i) => (
            <View key={i} style={styles.row}>
              <Text style={[styles.cell, styles.dateCell]}>{b.date}</Text>
              <Text style={styles.cell}>{b.open.toFixed(2)}</Text>
              <Text style={[styles.cell, { color: b.close >= b.open ? theme.colors.up : theme.colors.down }]}>{b.close.toFixed(2)}</Text>
              <Text style={styles.cell}>{b.high.toFixed(2)}</Text>
              <Text style={styles.cell}>{b.low.toFixed(2)}</Text>
              <Text style={styles.cell}>{(b.volume / 10000).toFixed(1)}万</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 盈利能力(F10 最新期) */}
      {profit.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>盈利能力指标({latest})</Text>
          <View style={styles.chips}>
            {profit.filter((r) => r.period === latest && !Number.isNaN(r.value_num)).map((r, i) => (
              <View key={i} style={styles.chip}>
                <Text style={styles.chipLabel}>{r.metric}</Text>
                <Text style={styles.chipValue}>{fmtNumber(r.value_num, 2)}%</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 业绩表(采集层 M4 接入;当前演示数据为空) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>业绩报告({reports.length})</Text>
        {reports.length === 0 ? (
          <Text style={styles.muted}>暂无业绩数据 —— TDX F10 业绩采集在 M4 接入(当前为演示数据)。</Text>
        ) : (
          reports.map((r, i) => (
            <View key={i} style={styles.opinionCard}>
              <Text style={styles.opinionBody}>{r.report_date}: {JSON.stringify(r.fields)}</Text>
            </View>
          ))
        )}
      </View>

      {/* 最新指标 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>最新指标(computeAll 末根)</Text>
        <View style={styles.chips}>
          {indicatorKeys.map((k) => (
            <View key={k} style={styles.chip}>
              <Text style={styles.chipLabel}>{k}</Text>
              <Text style={styles.chipValue}>{lastInd[k] !== null && lastInd[k] !== undefined && Number.isFinite(lastInd[k]) ? (lastInd[k] as number).toFixed(3) : 'N/A'}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 分析上下文原文 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>分析上下文(build_stock_information 输出)</Text>
        {stockInformation ? (
          <Text style={styles.infoText}>{stockInformation.slice(0, 2400)}{stockInformation.length > 2400 ? '\n…(截断)' : ''}</Text>
        ) : (
          <Text style={styles.muted}>尚未运行分析——上下文将在「设置」点击开始后生成。</Text>
        )}
      </View>
    </ScrollView>
  );
}

// ─── K线图(web-only;lightweight-charts 动态 import) ──────────────────────

function KLineChart({ bars, theme }: { bars: Array<{ date: string; open: number; close: number; high: number; low: number; volume: number }>; theme: Theme }) {
  const ref = React.useRef<View | null>(null);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current) return undefined;
    const el = ref.current as unknown as HTMLElement;
    let disposed = false;
    let chart: IChartApi | null = null;
    void import('lightweight-charts').then(({ createChart, ColorType, CandlestickSeries, HistogramSeries }) => {
      if (disposed || !el) return;
      chart = createChart(el, {
        height: 320,
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
      const candle = chart.addSeries(CandlestickSeries, {
        upColor: theme.colors.up,
        downColor: theme.colors.down,
        borderVisible: false,
        wickUpColor: theme.colors.up,
        wickDownColor: theme.colors.down,
      });
      candle.setData(bars.map((b) => ({
        time: b.date as never,
        open: b.open, high: b.high, low: b.low, close: b.close,
      })));
      const volume = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
      });
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volume.setData(bars.map((b) => ({
        time: b.date as never,
        value: b.volume,
        color: b.close >= b.open ? 'rgba(211,47,47,0.4)' : 'rgba(26,143,61,0.4)',
      })));
    });
    return () => { disposed = true; chart?.remove(); };
  }, [bars, theme]);

  // web 下 ref 挂到 div(View 渲染为 div)
  return <View ref={ref as never} style={{ height: 320, width: '100%' }} />;
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.md },
    title: { fontSize: 18, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.md },
    overviewRow: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
    overviewCell: { width: '33%', paddingVertical: 4 },
    overviewLabel: { fontSize: 11, color: theme.colors.textSecondary },
    overviewValue: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginTop: 2 },
    section: { marginBottom: theme.spacing.lg },
    sectionTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.sm },
    table: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
    row: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: theme.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
    headerRow: { backgroundColor: theme.colors.surface },
    cell: { flex: 1, fontSize: 11, textAlign: 'right', color: theme.colors.text },
    dateCell: { flex: 1.5, textAlign: 'left', color: theme.colors.textSecondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing.sm, paddingVertical: 5 },
    chipLabel: { fontSize: 10, color: theme.colors.textSecondary },
    chipValue: { fontSize: 12, fontWeight: '600', color: theme.colors.text, marginTop: 2 },
    opinionCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border },
    opinionBody: { fontSize: 12, lineHeight: 18, color: theme.colors.text },
    infoText: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, fontSize: 11, lineHeight: 16, fontFamily: 'monospace', color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
    muted: { color: theme.colors.textSecondary, fontSize: 12 },
  });
}
