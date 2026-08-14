// 采集数据 Tab —— 对齐 Python data_markdown.render_sections:
// 概览单行 + 日K 表 + K线图(web)+ 盈利能力表 + 业绩表 + 指标。
// 数据来自 store(demo 载入)与 F10 文本解析,与 build_stock_information 同源。
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { store } from '../lib/runner';
import IndicatorChart, { type Bar } from '../components/IndicatorChart';
import FinancialTrendChart from '../components/FinancialTrendChart';
import { composeOverview } from '../../src/overview.ts';
import { parseIndicatorSection, parseCapitalStructure } from '../../src/f10.ts';
import { computeAll } from '../../src/indicators.ts';
import { changePercentSeries, fmtNumber, turnoverPct } from '../../src/pipeline.ts';
import { financialTrendSeries, salesGrossMargin } from '../../src/chartData.ts';
import { fmtDate } from '../../src/format.ts';
import { useTheme, type Theme } from '../theme';

const DAILY_TABLE_N = 20;
const KLINE_N = 60;

export default function DataScreen({ stockInformation, dataVersion, ticker }: { stockInformation: string; dataVersion?: number; ticker: string }) {
  void dataVersion; // 父组件数据就绪信号:触发本组件重渲染以读取 store
  const theme = useTheme();
  const styles = makeStyles(theme);
  const bars = React.useMemo(() => store.getDatas(ticker), [ticker, dataVersion]);
  const stock = store.getStock(ticker);
  const f10Text = store.getMeta(`f10:${ticker}`) ?? (ticker === '600036' ? (store.getMeta('demo:f10') ?? '') : '');
  const profit = f10Text ? parseIndicatorSection(f10Text, '【盈利能力指标】') : [];
  const periods = [...new Set(profit.map((r) => r.period))].sort();
  const latest = periods[periods.length - 1] ?? '';
  const reports = store.getPerformanceReports(ticker);
  // 股本结构:web 采集经 webCollect 持久化 meta 'capital:${ticker}'(股本结构节文本);
  // demo/未采集 → null(换手率列显示 N/A,与 Python 缺股本语义一致)
  const capital = React.useMemo(() => {
    const text = store.getMeta(`capital:${ticker}`);
    return text ? parseCapitalStructure(text) : null;
  }, [ticker]);
  // 涨跌幅:由 bars 现算(复用 pipeline changePercentSeries 公式;首根 NaN → N/A)
  const changePct = React.useMemo(() => changePercentSeries(bars), [bars]);
  // 财务跨期趋势:净利润/每股收益取自 performance_reports,销售毛利率取自
  // F10 盈利能力节(financialTrendSeries 内 N/A 期跳过;全空 → [] → 图不渲染)
  const financialSeriesData = React.useMemo(() => financialTrendSeries(reports, profit), [reports, profit]);

  // 概览:snapshot 缺失 → 价格回退日K末根(与 compose_overview 语义一致)
  const overview = composeOverview({
    ticker,
    name: stock?.name ?? ticker,
    snapshot: null,
    capital: null,
    f10: parseIndicatorSection(f10Text, '【主要财务指标】'),
    bars,
    today: bars.length ? bars[bars.length - 1].date : '2026-08-10',
  });

  const tail = bars.slice(-DAILY_TABLE_N);
  // 表列值:涨跌幅/换手率与 tail 同窗切片(index 对齐;首根涨跌幅 NaN → N/A)
  const tailChangePct = changePct.slice(-DAILY_TABLE_N);
  // 图表涨跌幅窗口切片:memo 保持稳定引用(chartRows/klineBars 同款)——内联
  // slice 每次渲染新数组会触发 IndicatorChart 全图重建(流式 progress 重渲染时闪烁)
  const klineChangePct = React.useMemo(() => changePct.slice(-KLINE_N), [changePct]);
  // 指标:由本次 ticker 的 bars 实算(原 hardcode demo.indicators 只对 600036 正确);
  // 图表与 chips 共用同一份结果,窗口切片保持稳定引用避免流式重渲染时重建图表
  const indRows = React.useMemo(
    () => computeAll(bars.map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close, vol: b.volume }))),
    [bars],
  );
  const klineBars = React.useMemo<Bar[]>(() => bars.slice(-KLINE_N), [bars]);
  const chartRows = React.useMemo(() => indRows.slice(-KLINE_N), [indRows]);
  const lastInd = (indRows[indRows.length - 1] ?? {}) as Record<string, number | null>;
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

      {/* 技术图(web;原生端真机 M4 接 canvas polyfill) */}
      {Platform.OS === 'web' && klineBars.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>技术图(近 {KLINE_N} 根,全部指标)</Text>
          <IndicatorChart bars={klineBars} rows={chartRows} changePct={klineChangePct} theme={theme} />
        </View>
      )}

      {/* 财务跨期趋势(web;报告期为季度稀疏轴,独立成图——净利润/毛利率/EPS) */}
      {Platform.OS === 'web' && financialSeriesData.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>财务趋势(跨期)</Text>
          <FinancialTrendChart series={financialSeriesData} theme={theme} />
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
            <Text style={styles.cell}>涨跌幅</Text>
            <Text style={styles.cell}>量(手)</Text>
            <Text style={styles.cell}>换手率</Text>
          </View>
          {tail.map((b, i) => {
            const pct = tailChangePct[i];
            const turnover = turnoverPct(b, capital);
            return (
              <View key={i} style={styles.row}>
                <Text style={[styles.cell, styles.dateCell]}>{fmtDate(b.date)}</Text>
                <Text style={styles.cell}>{b.open.toFixed(2)}</Text>
                <Text style={[styles.cell, { color: b.close >= b.open ? theme.colors.up : theme.colors.down }]}>{b.close.toFixed(2)}</Text>
                <Text style={styles.cell}>{b.high.toFixed(2)}</Text>
                <Text style={styles.cell}>{b.low.toFixed(2)}</Text>
                <Text style={[styles.cell, { color: Number.isNaN(pct) ? undefined : pct >= 0 ? theme.colors.up : theme.colors.down }]}>
                  {Number.isNaN(pct) ? 'N/A' : `${fmtNumber(pct, 2)}%`}
                </Text>
                <Text style={styles.cell}>{(b.volume / 10000).toFixed(1)}万</Text>
                <Text style={styles.cell}>{Number.isNaN(turnover) ? 'N/A' : `${fmtNumber(turnover, 2)}%`}</Text>
              </View>
            );
          })}
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

      {/* 业绩表(F10 财务分析 → composeReports 每期一行) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>业绩报告({reports.length})</Text>
        {reports.length === 0 ? (
          <Text style={styles.muted}>暂无业绩数据 —— 该股 F10 财务分析无可用指标。</Text>
        ) : (
          reports.slice(-4).reverse().map((r, i) => {
            const f = r.fields as Record<string, unknown>;
            return (
              <View key={i} style={styles.opinionCard}>
                <Text style={styles.opinionBody}>
                  {r.report_date} — EPS {fmtNumber(f.eps as number, 2)} | 净利润 {fmtNumber(f.net_profit as number, 0)} | YoY {fmtNumber(f.net_profit_YoY_rate as number, 2)}% | QoQ {fmtNumber(f.net_profit_QoQ_rate as number, 2)}% | 销售毛利率 {fmtNumber(salesGrossMargin(profit, r.report_date), 2)}% | ROE {fmtNumber(f.net_worth_return_rate as number, 2)}% | 每股净资产 {fmtNumber(f.net_worth_per_share as number, 2)} | 每股现金流 {fmtNumber(f.cash_flow_per_share as number, 2)}
                </Text>
              </View>
            );
          })
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
          <Text style={styles.infoText}>{stockInformation}</Text>
        ) : (
          <Text style={styles.muted}>尚未生成分析上下文——点击「开始分析」后生成。</Text>
        )}
      </View>
    </ScrollView>
  );
}

// ─── 样式 ─────────────────────────────────────────────────────────────

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
